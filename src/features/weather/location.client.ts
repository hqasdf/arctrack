import { WeatherIssue, approximateLocation, type ApproximateLocation } from "@arc-track/core/weather";

let prompted = false;
let busy = false;
let positionSucceeded = false;
const denied = () => new WeatherIssue("location_denied", 403, true);

/** Foreground fixes only; remember a successful grant when Permissions API is unsupported. */
export async function locateForWeather(isActive: () => boolean): Promise<ApproximateLocation> {
  if(busy)throw new WeatherIssue("location_timeout",408);
  if (!isActive() || !navigator.geolocation) throw denied();
  let permission: PermissionStatus | null = null;
  try { permission = await navigator.permissions?.query({ name: "geolocation" }) ?? null; }
  catch { /* Geolocation still works in browsers without a Permissions API query. */ }
  if(busy)throw new WeatherIssue("location_timeout",408);
  if (!isActive() || permission?.state === "denied"
    || prompted && permission?.state !== "granted" && !(permission === null && positionSucceeded)) throw denied();
  prompted = true;busy = true;
  try{return await new Promise<ApproximateLocation>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(position => {
      busy=false;
      if (!isActive()) { reject(denied()); return; }
      try {
        const location = approximateLocation(position.coords.latitude, position.coords.longitude);
        positionSucceeded = true;
        resolve(location);
      } catch { reject(new Error("Location unavailable")); }
    }, error => {
      busy=false;
      if (error.code === 1) { positionSucceeded = false; reject(denied()); }
      else { prompted=false; reject(new WeatherIssue("location_timeout",408)); }
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 });
  });}finally{busy=false;}
}

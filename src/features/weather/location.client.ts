import { approximateLocation, type ApproximateLocation } from "@arc-track/core/weather";

let prompted = false;
let positionSucceeded = false;
const denied = () => Object.assign(new Error("Location unavailable"), { noRetry: true });

/** Foreground fixes only; remember a successful grant when Permissions API is unsupported. */
export async function locateForWeather(isActive: () => boolean): Promise<ApproximateLocation> {
  if (!isActive() || !navigator.geolocation) throw denied();
  let permission: PermissionStatus | null = null;
  try { permission = await navigator.permissions?.query({ name: "geolocation" }) ?? null; }
  catch { /* Geolocation still works in browsers without a Permissions API query. */ }
  if (!isActive() || permission?.state === "denied"
    || prompted && permission?.state !== "granted" && !(permission === null && positionSucceeded)) throw denied();
  prompted = true;
  return new Promise<ApproximateLocation>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(position => {
      if (!isActive()) { reject(denied()); return; }
      try {
        const location = approximateLocation(position.coords.latitude, position.coords.longitude);
        positionSucceeded = true;
        resolve(location);
      } catch { reject(new Error("Location unavailable")); }
    }, error => {
      if (error.code === 1) { positionSucceeded = false; reject(denied()); }
      else reject(new Error("Location unavailable"));
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 });
  });
}

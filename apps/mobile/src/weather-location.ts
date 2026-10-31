import * as Location from "expo-location";
import { WeatherIssue, approximateLocation, type ApproximateLocation } from "@arc-track/core/weather";

let prompted = false;
let pendingFix:Promise<Location.LocationObject>|null=null;
const notAllowed = () => new WeatherIssue("location_denied",403,true);

/** One approximate foreground fix. No watcher, background task, or coordinate storage. */
export async function locateForWeather(isActive: () => boolean): Promise<ApproximateLocation> {
  if (!isActive()) throw notAllowed();
  if (!await Location.hasServicesEnabledAsync() || !isActive()) throw notAllowed();
  let permission = await Location.getForegroundPermissionsAsync();
  if (!isActive()) throw notAllowed();
  if (!permission.granted) {
    if (prompted || permission.status !== "undetermined" || !permission.canAskAgain) throw notAllowed();
    prompted = true;
    permission = await Location.requestForegroundPermissionsAsync();
  }
  if (!permission.granted || !isActive()) throw notAllowed();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if(pendingFix)throw new WeatherIssue("location_timeout",408);
    const request=Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low, mayShowUserSettingsDialog: false });
    pendingFix=request;void request.then(()=>{if(pendingFix===request)pendingFix=null;},()=>{if(pendingFix===request)pendingFix=null;});
    const fix = await Promise.race([
      request,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new WeatherIssue("location_timeout",408)), 15_000); }),
    ]);
    if (!isActive()) throw notAllowed();
    return approximateLocation(fix.coords.latitude, fix.coords.longitude);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

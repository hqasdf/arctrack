import * as Location from "expo-location";
import { approximateLocation, type ApproximateLocation } from "@arc-track/core/weather";

let prompted = false;
const notAllowed = () => Object.assign(new Error("Location permission is unavailable."), { noRetry: true });

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
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low, mayShowUserSettingsDialog: false }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Location is temporarily unavailable.")), 15_000); }),
    ]);
    if (!isActive()) throw notAllowed();
    return approximateLocation(fix.coords.latitude, fix.coords.longitude);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

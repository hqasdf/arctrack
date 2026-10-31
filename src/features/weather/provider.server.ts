import "server-only";
import { WeatherIssue, weatherRetryAt, approximateLocation, parseOpenMeteo, type ApproximateLocation } from "@arc-track/core/weather";
import { readWeatherJson } from "./http.server";

export function weatherProviderConfig() {
  if (process.env.ARC_TRACK_WEATHER_ENABLED !== "true") return null;
  const mode = process.env.ARC_TRACK_WEATHER_MODE;
  if (mode === "development" && process.env.NODE_ENV === "development") {
    return { endpoint: "https://api.open-meteo.com/v1/forecast", key: null };
  }
  const key = process.env.OPEN_METEO_API_KEY?.trim();
  if (mode === "commercial" && key) return { endpoint: "https://customer-api.open-meteo.com/v1/forecast", key };
  return null;
}

export async function fetchCurrentWeather(location: ApproximateLocation) {
  const config = weatherProviderConfig();
  if (!config) throw new WeatherIssue("configuration",409,true);
  const coarse = approximateLocation(location.latitude, location.longitude);
  const url = new URL(config.endpoint);
  url.searchParams.set("latitude", String(coarse.latitude));
  url.searchParams.set("longitude", String(coarse.longitude));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("timezone", "GMT");
  if (config.key) url.searchParams.set("apikey", config.key);
  let response:Response;
  try{response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000), redirect: "error" });}catch{throw new WeatherIssue("provider_unavailable",502); }
  if (!response.ok) throw new WeatherIssue(response.status===429?"provider_rate_limit":"provider_unavailable",response.status===429?429:502,response.status===401||response.status===403,weatherRetryAt(response.headers.get("retry-after")));
  try{return parseOpenMeteo(await readWeatherJson(response, 32 * 1024), Date.now());}
  catch{throw new WeatherIssue("provider_response",502);}
}

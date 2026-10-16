import type { ApproximateLocation, WeatherSnapshot, WeatherSuccess } from "@arc-track/core/weather";
import { supabase } from "./supabase";

const unavailable = () => Object.assign(new Error("Weather is unavailable."), { noRetry: true });

/** Mobile uses an explicit trusted app origin; credentials never go to a weather provider. */
export function weatherApiOrigin(value: string | undefined, development: boolean): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    const host = url.hostname;
    const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]"
      || /^10\.\d+\.\d+\.\d+$/.test(host) || /^192\.168\.\d+\.\d+$/.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host);
    return url.protocol === "https:" || development && url.protocol === "http:" && local ? url.origin : null;
  } catch { return null; }
}

function isReading(value: unknown, sessionId: string): value is WeatherSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && row.sessionId === sessionId && (row.roundId === null || typeof row.roundId === "string")
    && row.provider === "open-meteo" && typeof row.observedAt === "string" && Number.isFinite(Date.parse(row.observedAt))
    && typeof row.retrievedAt === "string" && Number.isFinite(Date.parse(row.retrievedAt))
    && ["temperatureC", "windSpeedKph", "windGustKph", "windDirectionDegrees", "humidityPercent", "conditionCode"]
      .every(key => row[key] === null || typeof row[key] === "number" && Number.isFinite(row[key]));
}

export function createWeatherApi(dependencies: {
  origin: string | null;
  accessToken(): Promise<string | null>;
  request: typeof fetch;
}) {
  async function request(sessionId: string, roundId?: string, location?: ApproximateLocation): Promise<WeatherSuccess> {
    if (!dependencies.origin) throw unavailable();
    const token = await dependencies.accessToken();
    if (!token) throw unavailable();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await dependencies.request(`${dependencies.origin}/api/session-weather?sessionId=${encodeURIComponent(sessionId)}`, {
        method: roundId ? "POST" : "GET", signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, ...(roundId ? { "Content-Type": "application/json" } : {}) },
        ...(roundId ? { body: JSON.stringify({ roundId, location }) } : {}),
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("ok" in body) || body.ok !== true) {
        const issue = new Error("Weather is temporarily unavailable.");
        if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 503) Object.assign(issue, { noRetry: true });
        if (body && typeof body === "object" && "retryAt" in body && typeof body.retryAt === "string" && Number.isFinite(Date.parse(body.retryAt))) Object.assign(issue, { retryAt: body.retryAt });
        throw issue;
      }
      const result = body as Record<string, unknown>;
      if (typeof result.enabled !== "boolean" || !Array.isArray(result.readings) || !result.readings.every(reading => isReading(reading, sessionId))
        || result.nextRefreshAt !== null && (typeof result.nextRefreshAt !== "string" || !Number.isFinite(Date.parse(result.nextRefreshAt)))) throw unavailable();
      return result as WeatherSuccess;
    } finally { clearTimeout(timer); }
  }
  return {
    available: !!dependencies.origin,
    load: (sessionId: string) => request(sessionId),
    capture: (sessionId: string, roundId: string, location: ApproximateLocation) => request(sessionId, roundId, location),
  };
}

export const mobileWeatherApi = createWeatherApi({
  origin: weatherApiOrigin(process.env.EXPO_PUBLIC_ARC_TRACK_API_URL, typeof __DEV__ !== "undefined" && __DEV__),
  accessToken: async () => {
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    return error ? null : data.session?.access_token ?? null;
  },
  request: (...args) => fetch(...args),
});

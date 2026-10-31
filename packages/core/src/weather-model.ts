/** Weather is independent of scoring; coordinates and Arrow data are never changed. */
export const WEATHER_REFRESH_MS = 30 * 60 * 1000;
export type WeatherValues = {
  temperatureC: number | null;
  windSpeedKph: number | null;
  windGustKph: number | null;
  windDirectionDegrees: number | null;
  humidityPercent: number | null;
  conditionCode: number | null;
};
export type WeatherSnapshot = WeatherValues & {
  id: string;
  sessionId: string;
  roundId: string | null;
  provider: "open-meteo";
  observedAt: string;
  retrievedAt: string;
};
export type WeatherSuccess = { ok: true; enabled: boolean; readings: WeatherSnapshot[]; nextRefreshAt: string | null };
export type WeatherResponse = WeatherSuccess | { ok: false; message: string; retryAt?: string };
export type ApproximateLocation = { latitude: number; longitude: number };

export function isWeatherDistance(value: unknown): boolean {
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return false;
  if (typeof value !== "string" && typeof value !== "number") return false;
  const distance = Number(value);
  return Number.isInteger(distance) && distance > 0 && distance <= 32767 && distance !== 18;
}

/** The application calendar is Asia/Singapore (UTC+08:00, without DST). */
export function weatherToday(now: number): string {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function canCollectWeather(input: {
  distance: unknown;
  sessionDate: string;
  plannedEnds: number;
  arrowsPerEnd: number;
  arrows: readonly { end: number; arrow: number }[];
}, now: number): boolean {
  if (!isWeatherDistance(input.distance) || input.sessionDate !== weatherToday(now)
    || !Number.isInteger(input.plannedEnds) || input.plannedEnds <= 0
    || !Number.isInteger(input.arrowsPerEnd) || input.arrowsPerEnd <= 0) return false;
  const filled = new Set(input.arrows.filter((item) => Number.isInteger(item.end) && Number.isInteger(item.arrow)
    && item.end >= 1 && item.end <= input.plannedEnds && item.arrow >= 1 && item.arrow <= input.arrowsPerEnd)
    .map((item) => `${item.end}:${item.arrow}`));
  return filled.size < input.plannedEnds * input.arrowsPerEnd;
}

export function approximateLocation(latitude: number, longitude: number): ApproximateLocation {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error("Location is unavailable.");
  return { latitude: Math.round(latitude * 100) / 100, longitude: Math.round(longitude * 100) / 100 };
}

export function compassDirection(degrees: number | null): string {
  if (degrees === null || !Number.isFinite(degrees) || degrees < 0 || degrees > 360) return "—";
  return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(degrees / 22.5) % 16];
}

const conditions: Record<number, string> = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Depositing rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Light freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Light freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Light rain showers", 81: "Rain showers",
  82: "Heavy rain showers", 85: "Light snow showers", 86: "Heavy snow showers", 95: "Thunderstorm",
  96: "Thunderstorm with light hail", 99: "Thunderstorm with hail",
};
export function conditionDescription(code: number | null): string {
  return code === null ? "Conditions unavailable" : conditions[code] ?? "Conditions unavailable";
}

/** Missing measurements remain null. Wrong units or malformed supplied fields are rejected. */
export function parseOpenMeteo(input: unknown, now: number): WeatherValues & { observedAt: string } {
  const invalid = () => new Error("Weather information is unavailable.");
  if (!input || typeof input !== "object") throw invalid();
  const body = input as Record<string, unknown>;
  if (!body.current || typeof body.current !== "object" || !body.current_units || typeof body.current_units !== "object") throw invalid();
  const current = body.current as Record<string, unknown>;
  const units = body.current_units as Record<string, unknown>;
  if (units.time !== "unixtime" || typeof current.time !== "number" || !Number.isFinite(current.time)
    || current.time * 1000 > now + 15 * 60 * 1000 || current.time * 1000 < now - 6 * 60 * 60 * 1000) throw invalid();
  function measurement(name: string, unit: string, min: number, max: number, integer = false): number | null {
    const value = current[name];
    if (value === null || value === undefined) return null;
    if (units[name] !== unit || typeof value !== "number" || !Number.isFinite(value) || value < min || value > max
      || integer && !Number.isInteger(value)) throw invalid();
    return value;
  }
  const conditionCode = measurement("weather_code", "wmo code", 0, 99, true);
  if (conditionCode !== null && !(conditionCode in conditions)) throw invalid();
  return {
    observedAt: new Date(current.time * 1000).toISOString(),
    temperatureC: measurement("temperature_2m", "°C", -100, 70),
    windSpeedKph: measurement("wind_speed_10m", "km/h", 0, 500),
    windGustKph: measurement("wind_gusts_10m", "km/h", 0, 600),
    windDirectionDegrees: measurement("wind_direction_10m", "°", 0, 360),
    humidityPercent: measurement("relative_humidity_2m", "%", 0, 100),
    conditionCode,
  };
}

export type WeatherErrorCode = 'invalid_request' | 'unauthenticated' | 'forbidden' | 'ineligible' | 'database_read' | 'provider_unavailable' | 'provider_rate_limit' | 'provider_response' | 'persistence' | 'configuration' | 'location_denied' | 'location_timeout';
export class WeatherIssue extends Error {
  readonly code:WeatherErrorCode; readonly status:number; readonly noRetry:boolean; readonly retryAt?:string;
  constructor(code:WeatherErrorCode,status:number,noRetry=false,retryAt?:string){super('Weather unavailable');this.code=code;this.status=status;this.noRetry=noRetry;this.retryAt=retryAt;}
}
export function weatherRetryAt(value: string | null, now = Date.now()): string | undefined {
  if (!value) return undefined;
  const due = /^\d+$/.test(value.trim()) ? now + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(due) && due > now ? new Date(Math.min(due, now + 24 * 60 * 60 * 1000)).toISOString() : undefined;
}
export function weatherHttpIssue(status: number, body: unknown, retryAfter: string | null): WeatherIssue {
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const terminal = status >= 400 && status < 500 && status !== 408 && status !== 429;
  const codes: WeatherErrorCode[] = ['invalid_request','unauthenticated','forbidden','ineligible','database_read','provider_unavailable','provider_rate_limit','provider_response','persistence','configuration'];
  const code = codes.includes(data.code as WeatherErrorCode) ? data.code as WeatherErrorCode : status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 429 ? 'provider_rate_limit' : 'provider_unavailable';
  const retryAt = weatherRetryAt(retryAfter) ?? (typeof data.retryAt === 'string' ? weatherRetryAt(data.retryAt) : undefined);
  return new WeatherIssue(code, status, terminal || data.retryable === false, retryAt);
}
export function weatherFailureState<T extends { readings: WeatherSnapshot[] }>(previous: T, error: unknown): T & { status: 'unavailable'; message: string } {
  const code = error instanceof WeatherIssue ? error.code : undefined;
  return { ...previous, readings: code === 'unauthenticated' || code === 'forbidden' ? [] : previous.readings, status: 'unavailable',
    message: code === 'location_denied' ? 'Location permission is unavailable. Check device permissions, then retry.' : code === 'unauthenticated' ? 'Sign in again to load weather.' : 'Weather refresh failed. Saved readings are retained; retry when available.' };
}

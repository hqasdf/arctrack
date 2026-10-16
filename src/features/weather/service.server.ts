import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isWeatherDistance, weatherToday, type WeatherSnapshot, type WeatherSuccess } from "@arc-track/core/weather";
import { getAuthConfig } from "@/lib/auth/config";
import { createAuthClient } from "@/lib/supabase/server";
import { fetchCurrentWeather, weatherProviderConfig } from "./provider.server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isWeatherId = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
export type WeatherIdentity = { client: SupabaseClient; userId: string };

export async function weatherIdentity(request: Request): Promise<WeatherIdentity | null> {
  const config = getAuthConfig();
  if (!config) return null;
  const authorization = request.headers.get("authorization");
  let client: SupabaseClient;
  if (authorization !== null) {
    if (!/^Bearer [^\s]{1,8192}$/.test(authorization)) return null;
    client = createClient(config.url, config.publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  } else client = await createAuthClient();
  const { data, error } = await client.auth.getUser(authorization?.slice(7));
  if (error || !data.user?.email_confirmed_at) return null;
  return { client, userId: data.user.id };
}

function weatherWriter() {
  const config = getAuthConfig();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!config || !secret) return null;
  // Never inherit the caller Authorization header. Only narrow weather RPCs are used.
  return createClient(config.url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

async function ownedSession(identity: WeatherIdentity, sessionId: string) {
  const { data, error } = await identity.client.from("sessions").select("id,session_date")
    .eq("id", sessionId).eq("user_id", identity.userId).maybeSingle();
  if (error || !data) throw new Error("Weather unavailable");
  return data as { id: string; session_date: string };
}

type DbWeather = { id: string; session_id: string; round_id: string | null; observed_at: string; retrieved_at: string;
  temperature_c: number | null; wind_speed_kph: number | null; wind_gust_kph: number | null;
  wind_direction_degrees: number | null; humidity_percent: number | null; condition_code: number | null };
export async function readSessionWeather(identity: WeatherIdentity, sessionId: string): Promise<WeatherSuccess> {
  await ownedSession(identity, sessionId);
  const { data, error } = await identity.client.from("session_weather_snapshots")
    .select("id,session_id,round_id,observed_at,retrieved_at,temperature_c,wind_speed_kph,wind_gust_kph,wind_direction_degrees,humidity_percent,condition_code")
    .eq("session_id", sessionId).order("retrieved_at", { ascending: false }).limit(96);
  // The optional addition must not break Sessions before its separately approved migration.
  if (error) return { ok: true, enabled: false, readings: [], nextRefreshAt: null };
  const readings: WeatherSnapshot[] = ((data ?? []) as DbWeather[]).map(row => ({
    id: row.id, sessionId: row.session_id, roundId: row.round_id, provider: "open-meteo",
    observedAt: row.observed_at, retrievedAt: row.retrieved_at, temperatureC: row.temperature_c,
    windSpeedKph: row.wind_speed_kph, windGustKph: row.wind_gust_kph,
    windDirectionDegrees: row.wind_direction_degrees, humidityPercent: row.humidity_percent, conditionCode: row.condition_code,
  }));
  const writer = weatherWriter();
  const { data: status, error: statusError } = writer ? await writer.rpc("read_session_weather_refresh", { p_user_id: identity.userId, p_session_id: sessionId }).maybeSingle() : { data: null, error: true };
  return { ok: true, enabled: !statusError && !!weatherProviderConfig() && !!process.env.SUPABASE_SECRET_KEY?.trim(), readings,
    nextRefreshAt: statusError ? null : (status as { next_refresh_at: string | null } | null)?.next_refresh_at ?? null };
}

export async function captureSessionWeather(identity: WeatherIdentity, roundId: string, location: { latitude: number; longitude: number }): Promise<WeatherSuccess> {
  const { data, error } = await identity.client.from("session_rounds").select("id,session_id,distance_metres").eq("id", roundId).maybeSingle();
  if (error || !data) throw new Error("Weather unavailable");
  const round = data as { id: string; session_id: string; distance_metres: number };
  const session = await ownedSession(identity, round.session_id);
  if (!isWeatherDistance(round.distance_metres) || session.session_date !== weatherToday(Date.now())) throw new Error("Weather unavailable");
  const writer = weatherWriter();
  if (!writer || !weatherProviderConfig()) return { ok: true, enabled: false, readings: [], nextRefreshAt: null };
  const { data: claimed, error: claimError } = await writer.rpc("claim_session_weather_refresh", { p_user_id: identity.userId, p_round_id: roundId }).single();
  if (claimError || !claimed) throw new Error("Weather unavailable");
  const claim = claimed as { claimed: boolean; claim_id: string | null; session_id: string; next_refresh_at: string | null };
  if (claim.claimed && claim.claim_id) {
    try {
      const values = await fetchCurrentWeather(location);
      const { data: saved, error: saveError } = await writer.rpc("save_session_weather_snapshot", {
        p_user_id: identity.userId, p_round_id: roundId, p_claim_id: claim.claim_id, p_observed_at: values.observedAt,
        p_temperature_c: values.temperatureC, p_wind_speed_kph: values.windSpeedKph, p_wind_gust_kph: values.windGustKph,
        p_wind_direction_degrees: values.windDirectionDegrees, p_humidity_percent: values.humidityPercent, p_condition_code: values.conditionCode,
      });
      if (saveError || saved !== true) throw new Error("Weather unavailable");
    } catch {
      await writer.rpc("release_session_weather_refresh", { p_user_id: identity.userId, p_round_id: roundId, p_claim_id: claim.claim_id });
      throw new Error("Weather unavailable");
    }
  }
  const result = await readSessionWeather(identity, session.id);
  return { ...result, nextRefreshAt: result.nextRefreshAt ?? claim.next_refresh_at };
}

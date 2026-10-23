import "server-only";
import type { GarminConfig } from "./config.server";

// Garmin's OAuth2.0 PKCE Specification, retrieved 23 October 2026.
export const GARMIN_AUTHORIZE = "https://connect.garmin.com/oauth2Confirm";
export const GARMIN_TOKEN = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const USER_URL = "https://apis.garmin.com/wellness-api/rest/user/";
export class GarminError extends Error {
  constructor(public code: string, public reauthorize = false) { super(code); }
}
export type GarminTokens = { accessToken: string; refreshToken: string; accessExpiresAt: string; refreshExpiresAt: string | null; refreshAfter: string };
const text = (value: unknown, maximum = 8192): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum;

export function createGarminProvider(config: GarminConfig, fetcher: typeof fetch = fetch, now = Date.now) {
  async function request(url: string, init: RequestInit, tokenRequest = false) {
    let response: Response;
    try { response = await fetcher(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000) }); }
    catch { throw new GarminError("provider_unavailable"); }
    if (response.ok && init.method === "DELETE") {
      await response.body?.cancel();
      // 202 means accepted, not completed; do not authorize account deletion.
      if (![200, 204].includes(response.status)) throw new GarminError("provider_response");
      return null;
    }
    let body: unknown = null;
    if (response.status !== 204) {
      // Bound provider input and do not include provider bodies in errors or logs.
      if (Number(response.headers.get("content-length")) > 65536) throw new GarminError("provider_response");
      const reader = response.body?.getReader();
      let size = 0;
      const parts: Uint8Array[] = [];
      if (reader) {
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 65536) { await reader.cancel(); throw new GarminError("provider_response"); }
            parts.push(chunk.value);
          }
          body = JSON.parse(Buffer.concat(parts).toString("utf8"));
        } catch (error) {
          if (error instanceof GarminError) throw error;
          if (response.ok) throw new GarminError("provider_response");
        }
      }
    }
    if (!response.ok) {
      const error = body && typeof body === "object" ? (body as Record<string, unknown>).error : null;
      if ((tokenRequest && error === "invalid_grant") || (!tokenRequest && [401, 403].includes(response.status))) throw new GarminError("reauthorization_required", true);
      throw new GarminError(tokenRequest && error === "invalid_client" ? "provider_configuration" : "provider_unavailable");
    }
    return body;
  }
  async function tokens(parameters: Record<string, string>): Promise<GarminTokens> {
    const body = await request(GARMIN_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ ...parameters, client_id: config.clientId, client_secret: config.clientSecret }) }, true);
    if (!body || typeof body !== "object") throw new GarminError("provider_response");
    const data = body as Record<string, unknown>;
    const expiry = (seconds: unknown) => typeof seconds === "number" && Number.isSafeInteger(seconds) && seconds > 0 && Number.isFinite(new Date(now() + seconds * 1000).valueOf());
    if (!text(data.access_token) || !text(data.refresh_token) || typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer" || !expiry(data.expires_in)
      || (data.refresh_token_expires_in !== undefined && !expiry(data.refresh_token_expires_in))) throw new GarminError("provider_response");
    const lifetime = (data.expires_in as number) * 1000;
    return { accessToken: data.access_token, refreshToken: data.refresh_token,
      accessExpiresAt: new Date(now() + lifetime).toISOString(),
      refreshExpiresAt: data.refresh_token_expires_in === undefined ? null : new Date(now() + (data.refresh_token_expires_in as number) * 1000).toISOString(),
      refreshAfter: new Date(now() + lifetime - Math.min(600000, lifetime / 10)).toISOString() };
  }
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: "application/json" });
  return {
    exchange: (code: string, verifier: string) => tokens({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: config.redirectUri }),
    refresh: (token: string) => tokens({ grant_type: "refresh_token", refresh_token: token }),
    async identity(token: string) {
      const body = await request(`${USER_URL}id`, { headers: bearer(token) });
      const id = body && typeof body === "object" ? (body as Record<string, unknown>).userId : null;
      if (!text(id, 512)) throw new GarminError("provider_response");
      return id;
    },
    async permissions(token: string) {
      const body = await request(`${USER_URL}permissions`, { headers: bearer(token) });
      if (!Array.isArray(body) || body.length > 100 || !body.every(value => text(value, 128))) throw new GarminError("provider_response");
      return [...new Set(body)] as string[];
    },
    async revoke(token: string) { await request(`${USER_URL}registration`, { method: "DELETE", headers: bearer(token) }); },
  };
}

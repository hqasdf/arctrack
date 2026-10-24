import "server-only";
import { cookies } from "next/headers";
import { createAuthClient } from "@/lib/supabase/server";
import { getGarminConfig, mayConnectGarmin, type GarminConfig } from "./config.server";
import { configuredGarminService } from "./service.server";
import { GarminError } from "./provider.server";

const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const failure = (status: number) => Response.json({ error: "Garmin connection unavailable. Please try again." }, { status, headers });
const nonce = (value: string | null | undefined): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
function sameOrigin(request: Request, config: GarminConfig) {
  const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  // Arc Track's no-referrer policy makes native POST forms send Origin: null.
  // Accept that case only with the browser's forbidden-to-script same-origin
  // Fetch Metadata header; opaque/cross-site and same-site initiators are denied.
  return new URL(request.url).origin === config.appOrigin
    && (origin === config.appOrigin ? site !== "cross-site" : origin === "null" && site === "same-origin");
}
async function identity() {
  try {
    const client = await createAuthClient({ writable: true });
    const { data, error } = await client.auth.getUser();
    return error ? null : data.user?.id ?? null;
  } catch { return null; }
}
function back(config: GarminConfig, code: string) {
  const url = new URL("/health", config.appOrigin);
  url.searchParams.set("garmin", code);
  return new Response(null, { status: 303, headers: { ...headers, Location: url.href } });
}
const safeCode = (error: unknown) => error instanceof GarminError && ["invalid_transaction", "invalid_callback", "cancelled", "busy", "already_connected", "account_mismatch", "provider_configuration", "provider_unavailable", "reauthorization_required", "account_deletion_pending", "deregistration_failed", "rotation_uncertain", "deregistration_recovery_required"].includes(error.code) ? error.code : "connection_error";
async function bindingCookie(config: GarminConfig, value: string, maxAge: number) {
  (await cookies()).set(config.cookieName, value, { httpOnly: true, secure: config.secure, sameSite: "lax", path: "/api/integrations/garmin", maxAge });
}

export async function garminStart(request: Request) {
  const config = getGarminConfig();
  if (!config) return failure(503);
  if (!sameOrigin(request, config)) return failure(403);
  const userId = await identity();
  if (!userId) return failure(401);
  if (!mayConnectGarmin(userId)) return failure(403);
  try {
    const result = await configuredGarminService()!.start(userId);
    await bindingCookie(config, result.binding, 600);
    return new Response(null, { status: 303, headers: { ...headers, Location: result.url } });
  } catch (error) { return back(config, safeCode(error)); }
}

export async function garminCallback(request: Request) {
  const config = getGarminConfig();
  if (!config) return failure(503);
  const url = new URL(request.url);
  if (url.origin !== config.appOrigin) return failure(400);
  const parameters = url.searchParams;
  if (["state", "code", "error"].some(key => parameters.getAll(key).length > 1)) return back(config, "invalid_callback");
  const state = parameters.get("state"), code = parameters.get("code"), error = parameters.get("error");
  const binding = (await cookies()).get(config.cookieName)?.value;
  if (!nonce(state) || !nonce(binding) || (code !== null && (!code.length || code.length > 4096)) || (code !== null && error !== null)) return back(config, "invalid_transaction");
  const userId = await identity();
  if (!userId) return back(config, "sign_in_required");
  if (!mayConnectGarmin(userId)) {
    await bindingCookie(config, "", 0);
    return failure(403);
  }
  try {
    await configuredGarminService()!.callback(userId, state, binding, code, error !== null);
    await bindingCookie(config, "", 0);
    return back(config, "connected");
  } catch (failure) {
    const code = safeCode(failure);
    if (code !== "invalid_transaction") await bindingCookie(config, "", 0);
    return back(config, code);
  }
}

export async function garminStatus() {
  const userId = await identity();
  if (!userId) return failure(401);
  try {
    const service = configuredGarminService();
    return service ? Response.json(await service.status(userId), { headers }) : failure(503);
  } catch { return failure(503); }
}

export async function garminDisconnect(request: Request) {
  const config = getGarminConfig();
  if (!config) return failure(503);
  if (!sameOrigin(request, config)) return failure(403);
  const userId = await identity();
  if (!userId) return failure(401);
  try {
    const result = await configuredGarminService()!.disconnect(userId);
    await bindingCookie(config, "", 0);
    return back(config, result.warning ? "revocation_unconfirmed" : "disconnected");
  } catch (error) { return back(config, safeCode(error)); }
}

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin.server";
import { getAuthConfig } from "@/lib/auth/config";
import { identity, sameOrigin } from "../http.server";
import { configuredGarminService } from "../service.server";
import { GarminError } from "../provider.server";
import { garminHealthEnabled, garminHealthTestUsers } from "./config.server";
import type { GarminHealthControl } from "./types";

type Action = "delete" | "pause" | "resume";
type Proof = { version: string; authorizedAt: string | null };
type Command = { action: Action; generation: string; requestId: string; confirm?: boolean };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
async function command(request: Request): Promise<Command | null> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > 2048) { await reader.cancel(); return null; }
      parts.push(next.value);
    }
    const value = JSON.parse(Buffer.concat(parts).toString("utf8")) as Record<string, unknown>;
    if (!value || !["delete", "pause", "resume"].includes(String(value.action)) || !uuid(value.generation) || !uuid(value.requestId)
      || value.action === "delete" && value.confirm !== true) return null;
    return value as unknown as Command;
  } catch { return null; } finally { reader.releaseLock(); }
}

export function createHealthControlHandler(options: {
  origin: string | null; owner: () => Promise<string | null>; canResume: (userId: string) => boolean;
  verify: (userId: string) => Promise<Proof>;
  control: (userId: string, command: Command, proof?: Proof) => Promise<GarminHealthControl>;
}) {
  return async (request: Request): Promise<Response> => {
    const failure = (status: number, error: string) => Response.json({ error }, { status, headers });
    if (!options.origin) return failure(503, "Health controls are unavailable.");
    if (!sameOrigin(request, { appOrigin: options.origin })) return failure(403, "Please use Health settings in Arc Track.");
    const userId = await options.owner();
    if (!userId) return failure(401, "Sign in again before changing Health settings.");
    const input = await command(request);
    if (!input) return failure(400, "Confirm the action and refresh Health before retrying.");
    if (input.action === "resume" && !options.canResume(userId)) return failure(403, "Health synchronization is not enabled for this account. Your data remains paused.");
    try {
      const proof = input.action === "resume" ? await options.verify(userId) : undefined;
      const control = await options.control(userId, input, proof);
      return Response.json({ control }, { headers });
    } catch (error) {
      if (error instanceof GarminError) return failure(409, error.code === "permissions_required"
        ? "Grant Garmin Health and Activity permissions before resuming. Your data remains paused."
        : "Garmin authorization could not be verified. Refresh or reconnect Garmin before resuming.");
      return failure(409, "The action could not be confirmed. Refresh Health and retry; no success has been confirmed.");
    }
  };
}
export async function garminHealthControl(request: Request) {
  return createHealthControlHandler({ origin: getAuthConfig()?.appUrl ?? null, owner: identity,
    canResume: userId => garminHealthEnabled() && garminHealthTestUsers().includes(userId),
    verify: async userId => {
      const service = configuredGarminService();
      if (!service) throw new GarminError("provider_configuration");
      return service.verifyHealthAuthorization(userId);
    },
    control: async (userId, input, proof) => {
      const { data, error } = await createAdminClient().rpc("control_garmin_health", { p_user_id: userId, p_action: input.action,
        p_generation: input.generation, p_request_id: input.requestId, p_connection_version: proof?.version ?? null,
        p_authorized_at: proof?.authorizedAt ?? null });
      if (error || !data || typeof data.paused !== "boolean" || !uuid(data.generation)) throw new Error("Health control unavailable.");
      return data as GarminHealthControl;
    } })(request);
}

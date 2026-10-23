import "server-only";
import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { garminHealthEnabled, garminHealthTestUsers } from "./config.server";
import { normalizeGarminPush, GarminHealthPayloadError } from "./normalize.server";
import { createGarminHealthInbox, type GarminHealthInbox } from "./store.server";

const MAX_BYTES = 1048576;
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const response = (status: number) => new Response(null, { status, headers });

// No undocumented signature, shared header or public client ID is treated as proof.
// The current official PDFs do not define incoming notification authentication.
// Wire a reviewed, documented verifier here only after that provider contract is obtained.
export type GarminNotificationVerifier = (request: Request, bytes: Uint8Array) => Promise<boolean>;
export function configuredGarminNotificationVerifier(): GarminNotificationVerifier | null { return null; }

export function createGarminPushReceiver(options: {
  enabled: boolean; verifier: GarminNotificationVerifier | null; allowedUsers: string[];
  inbox: () => GarminHealthInbox; schedule: (work: () => Promise<void>) => void;
}) {
  return async (request: Request): Promise<Response> => {
    if (!options.enabled || !options.verifier || !options.allowedUsers.length) return response(503);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return response(415);
    if (request.headers.get("content-encoding") && request.headers.get("content-encoding") !== "identity") return response(415);
    const length = request.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) return response(413);
    const reader = request.body?.getReader();
    if (!reader) return response(400);
    const buffer = new Uint8Array(MAX_BYTES);
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (size + chunk.value.byteLength > MAX_BYTES) { await reader.cancel(); return response(413); }
        buffer.set(chunk.value, size);
        size += chunk.value.byteLength;
      }
      const bytes = buffer.subarray(0, size);
      if (!await options.verifier(request, bytes)) return response(401);
      let payload: unknown;
      try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return response(400); }
      const events = normalizeGarminPush(payload);
      const inbox = options.inbox();
      await inbox.stage(events, options.allowedUsers);
      // Only receipt validation + durable staging precede 200, not domain processing.
      // after() is opportunistic. The durable inbox + authenticated worker are the retry path.
      try { options.schedule(async () => { try { await inbox.process(options.allowedUsers, 25); } catch { /* Queue remains pending; worker retries. Never log health payloads. */ } }); } catch { /* Staged receipt survives scheduling failure. */ }
      return response(200);
    } catch (error) {
      return response(error instanceof GarminHealthPayloadError ? 400 : 503);
    } finally { reader.releaseLock(); }
  };
}

export function garminHealthPush(request: Request): Promise<Response> {
  return createGarminPushReceiver({ enabled: garminHealthEnabled(), verifier: configuredGarminNotificationVerifier(),
    allowedUsers: garminHealthTestUsers(), inbox: createGarminHealthInbox, schedule: after })(request);
}

export function createGarminHealthWorker(options: { enabled: boolean; verifierReady: boolean; secret: string | undefined; users: string[]; inbox: () => GarminHealthInbox }) {
  return async (request: Request): Promise<Response> => {
    if (!options.enabled || !options.verifierReady || !options.secret || options.secret.length < 32 || !options.users.length) return response(503);
    const provided = request.headers.get("authorization") ?? "";
    const expected = Buffer.from(`Bearer ${options.secret}`), received = Buffer.from(provided);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return response(401);
    try { await options.inbox().process(options.users, 50); return response(200); }
    catch { return response(503); }
  };
}
export function garminHealthWorker(request: Request): Promise<Response> {
  return createGarminHealthWorker({ enabled: garminHealthEnabled(), verifierReady: configuredGarminNotificationVerifier() !== null,
    secret: process.env.CRON_SECRET, users: garminHealthTestUsers(), inbox: createGarminHealthInbox })(request);
}

import "server-only";
import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { garminHealthEnabled } from "./config.server";
import { createGarminPushReceiver } from "./http.server";
import { createGarminHealthInbox } from "./store.server";

const validSecret = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const deny = (status: number) => new Response(null, { status, headers: {
  "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
} });

export function createPrivateGarminPushReceiver(options: Omit<Parameters<typeof createGarminPushReceiver>[0], "verifier"> & { secret: string | undefined }) {
  // This application-defined capability proves URL possession, NOT Garmin identity.
  // The reusable receiver still applies every existing size/schema/inbox safeguard.
  const receive = createGarminPushReceiver({ ...options, verifier: async () => true });
  return async (request: Request, provided: string | undefined): Promise<Response> => {
    if (!options.enabled || !validSecret(options.secret)) return deny(503);
    const wellFormed = validSecret(provided);
    const matches = timingSafeEqual(Buffer.from(options.secret, "hex"), Buffer.from(wellFormed ? provided : "0".repeat(64), "hex"));
    // Authenticate before reading the body or creating a database client.
    if (!wellFormed || !matches) return deny(401);
    return receive(request);
  };
}

export function privateGarminHealthPush(request: Request, secret: string): Promise<Response> {
  // Vercel records actual request paths before this handler. This URL-capability
  // experiment must not become a production ingress through an environment toggle.
  if (process.env.NODE_ENV === "production") return Promise.resolve(deny(503));
  return createPrivateGarminPushReceiver({ enabled: garminHealthEnabled(), secret: process.env.GARMIN_HEALTH_WEBHOOK_SECRET,
    inbox: createGarminHealthInbox, schedule: after })(request, secret);
}

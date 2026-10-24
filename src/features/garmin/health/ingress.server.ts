import "server-only";
import { after } from "next/server";
import { createPrivateGarminPushReceiver } from "./private-push.server";
import { garminHealthEnabled } from "./config.server";
import { createGarminHealthInbox } from "./store.server";

// Arc Track's independent server-to-server authentication, NOT a Garmin signature.
export function createGarminIngressReceiver(options: Parameters<typeof createPrivateGarminPushReceiver>[0]) {
  const receive = createPrivateGarminPushReceiver(options);
  return (request: Request) => receive(request, /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") ?? "")?.[1]);
}
export function garminHealthIngress(request: Request) {
  return createGarminIngressReceiver({ enabled: garminHealthEnabled(), secret: process.env.GARMIN_HEALTH_INGRESS_KEY,
    inbox: createGarminHealthInbox, schedule: after })(request);
}

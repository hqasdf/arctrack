import "server-only";
import { mayConnectGarmin } from "../config.server";

export function garminHealthEnabled(): boolean { return process.env.GARMIN_HEALTH_ENABLED === "true"; }
export function garminHealthTestUsers(): string[] {
  // Reuse the existing strict OAuth allowlist validation; no wildcard or separate user list.
  return [...new Set((process.env.GARMIN_TEST_USER_IDS ?? "").split(",").map((id) => id.trim()).filter((id) => mayConnectGarmin(id)))];
}

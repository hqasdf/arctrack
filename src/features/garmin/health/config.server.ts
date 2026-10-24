import "server-only";
export function garminHealthEnabled(): boolean {
  return process.env.GARMIN_HEALTH_ENABLED === "true"
    && process.env.GARMIN_HEALTH_PRIVACY_READY === "true"
    && process.env.GARMIN_HEALTH_INGRESS_READY === "true"
    && /^[a-f0-9]{64}$/.test(process.env.GARMIN_HEALTH_INGRESS_KEY ?? "")
    && !!process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 32
    && process.env.CRON_SECRET !== process.env.GARMIN_HEALTH_INGRESS_KEY;
}

import "server-only";
export function garminHealthEnabled(): boolean {
  return process.env.GARMIN_HEALTH_ENABLED === "true" && garminHealthTestUsers().length > 0
    && process.env.GARMIN_HEALTH_PRIVACY_READY === "true"
    && process.env.GARMIN_HEALTH_INGRESS_READY === "true"
    && /^[a-f0-9]{64}$/.test(process.env.GARMIN_HEALTH_INGRESS_KEY ?? "")
    && !!process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 32
    && process.env.CRON_SECRET !== process.env.GARMIN_HEALTH_INGRESS_KEY;
}
export function garminHealthTestUsers(): string[] {
  // Independent pilot cohort. This never restricts public OAuth authorization.
  const values = (process.env.GARMIN_HEALTH_TEST_USER_IDS ?? "").split(",").map(value => value.trim());
  if (!values.length || values.length > 20 || values.some(value => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))) return [];
  return [...new Set(values)];
}

import "server-only";
export function garminHealthEnabled(): boolean {
  return process.env.GARMIN_HEALTH_ENABLED === "true" && garminHealthTestUsers().length > 0;
}
export function garminHealthTestUsers(): string[] {
  // Public OAuth does not authorize health ingestion. No ingestion cohort is
  // approved until sender authentication and separate sync activation are reviewed.
  return [];
}

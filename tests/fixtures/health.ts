import { dateBefore } from "../../src/features/health/model";
import type { HealthDataset } from "../../src/features/health/types";

// Fixed, fictional measurements. Never call a database or provider from this fixture.
export function createHealthFixture(): HealthDataset {
  const days = Array.from({ length: 30 }, (_, index) => {
    const sleepMinutes = 420 + ((index * 17) % 75);
    const deep = 72 + index % 15;
    const rem = 90 + index % 20;
    return {
      date: dateBefore("2026-10-23", 29 - index), sleepMinutes,
      sleepScore: null, sleepScoreQualifier: null, sleepStartedAt: null, sleepEndedAt: null, sleepValidation: null, sleepAwakeMinutes: null,
      sleepStages: index === 25 ? null : { light: sleepMinutes - deep - rem, deep, rem, awake: 15 + index % 12 },
      restingHeartRate: 52 + index % 7, stress: 22 + index % 19,
      steps: 6200 + ((index * 431) % 5200), bodyBattery: 65 + index % 23,
      activityMinutes: 20 + ((index * 13) % 65),
    };
  });
  days[29] = { ...days[29], sleepMinutes: 462, sleepStages: { light: 270, deep: 84, rem: 108, awake: 19 }, restingHeartRate: 54, stress: 28, steps: 8432, bodyBattery: 78, activityMinutes: 64 };
  return {
    kind: "stored", days, lastSyncedAt: null,
    activities: [
      { id: "demo-1", type: "Walking", startedAt: "2026-10-23T00:15:00Z", durationMinutes: 34, averageHeartRate: 105, distanceKm: 2.6, source: "garmin" },
      { id: "demo-2", type: "Strength", startedAt: "2026-10-22T10:00:00Z", durationMinutes: 45, averageHeartRate: 118, distanceKm: null, source: "garmin" },
      { id: "demo-3", type: "Running", startedAt: "2026-10-21T23:00:00Z", durationMinutes: 32, averageHeartRate: 142, distanceKm: 5, source: "garmin" },
      { id: "demo-4", type: "Cycling", startedAt: "2026-10-20T09:30:00Z", durationMinutes: 58, averageHeartRate: 129, distanceKm: 18.4, source: "garmin" },
      { id: "demo-5", type: "Walking", startedAt: "2026-10-18T00:00:00Z", durationMinutes: 28, averageHeartRate: null, distanceKm: 2.1, source: "garmin" },
    ],
  };
}

"use client";
export default function AthleteTrainingPlanError({ reset }: { error: Error; reset: () => void }) {
  return <div role="alert"><p>Your Training Plan could not be loaded.</p><button type="button" onClick={reset}>Try again</button></div>;
}

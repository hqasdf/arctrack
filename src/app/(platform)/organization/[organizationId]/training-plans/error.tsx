"use client";
export default function TrainingPlansError({ reset }: { error: Error; reset: () => void }) {
  return <div role="alert"><p>Training Plans could not be loaded.</p><button type="button" onClick={reset}>Try again</button></div>;
}

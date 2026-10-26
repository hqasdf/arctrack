"use client";

import styles from "@/features/health/components/health.module.css";

export default function HealthError({ reset }: { reset: () => void }) {
  return <section className={styles.dashboard} role="alert"><h1>Health overview unavailable</h1><p className={styles.muted}>We could not load this view. Your scoring and other Arc Track features are unaffected.</p><button type="button" className={styles.textButton} onClick={reset}>Try again</button></section>;
}

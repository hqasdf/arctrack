import styles from "@/features/health/components/health.module.css";

export default function HealthLoading() {
  return <div className={styles.dashboard} aria-busy="true" role="status"><h1 className={styles.loadingHeading}>Loading your Health overview…</h1><div className={styles.metrics}>{[0, 1, 2, 3, 4].map((index) => <div className={styles.skeleton} key={index} />)}</div><div className={styles.chartGrid}>{[0, 1, 2].map((index) => <div className={styles.skeleton} key={index} />)}</div></div>;
}

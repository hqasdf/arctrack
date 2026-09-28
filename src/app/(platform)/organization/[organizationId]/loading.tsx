import styles from "@/features/organizations/components/coach.module.css";

export default function CoachWorkspaceLoading() {
  return <div className={styles.workspace} role="status" aria-live="polite">
    <div className={styles.heading}>
      <p className={styles.eyebrow}>Head Coach</p>
      <h1>Loading workspace…</h1>
    </div>
  </div>;
}

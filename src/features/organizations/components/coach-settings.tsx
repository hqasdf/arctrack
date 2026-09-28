"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { leaveOrganization, regenerateJoinCode } from "../actions";
import type { OwnOrganization } from "../read.server";
import { athleteName, type CoachAthlete } from "../coach-model";
import styles from "./organization.module.css";
import coachStyles from "./coach.module.css";

export function CoachSettings({ organization, athletes }: { organization: OwnOrganization; athletes: CoachAthlete[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function copy() { if (!organization.joinCode) return; try { await navigator.clipboard.writeText(organization.joinCode); setMessage("Join code copied."); } catch { setMessage("Select the code to copy it."); } }
  async function regenerate() {
    if (!window.confirm(`Regenerate the join code for ${organization.name}? The old code will stop working.`)) return;
    setPending(true); setMessage(null);
    const result = await regenerateJoinCode(organization.id);
    setPending(false); setMessage(result.ok ? `New code: ${result.data}` : result.message);
    if (result.ok) router.refresh();
  }
  async function leave() {
    if (!window.confirm(`Leave ${organization.name}? Coach access will end immediately.`)) return;
    setPending(true); setMessage(null);
    const result = await leaveOrganization(organization.id);
    setPending(false);
    if (result.ok) router.replace("/organization"); else setMessage(result.message);
  }
  return <div className={`${styles.workspace} ${coachStyles.settingsWorkspace}`}>
    {message && <p role="status" className={styles.message}>{message}</p>}
    <section className={styles.panel}><h2>Organisation information</h2><p>{organization.name} · Head Coach</p><p>{athletes.length} active Archers</p></section>
    <section className={styles.panel}><h2>Membership</h2><p>Active Archer members visible to Head Coaches.</p>{athletes.length ? <ul className={styles.organizationList}>{athletes.map((athlete) => <li key={athlete.userId}><Link href={`/organization/${organization.id}/athletes/${athlete.userId}`}>{athleteName(athlete)}</Link><span>Archer · Joined {athlete.joinedAt.slice(0, 10)}</span></li>)}</ul> : <p>No active Archers yet.</p>}</section>
    <section className={styles.panel}><h2>Membership and Join Code</h2><p>Share the current code with athletes. Regenerating it invalidates the previous code.</p>
      {organization.joinCode ? <><label className={styles.codeLabel}><span>Join code</span><input readOnly value={organization.joinCode} onFocus={(event) => event.target.select()}/></label><div className={styles.codeActions}><button type="button" onClick={copy}>Copy Code</button><button type="button" disabled={pending} onClick={regenerate}>Generate New Code</button></div></> : <p>Join code is unavailable.</p>}
    </section>
    <section className={styles.panel}><h2>Your membership</h2><p>Leaving ends your Coach access to this organisation. The organisation and athlete Sessions remain.</p><button type="button" disabled={pending} onClick={leave}>Leave organisation</button></section>
  </div>;
}

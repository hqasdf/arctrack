"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { leaveOrganization } from "../actions";
import type { OwnOrganization } from "../read.server";
import styles from "./organization.module.css";

export function MemberWorkspace({ organization }: { organization: OwnOrganization }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function leave() {
    if (!window.confirm(`Leave ${organization.name}?`)) return;
    setPending(true); setError(null);
    const result = await leaveOrganization(organization.id);
    setPending(false);
    if (result.ok) { router.replace("/organization"); router.refresh(); }
    else setError(result.message);
  }
  return <section className={styles.panel}>
    <h2>Your membership</h2>
    <p>You are an active Archer in {organization.name}.</p>
    {error ? <p role="alert">{error}</p> : null}
    <button className={styles.secondary} type="button" disabled={pending} onClick={leave}>Leave organisation</button>
  </section>;
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createOrganization, joinOrganization } from "../actions";
import type { OwnOrganization } from "../read.server";
import styles from "./organization.module.css";

export function OrganizationWorkspace({ organizations }: { organizations: OwnOrganization[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showJoin, setShowJoin] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage(null);
    const result = await createOrganization({ name });
    setPending(false);
    if (!result.ok) { setMessage(result.message); return; }
    setName(""); router.replace(`/organization/${result.data.id}`);
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage(null);
    const result = await joinOrganization(code);
    setPending(false);
    if (!result.ok) { setMessage(result.message); return; }
    setCode(""); setShowJoin(false);
    if (result.data.organizationId) router.replace(result.data.role === "head_coach"
      ? `/organization/${result.data.organizationId}` : `/organization/member/${result.data.organizationId}`);
    else router.replace("/organization");
  }

  return <div className={styles.workspace}>
    {message && <p role="status" className={styles.message}>{message}</p>}
    <section className={styles.panel}>
      <h2>Your organisations</h2>
      {organizations.length === 0 ? <p>You have not joined an organisation yet.</p> :
        <ul className={styles.organizationList}>{organizations.map((item) => <li key={item.id}>
          <div className={styles.organizationIdentity}><strong>{item.name}</strong><span>{item.role === "head_coach" ? "Head Coach" : "Archer"} · Active</span></div>
          {item.role === "head_coach" && <div className={styles.organizationActions}><Link className={styles.coachCta} href={`/organization/${item.id}`}>Open Coach&apos;s Workspace</Link><Link href={`/organization/${item.id}/settings`}>Settings</Link></div>}
          {item.role !== "head_coach" && <div className={styles.organizationActions}><Link href={`/organization/member/${item.id}`}>Open membership</Link></div>}
        </li>)}</ul>}
    </section>
    {organizations.length > 0 && !showJoin ? <button className={styles.secondary} type="button" onClick={() => setShowJoin(true)}>Join another organisation</button> : null}
    {(organizations.length === 0 || showJoin) && <section className={styles.panel}>
      <h2>Join an organisation</h2>
      <form className={styles.form} onSubmit={handleJoin}>
        <label><span>Join code</span><input required maxLength={16} autoCapitalize="characters" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} placeholder="AB7K4M2Q"/></label>
        <button className={styles.primary} type="submit" disabled={pending}>{pending ? "Joining…" : "Join"}</button>
      </form>
    </section>}
    {organizations.length > 0 && !showCreate ? <button className={styles.secondary} type="button" onClick={() => setShowCreate(true)}>Create another workspace</button> : null}
    {(organizations.length === 0 || showCreate) && <section className={styles.panel}>
      <h2>Create an organisation</h2>
      <p>You become its first Head Coach.</p>
      <form className={styles.form} onSubmit={handleCreate}>
        <label><span>Organisation name</span><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Club or team name"/></label>
        <button className={styles.primary} type="submit" disabled={pending}>{pending ? "Saving…" : "Create organisation"}</button>
      </form>
    </section>}
  </div>;
}

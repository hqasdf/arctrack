"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import type { OwnOrganization } from "../read.server";
import styles from "./coach.module.css";

export function CoachNavigation({ organizationId, name, workspaces }: { organizationId: string; name: string; workspaces: OwnOrganization[] }) {
  const path = usePathname();
  const base = `/organization/${organizationId}`;
  const items = [
    { label: "Overview", href: base, icon: "target" }, { label: "Athletes", href: `${base}/athletes`, icon: "profile" },
    { label: "Reviews", href: `${base}/reviews`, icon: "sessions" }, { label: "Analytics", href: `${base}/analytics`, icon: "analytics" },
    { label: "Settings", href: `${base}/settings`, icon: "organization" },
  ] as const;
  return <><header className={styles.workspaceHeader}><div><span>Coach&apos;s Workspace</span><strong>{name}</strong></div>
    {workspaces.length > 1 ? <details className={styles.workspaceSwitcher}><summary>Switch workspace</summary><ul>{workspaces.filter((item) => item.id !== organizationId).map((item) => <li key={item.id}><Link href={`/organization/${item.id}`}>{item.name}</Link></li>)}<li><Link href="/organization?manage=1">Manage memberships</Link></li></ul></details> : <Link className={styles.workspaceManage} href="/organization?manage=1">Add workspace</Link>}
  </header><nav className={styles.coachNav} aria-label={`${name} sections`}>{items.map((item) => {
    const active = item.href === base ? path === base : path === item.href || path.startsWith(`${item.href}/`);
    return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}><Icon name={item.icon} size={17}/><span>{item.label}</span></Link>;
  })}</nav></>;
}

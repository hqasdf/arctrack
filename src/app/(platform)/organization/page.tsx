import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { organizationEntry } from "@arc-track/core/organization-entry";
import { requireUser } from "@/lib/auth/session.server";
import { OrganizationWorkspace } from "@/features/organizations/components/organization-workspace";
import { readOwnOrganizations } from "@/features/organizations/read.server";
import styles from "@/styles/pages.module.css";

export const metadata: Metadata = { title: "Coach's Workspace" };

export default async function OrganizationPage({ searchParams }: { searchParams: Promise<{ manage?: string }> }) {
  await requireUser();
  const { manage } = await searchParams;
  const organizations = await readOwnOrganizations();
  const entry = organizationEntry(organizations);
  if (manage !== "1" && entry.kind === "coach") redirect(`/organization/${entry.organizationId}`);
  if (manage !== "1" && entry.kind === "member") redirect(`/organization/member/${entry.organizationId}`);
  const coachOrganizations = organizations.filter((item) => item.role === "head_coach");
  return <>
    <div className={styles.intro}>
      <p className={styles.eyebrow}>Your team</p>
      <h1>Coach&apos;s Workspace</h1>
      <p>{coachOrganizations.length > 1 ? "Choose a workspace." : organizations.length ? "Your organisation memberships." : "Join a team with a code or create a workspace."}</p>
    </div>
    <OrganizationWorkspace organizations={organizations}/>
  </>;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoachSettings } from "@/features/organizations/components/coach-settings";
import { readCoachAthletes, requireCoachOrganization } from "@/features/organizations/coach-read.server";
import { readOwnOrganizations } from "@/features/organizations/read.server";
import styles from "@/features/organizations/components/coach.module.css";

export const metadata: Metadata = { title: "Organisation Settings" };
export default async function CoachSettingsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  await requireCoachOrganization(organizationId);
  const [organizations, athletes] = await Promise.all([readOwnOrganizations(true), readCoachAthletes(organizationId)]);
  const organization = organizations.find((item) => item.id === organizationId && item.role === "head_coach");
  if (!organization) notFound();
  return <div className={styles.workspace}><header className={styles.heading}><p className={styles.eyebrow}>Head Coach · Administration</p><h1>Settings</h1></header><CoachSettings organization={organization} athletes={athletes}/></div>;
}

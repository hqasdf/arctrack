import { notFound } from "next/navigation";
import Link from "next/link";
import { readOwnOrganizations } from "@/features/organizations/read.server";
import { AthleteInvitations } from '@/features/live-coaching/athlete-invitations';
import { MemberWorkspace } from "@/features/organizations/components/member-workspace";
import styles from "@/features/organizations/components/organization.module.css";

export default async function MemberPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const memberships = await readOwnOrganizations();
  const organization = memberships.find((item) => item.id === organizationId && item.role === "archer");
  if (!organization) notFound();
  return <div className={styles.workspace}>
    <Link href="/organization?manage=1">Manage memberships</Link>
    <header><p>Organisations</p><h1>{organization.name}</h1><p>Archer membership</p></header>
    <MemberWorkspace organization={organization}/>
    <AthleteInvitations organizationId={organizationId} key={organizationId}/>
  </div>;
}

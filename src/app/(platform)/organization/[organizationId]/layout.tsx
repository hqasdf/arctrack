import { CoachNavigation } from "@/features/organizations/components/coach-navigation";
import { requireCoachOrganization } from "@/features/organizations/coach-read.server";
import { readOwnOrganizations } from "@/features/organizations/read.server";
import styles from "@/features/organizations/components/coach.module.css";

export default async function CoachLayout({ children, params }: { children: React.ReactNode; params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const [organization, memberships] = await Promise.all([requireCoachOrganization(organizationId), readOwnOrganizations()]);
  return <div className={styles.coachShell}>
    <CoachNavigation organizationId={organizationId} name={organization.name} workspaces={memberships.filter((item) => item.role === "head_coach")}/>
    <div className={styles.coachContent}>{children}</div>
  </div>;
}

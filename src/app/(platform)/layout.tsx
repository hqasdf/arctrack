import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session.server";

import { readOwnOrganizations } from "@/features/organizations/read.server";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireUser();

  const memberships = await readOwnOrganizations().catch(() => []);
  return <AppShell authenticated coachAccess={memberships.some(item => item.role === "head_coach")}>{children}</AppShell>;
}

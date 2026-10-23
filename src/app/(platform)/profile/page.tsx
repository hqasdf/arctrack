import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session.server";
import { createAuthClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/features/profile/components/profile-form";
import { AccountCard } from "@/features/profile/components/account-card";
import { GarminConnectionCard } from "@/features/garmin/components/garmin-connection-card";
import { readGarminStatus } from "@/features/garmin/service.server";
import profileStyles from "@/features/profile/components/profile.module.css";
import type { ProfileDetails } from "@/features/profile/validation";
import styles from "@/styles/pages.module.css";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ garmin?: string | string[] }> }) {
  const user = await requireUser();
  const parameters = await searchParams;
  const garminPromise = readGarminStatus(user.id);
  let profile: ProfileDetails | null = null;
  try {
    const supabase = await createAuthClient();
    const { data, error } = await supabase.from("profiles")
      .select("display_name, club_or_team, division, shooting_hand, experience_level")
      .eq("id", user.id).maybeSingle();
    if (!error) profile = data;
  } catch {
    // Keep provider details private; preserve navigation so the user can retry.
  }
  const garmin = await garminPromise;

  return (
    <>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>Your account</p>
        <h1>Your profile.</h1>
        <p>A little about you and your archery.</p>
      </div>
      <div className={profileStyles.layout}>
        <div className={profileStyles.cards}>
          <AccountCard email={user.email ?? ""} pendingEmail={user.new_email ?? null} />
          <GarminConnectionCard initialStatus={garmin} notice={typeof parameters.garmin === "string" ? parameters.garmin : undefined} />
          {profile ? <ProfileForm profile={profile} /> : (
            <p role="alert">Your profile could not be loaded. Please refresh the page to try again.</p>
          )}
        </div>
      </div>
    </>
  );
}

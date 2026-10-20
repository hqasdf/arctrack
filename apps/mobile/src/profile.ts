import { mobileAuthentication, supabase } from "./supabase";
import { safeAuthMessage } from "./auth-flow";
import { EMPTY_PROFILE, validateMobileProfile, type MobileProfile } from "./profile-model";
export { DIVISIONS, SHOOTING_HANDS, EXPERIENCE_LEVELS, EMPTY_PROFILE, validateMobileProfile } from "./profile-model";
export type { MobileProfile } from "./profile-model";
export async function readMobileProfile(userId: string): Promise<MobileProfile> {
  if (!supabase) throw new Error("Profile is unavailable.");
  const { data, error } = await supabase.from("profiles")
    .select("display_name,club_or_team,division,shooting_hand,experience_level")
    .eq("id", userId).maybeSingle();
  if (error) throw new Error("Profile could not be loaded.");
  return data ?? EMPTY_PROFILE;
}
export async function saveMobileProfile(userId: string, input: MobileProfile): Promise<MobileProfile> {
  if (!supabase) throw new Error("Profile saving is unavailable.");
  const profile = validateMobileProfile(input);
  const { data, error } = await supabase.from("profiles").update(profile).eq("id", userId)
    .select("display_name,club_or_team,division,shooting_hand,experience_level").maybeSingle();
  if (error || !data) throw new Error("Profile could not be saved.");
  return data;
}
export async function changeMobilePassword(password: string, confirmation: string) {
  if (!supabase) throw new Error("Password update is unavailable.");
  if (password.length < 12 || password.length > 128) throw new Error("Choose a password between 12 and 128 characters.");
  if (password !== confirmation) throw new Error("Passwords do not match.");
  const { error } = await mobileAuthentication!.updateUser({ password });
  if (error) throw new Error(safeAuthMessage(error, "password"));
}

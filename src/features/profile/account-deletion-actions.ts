"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { getAuthConfig } from "@/lib/auth/config";
import { createAuthClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin.server";

export async function deleteAccount(
  _previous: { status: string; message: string },
  form: FormData,
): Promise<{ status: "error" | "success"; message: string }> {
  const password = form.get("password");
  if (form.get("confirmation") !== "DELETE" || typeof password !== "string" || !password || password.length > 128) {
    return { status: "error", message: "Enter your current password and type DELETE to confirm." };
  }
  try {
    const supabase = await createAuthClient({ writable: true });
    const { data: identity, error: identityError } = await supabase.auth.getUser();
    const user = identity.user;
    if (identityError || !user?.email || !user.email_confirmed_at) {
      return { status: "error", message: "Sign in with your confirmed Arc Track account before requesting deletion." };
    }
    // The email comes from verified Auth identity, never from the submitted form.
    const config = getAuthConfig();
    if (!config) return { status: "error", message: "Account deletion is temporarily unavailable. Please try again later." };
    // Reauthentication must not replace the browser's existing cookies/session.
    const verifier = createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    try {
      const { data: verified, error: verificationError } = await verifier.auth.signInWithPassword({ email: user.email, password });
      if (verificationError || verified.user?.id !== user.id || !verified.session) {
        return { status: "error", message: "Your account could not be verified. Check your current password and try again." };
      }
      // This is the only deletion boundary; ordinary clients have no deletion RPC.
      const admin = createAdminClient();
      const { error } = await admin.auth.admin.deleteUser(user.id, false);
      if (error) {
        return { status: "error", message: "Your account was not deleted. Please try again later." };
      }
    } finally {
      // Revoke the temporary verification session, including after a failed deletion.
      try { await verifier.auth.signOut({ scope: "local" }); } catch { /* Never expose native/provider errors. */ }
    }
    // Auth deletion has already committed. A cleanup failure must not misreport it.
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* Auth no longer exists; retry via sign-out if needed. */ }
  } catch {
    return { status: "error", message: "Account deletion could not be completed. Please try again later." };
  }
  revalidatePath("/", "layout");
  return { status: "success", message: "Your Arc Track account and its owned saved records have been deleted. Other signed-in devices will lose access when their account or session is checked again." };
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthPanel } from "@/features/auth/components/auth-panel";
import { readIdentity } from "@/lib/auth/session.server";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata(
  "/sign-in",
  "Sign In to Your Archery Training Journal",
  "Sign in to Arc Track to record archery Sessions, score Rounds, review shooting performance and follow your Training Plans.",
);
const notices: Record<string, string> = {
  "invalid-link":
    "This link is invalid or has expired. Open the latest email in the browser where you requested it, or request a fresh password reset.",
  "signed-out": "You are signed out on this browser.",
  unavailable:
    "We could not verify your account right now. Please try again shortly.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { user } = await readIdentity();
  if (user) redirect("/sessions");
  const { status } = await searchParams;
  const notice =
    typeof status === "string" && Object.hasOwn(notices, status)
      ? notices[status]
      : undefined;
  return (
    <AuthPanel
      mode="sign-in"
      title="Welcome back."
      description="Arc Track is your archery training journal. Record Sessions, score Rounds, review shooting performance and follow your Training Plans."
      notice={notice}
    >
      <Link href="/forgot-password">Forgot your password?</Link>
      <Link href="/sign-up">New here? Create an account</Link>
    </AuthPanel>
  );
}

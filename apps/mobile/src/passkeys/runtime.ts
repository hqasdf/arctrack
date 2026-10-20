import { mobileAuthentication, supabase } from "../supabase";
import { assertPasskeysAllowed, PASSKEY_RELYING_PARTY_ID } from "./feature";
import { observePasskeyInvalidation } from "./lifecycle";
import { createApplicationPasskeyProvider } from "./provider";
import type { PasskeyOwnerSession } from "./service";
import { createDeviceCredentialState } from "./credential-state";
import { deviceCredentialStorage } from "./credential-storage";
import { createNativePasskeyAdapter } from "./native-adapter";
import { createPreparedPasskeyService } from "./service";

// Gesture-only entry point. No startup/native work occurs while feature gates are
// disabled; the same authority used by password/OTP owns final acceptance.
export async function signInWithPasskey() {
  assertPasskeysAllowed();
  if (!mobileAuthentication) throw Error("Biometric Sign-In is unavailable.");
  const attempt = await mobileAuthentication.beginPasskey();
  const service = createPreparedPasskeyService({
    environment: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "",
      publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "",
      relyingPartyId: PASSKEY_RELYING_PARTY_ID, assertAllowed: assertPasskeysAllowed,
    },
    native: createNativePasskeyAdapter(), currentOwner: () => null,
    isCurrent: attempt.isCurrent,
    adoptVerifiedSession: async session => { await attempt.accept(session); },
    ownsAdoptedSession: attempt.owns,
  });
  try { return await service.authenticate(); }
  finally { service.dispose(); await attempt.abandon(); }
}

// Called only by the gated Profile control. The borrowed owner tokens stay in
// memory, never become a second persisted session and are never refreshed here.
export function createPasskeyManagement(ownerId: string) {
  assertPasskeysAllowed();
  let owner: PasskeyOwnerSession | null = null, generation = 0, disposed = false;
  const provider = createApplicationPasskeyProvider({
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "",
    publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "",
    currentOwner: () => owner,
  });
  const deviceState = createDeviceCredentialState({
    scope: { ownerId, supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "", relyingPartyId: PASSKEY_RELYING_PARTY_ID },
    storage: deviceCredentialStorage, server: provider,
    revision: () => generation, isCurrent: () => !disposed && owner !== null,
  });
  const invalidate = () => { generation++; owner = null; provider.invalidate(); };
  const unsubscribe = observePasskeyInvalidation(invalidate);
  async function prepare() {
    assertPasskeysAllowed();
    if (!supabase || disposed) throw Error("Biometric Sign-In is unavailable.");
    const request = generation;
    const result = await supabase.auth.getSession();
    if (request !== generation || disposed) throw Error("Device authentication operation was abandoned.");
    const session = result.data.session;
    if (result.error || session?.user.id !== ownerId) throw Error("Sign in before managing Biometric Sign-In.");
    owner = { userId: ownerId, accessToken: session.access_token, refreshToken: session.refresh_token };
  }
  return {
    async list() { await prepare(); return provider.list(); },
    async readState() { await prepare(); return deviceState.reconcile(); },
    async register() { await prepare(); return deviceState.register(); },
    async remove(id: string) { await prepare(); return deviceState.remove(id); },
    invalidate,
    dispose() { disposed = true; invalidate(); unsubscribe(); provider.dispose(); },
  };
}

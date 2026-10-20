// Locally activated for controlled Android testing. Publishing this source and
// Play-signed physical-device validation remain separate release steps.
export const PASSKEY_FEATURE_ENABLED: boolean = true;
export const PASSKEY_REGISTRATION_READY: boolean = true;
export const PASSKEY_SESSION_ADOPTION_READY: boolean = true;
export const PASSKEY_RELYING_PARTY_ID: string = "archery-website.vercel.app";

export function canShowBiometricSignIn(): boolean {
  return PASSKEY_FEATURE_ENABLED && PASSKEY_SESSION_ADOPTION_READY && !!PASSKEY_RELYING_PARTY_ID;
}

export function canShowBiometricSignInSetting(): boolean {
  return canShowBiometricSignIn() && PASSKEY_REGISTRATION_READY;
}

export function assertPasskeysAllowed(): void {
  if (!canShowBiometricSignInSetting()) throw Error("Biometric Sign-In is not available yet.");
}

// Code gates, not environment-variable switches. Production configuration,
// device validation and safe persistent session adoption require separate review.
export const PASSKEY_FEATURE_ENABLED: boolean = false;
export const PASSKEY_REGISTRATION_READY: boolean = false;
export const PASSKEY_SESSION_ADOPTION_READY: boolean = false;
// Intentionally unset: an RP domain has not been approved.
export const PASSKEY_RELYING_PARTY_ID: string = "";

export function canShowBiometricSignIn(): boolean {
  return PASSKEY_FEATURE_ENABLED && PASSKEY_SESSION_ADOPTION_READY && !!PASSKEY_RELYING_PARTY_ID;
}

export function canShowBiometricSignInSetting(): boolean {
  return canShowBiometricSignIn() && PASSKEY_REGISTRATION_READY;
}

export function assertPasskeysAllowed(): void {
  if (!canShowBiometricSignInSetting()) throw Error("Biometric Sign-In is not available yet.");
}

// Local Logcat diagnostics only: never send request/response objects or arbitrary
// messages to this sink. Fixed stages and allowlisted codes contain no identity.
const stages = [
  "registration_started", "registration_error", "registration_options_started",
  "registration_options_success", "registration_options_error", "registration_rp_error",
  "native_options_error", "native_bridge_error", "native_create_started",
  "native_create_success", "native_create_error", "native_prompt_returned",
  "native_prompt_error", "native_response_success", "native_response_error",
  "verification_started", "verification_success", "verification_error",
  "enrollment_refresh_started", "enrollment_refresh_success",
  "enrollment_storage_started", "enrollment_storage_success", "enrollment_success", "enrollment_error",
] as const;
export type RegistrationStage = typeof stages[number];
const codes = new Set([
  "BadConfiguration", "NoCreateOption", "CredentialAlreadyExists", "UserCancelled",
  "RequestFailed", "Interrupted", "TimedOut", "NotConfigured", "NotSupported",
  "InvalidChallenge", "InvalidUserId", "UnknownError", "Unknown error", "Native error",
  "cancelled", "unsupported", "unavailable", "invalid_request", "invalid_response", "native_error",
  "blocked", "authentication_required", "stale", "server_error",
  "webauthn_verification_failed", "webauthn_challenge_expired", "webauthn_challenge_not_found",
  "webauthn_credential_exists", "too_many_passkeys", "session_expired", "bad_jwt",
]);
export function registrationDiagnostic(stage: RegistrationStage, error?: unknown,
  write: (tag: string, message: string) => void = console.info): void {
  // Diagnostics must never change authentication outcomes, even if a logger fails.
  try {
    if (!(stages as readonly string[]).includes(stage)) return;
    const value = error !== null && typeof error === "object" ? error as Record<string, unknown> : {};
    const candidate = value.error ?? value.code;
    const code = typeof candidate === "string" && codes.has(candidate) ? candidate : "unclassified";
    const status = typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599
      ? value.status : undefined;
    write("[ARC_PASSKEY]", JSON.stringify({ stage, ...(error === undefined ? {} : { code }), ...(status === undefined ? {} : { status }) }));
  } catch { /* Logging must not interrupt registration or suppress its error. */ }
}

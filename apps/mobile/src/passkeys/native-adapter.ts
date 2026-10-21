import { Platform } from "react-native";
import { nativeAuthPrompt } from "../auth-native-prompt";
import { registrationDiagnostic } from "./registration-diagnostics.ts";
import type { PasskeyAuthenticationOptionsResponse, PasskeyRegistrationOptionsResponse,
  VerifyPasskeyAuthenticationParams, VerifyPasskeyRegistrationParams } from "@supabase/supabase-js";
import type { PasskeyCreateRequest, PasskeyGetRequest } from "react-native-passkey";

export type RegistrationOptions = PasskeyRegistrationOptionsResponse["options"];
export type AuthenticationOptions = PasskeyAuthenticationOptionsResponse["options"];
export type RegistrationCredential = Extract<VerifyPasskeyRegistrationParams["credential"], {
  response: { attestationObject: string };
}>;
export type AuthenticationCredential = Extract<VerifyPasskeyAuthenticationParams["credential"], {
  response: { signature: string };
}>;
export type NativePasskeyErrorCode = "cancelled" | "unsupported" | "unavailable" |
  "invalid_request" | "invalid_response" | "native_error";
const messages: Record<NativePasskeyErrorCode, string> = {
  cancelled: "Passkey request cancelled.",
  unsupported: "Passkeys are not supported on this device.",
  unavailable: "Passkeys are unavailable. Use your password to sign in.",
  invalid_request: "The passkey request is invalid.",
  invalid_response: "The device returned an invalid passkey response.",
  native_error: "The passkey request could not be completed. Use your password to sign in.",
};
export class NativePasskeyError extends Error {
  readonly code: NativePasskeyErrorCode;
  constructor(code: NativePasskeyErrorCode) {
    super(messages[code]);
    this.name = "NativePasskeyError";
    this.code = code;
  }
}
export interface NativePasskeyAdapter {
  /** Basic OS support only; does not assert provider, enrollment or association. */
  isSupported(): boolean;
  create(options: RegistrationOptions): Promise<RegistrationCredential>;
  get(options: AuthenticationOptions): Promise<AuthenticationCredential>;
}
type NativeBridge = {
  isSupported(): boolean;
  create(options: PasskeyCreateRequest): Promise<unknown>;
  get(options: PasskeyGetRequest): Promise<unknown>;
};
type AdapterDependencies = {
  loadNative?: () => Promise<{ Passkey: NativeBridge }>;
  platform?: { os: string; version: string | number };
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const encoded = (value: unknown): value is string => text(value) && /^[A-Za-z0-9_-]+$/.test(value) && value.length % 4 !== 1;
const policy = (value: unknown) => value === undefined || ["required", "preferred", "discouraged"].includes(String(value));
function fail(code: NativePasskeyErrorCode): never { throw new NativePasskeyError(code); }
function rpId(value: unknown): value is string {
  if (!text(value) || value.length > 253 || /^\d+(\.\d+)*$/.test(value)) return false;
  return value.split(".").every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}
function descriptors(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(item => record(item) &&
    item.type === "public-key" && encoded(item.id) &&
    (item.transports === undefined || (Array.isArray(item.transports) && item.transports.every(text)))));
}
function validateOptions(value: unknown, kind: "create" | "get") {
  if (!record(value) || !encoded(value.challenge) || !policy(value.userVerification) ||
      (value.timeout !== undefined && (typeof value.timeout !== "number" || !Number.isFinite(value.timeout) || value.timeout <= 0)) ||
      (value.extensions !== undefined && !record(value.extensions))) fail("invalid_request");
  if (kind === "get") {
    if (!rpId(value.rpId) || !descriptors(value.allowCredentials)) fail("invalid_request");
    return;
  }
  if (!record(value.rp) || !rpId(value.rp.id) || !text(value.rp.name) ||
      !record(value.user) || !encoded(value.user.id) || !text(value.user.name) || !text(value.user.displayName) ||
      !Array.isArray(value.pubKeyCredParams) || !value.pubKeyCredParams.length ||
      !value.pubKeyCredParams.every(item => record(item) && item.type === "public-key" && Number.isSafeInteger(item.alg)) ||
      !descriptors(value.excludeCredentials)) fail("invalid_request");
  if (value.authenticatorSelection !== undefined) {
    const selection = value.authenticatorSelection;
    if (!record(selection) || !policy(selection.userVerification) || !policy(selection.residentKey) ||
        (selection.requireResidentKey !== undefined && typeof selection.requireResidentKey !== "boolean") ||
        (selection.authenticatorAttachment !== undefined && !["platform", "cross-platform"].includes(String(selection.authenticatorAttachment)))) {
      fail("invalid_request");
    }
  }
}
function normalizeResponse(value: unknown, kind: "create"): RegistrationCredential;
function normalizeResponse(value: unknown, kind: "get"): AuthenticationCredential;
function normalizeResponse(value: unknown, kind: "create" | "get"): RegistrationCredential | AuthenticationCredential {
  if (!record(value) || !encoded(value.id) || !record(value.response) ||
      (value.type !== undefined && value.type !== "public-key") ||
      (value.rawId !== undefined && value.rawId !== value.id) ||
      (value.clientExtensionResults !== undefined && !record(value.clientExtensionResults)) ||
      (value.authenticatorAttachment !== undefined && !["platform", "cross-platform"].includes(String(value.authenticatorAttachment)))) {
    fail("invalid_response");
  }
  const response = { ...value.response };
  const required = kind === "create" ? ["clientDataJSON", "attestationObject"] : ["clientDataJSON", "authenticatorData", "signature"];
  if (required.some(key => !encoded(response[key]))) fail("invalid_response");
  if (response.userHandle === null) delete response.userHandle;
  if (response.userHandle !== undefined && !encoded(response.userHandle)) fail("invalid_response");
  // Reconcile structural SDK defaults without decoding, reencoding or modifying
  // signed response strings. Only the server verifies the assertion.
  return { ...value, id: value.id, rawId: value.rawId ?? value.id, type: "public-key",
    clientExtensionResults: value.clientExtensionResults ?? {}, response } as unknown as RegistrationCredential | AuthenticationCredential;
}
function safeError(value: unknown): NativePasskeyError {
  if (value instanceof NativePasskeyError) return value;
  const code = record(value) ? value.error ?? value.code : undefined;
  if (["UserCancelled", "AbortError", "NotAllowedError"].includes(String(code))) return new NativePasskeyError("cancelled");
  if (code === "NotSupported") return new NativePasskeyError("unsupported");
  if (["NoCredentials", "NoCreateOption", "NotConfigured", "Interrupted", "TimedOut"].includes(String(code))) return new NativePasskeyError("unavailable");
  if (["InvalidChallenge", "InvalidUserId", "BadConfiguration", "CredentialAlreadyExists"].includes(String(code))) return new NativePasskeyError("invalid_request");
  // Never expose arbitrary native messages, URLs or account data to the UI.
  return new NativePasskeyError("native_error");
}
export function createNativePasskeyAdapter({
  loadNative = () => import("react-native-passkey"),
  platform = { os: Platform.OS, version: Platform.Version },
}: AdapterDependencies = {}): NativePasskeyAdapter {
  // Android only until the separate iOS native validation is complete.
  const isSupported = () => platform.os === "android" && Number(platform.version) >= 28;
  let loaded: Promise<{ Passkey: NativeBridge }> | undefined;
  async function bridge() {
    if (!isSupported()) fail("unsupported");
    let loadedModule: { Passkey: NativeBridge };
    try { loadedModule = await (loaded ??= loadNative()); }
    catch { loaded = undefined; return fail("unavailable"); }
    if (!loadedModule?.Passkey || !loadedModule.Passkey.isSupported()) fail("unavailable");
    return loadedModule.Passkey;
  }
  return {
    isSupported,
    async create(options) {
      try { validateOptions(options, "create"); }
      catch (error) { registrationDiagnostic("native_options_error", error); throw error; }
      let native: NativeBridge;
      try { native = await bridge(); }
      catch (error) { registrationDiagnostic("native_bridge_error", error); throw safeError(error); }
      let response: unknown;
      try {
        response = await nativeAuthPrompt.run(async () => {
          registrationDiagnostic("native_create_started");
          try {
            const result = await native.create(options as PasskeyCreateRequest);
            // This marks Passkey.create() resolution, before the foreground guard
            // or our response validation. It does not claim server enrollment.
            registrationDiagnostic("native_create_success");
            return result;
          } catch (error) { registrationDiagnostic("native_create_error", error); throw error; }
        });
        registrationDiagnostic("native_prompt_returned");
      } catch (error) { registrationDiagnostic("native_prompt_error", error); throw safeError(error); }
      try {
        const credential = normalizeResponse(response, "create");
        registrationDiagnostic("native_response_success");
        return credential;
      }
      catch (error) { registrationDiagnostic("native_response_error", error); throw safeError(error); }
    },
    async get(options) {
      validateOptions(options, "get");
      try {
        const native = await bridge();
        return normalizeResponse(await nativeAuthPrompt.run(() => native.get(options as PasskeyGetRequest)), "get");
      }
      catch (error) { throw safeError(error); }
    },
  };
}

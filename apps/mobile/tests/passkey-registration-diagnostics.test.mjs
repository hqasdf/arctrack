import assert from "node:assert/strict";
import test from "node:test";
import { registrationDiagnostic } from "../src/passkeys/registration-diagnostics.ts";

test("registration diagnostics emit only a fixed stage, allowlisted code and HTTP status", () => {
  const records = [];
  registrationDiagnostic("verification_error", { code: "webauthn_verification_failed", status: 400,
    message: "private-user@example.invalid", details: "secret attestation", challenge: "secret challenge",
    credential: { id: "private credential", clientDataJSON: "secret", attestationObject: "secret" },
    access_token: "secret access token" }, (...args) => records.push(args));
  assert.deepEqual(records, [["[ARC_PASSKEY]", JSON.stringify({ stage: "verification_error", code: "webauthn_verification_failed", status: 400 })]]);
});

test("unknown and malicious codes, statuses and stages cannot inject private content into diagnostics", () => {
  const records = [], write = (_tag, value) => records.push(JSON.parse(value));
  registrationDiagnostic("native_create_error", { error: "private-user@example.invalid", status: "token" }, write);
  registrationDiagnostic("verification_error", { code: { toString() { throw Error("must not coerce"); } }, status: 123456 }, write);
  registrationDiagnostic("private-stage-token", { code: "RequestFailed" }, write);
  assert.deepEqual(records, [{ stage: "native_create_error", code: "unclassified" }, { stage: "verification_error", code: "unclassified" }]);
});

test("native codes remain distinguishable without forwarding native messages", () => {
  for (const code of ["BadConfiguration", "RequestFailed", "CredentialAlreadyExists", "UserCancelled", "NoCreateOption", "Interrupted", "TimedOut"]) {
    let captured;
    registrationDiagnostic("native_create_error", { error: code, message: "do not print" }, (_tag, value) => { captured = JSON.parse(value); });
    assert.deepEqual(captured, { stage: "native_create_error", code });
  }
});

test("diagnostic sink failures and hostile error getters never change registration behaviour", () => {
  assert.doesNotThrow(() => registrationDiagnostic("native_create_success", undefined, () => { throw Error("logger unavailable"); }));
  assert.doesNotThrow(() => registrationDiagnostic("native_create_error", { get error() { throw Error("private"); } }));
});

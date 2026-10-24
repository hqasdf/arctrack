import "server-only";
import { hashState, oauthNonce, pkceChallenge, pkceVerifier, seal, unseal } from "./crypto.server";
import { type GarminConfig, getGarminConfig, mayConnectGarmin } from "./config.server";
import { createGarminProvider, GARMIN_AUTHORIZE, GarminError, type GarminTokens } from "./provider.server";
import { createGarminStore, GarminStorageError, type GarminStore } from "./store.server";
import type { GarminConnection, GarminView } from "./types";

type Secrets = { accessToken: string; refreshToken: string };
const erased = { token_ciphertext: null, access_expires_at: null, refresh_expires_at: null, refresh_after: null };
export const emptyGarminView = (available: boolean): GarminView => ({ available, canConnect: false, status: "disconnected", permissions: [], authorizedAt: null, checkedAt: null, expiresAt: null, error: null });

export function createGarminService(config: GarminConfig, store: GarminStore, fetcher: typeof fetch = fetch, now = Date.now, eligible = mayConnectGarmin) {
  const provider = createGarminProvider(config, fetcher, now);
  const timestamp = () => new Date(now()).toISOString();
  const purpose = (userId: string) => `tokens:${userId}`;
  const secret = (row: GarminConnection) => unseal<Secrets>(row.token_ciphertext!, config.encryptionKey, purpose(row.user_id));
  const tokenFields = (userId: string, tokens: GarminTokens) => ({
    token_ciphertext: seal({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }, config.encryptionKey, purpose(userId)),
    access_expires_at: tokens.accessExpiresAt, refresh_expires_at: tokens.refreshExpiresAt, refresh_after: tokens.refreshAfter,
  });
  async function recover(row: GarminConnection) {
    if (row.deletion_requested_at) return row;
    if (!row.operation || !row.lease_until || Date.parse(row.lease_until) >= now()) return row;
    // Interrupted rotation may have consumed the old refresh token. Never claim it is healthy.
    const patch = row.operation === "disconnect"
      ? { status: "error" as const, error_code: "deregistration_failed" }
      : row.operation === "refresh" || row.operation === "exchange" || row.operation === "authorize"
        ? { status: "reauthorization_required" as const, error_code: "interrupted_authorization" }
        : {};
    await store.finish(row, patch, true);
    return await store.read(row.user_id);
  }
  async function fresh(row: GarminConnection): Promise<GarminConnection> {
    // Status reads must not erase evidence of an uncertain remote deregistration.
    if (["deregistration_failed", "deregistration_recovery_required", "revocation_pending", "revocation_unconfirmed"].includes(row.error_code ?? "")) return row;
    if (row.deletion_requested_at || row.operation || row.error_code === "rotation_uncertain" || !row.token_ciphertext || !row.refresh_after || Date.parse(row.refresh_after) > now()) return row;
    const lease = await store.claim(row, "refresh", 90);
    if (!lease) return (await store.read(row.user_id)) ?? row;
    let rotating = false;
    try {
      if (lease.refresh_expires_at && Date.parse(lease.refresh_expires_at) <= now()) throw new GarminError("reauthorization_required", true);
      await store.checkpoint(lease, { error_code: "rotation_pending" });
      rotating = true;
      const tokens = await provider.refresh(secret(lease).refreshToken);
      await store.checkpoint(lease, tokenFields(row.user_id, tokens));
      rotating = false;
      // Verify the refreshed credentials still identify the linked Garmin account.
      if (await provider.identity(tokens.accessToken) !== lease.garmin_user_id) throw new GarminError("account_mismatch", true);
      await store.finish(lease, { ...tokenFields(row.user_id, tokens), status: "connected", checked_at: timestamp(), error_code: null });
    } catch (error) {
      const denied = !(error instanceof GarminError) || error.reauthorize;
      await store.finish(lease, { status: denied ? "reauthorization_required" : "error", checked_at: timestamp(), error_code: rotating ? "rotation_uncertain" : error instanceof GarminError && error.code === "account_mismatch" ? "account_mismatch" : denied ? "reauthorization_required" : "provider_unavailable" });
    }
    return (await store.read(row.user_id)) ?? row;
  }
  function view(row: GarminConnection | null): GarminView {
    if (!row) return emptyGarminView(true);
    const busy = row.operation === "authorize" || row.operation === "exchange" || row.operation === "refresh";
    const valid = row.status === "connected" && !!row.token_ciphertext && !!row.access_expires_at && Date.parse(row.access_expires_at) > now();
    return { available: true, canConnect: !row.deletion_requested_at && eligible(row.user_id), status: row.deletion_requested_at ? "error" : row.operation === "disconnect" ? "disconnecting" : busy ? "connecting" : valid ? "connected" : row.status === "connected" ? "reauthorization_required" : row.status,
      permissions: row.permissions, authorizedAt: row.authorized_at, checkedAt: row.checked_at, expiresAt: row.access_expires_at, error: row.deletion_requested_at ? "account_deletion_pending" : row.error_code };
  }
  async function deregister(lease: GarminConnection) {
    let phase = "deregistration_failed";
    try {
      let tokens = secret(lease);
      if (!lease.access_expires_at || Date.parse(lease.access_expires_at) <= now()) {
        phase = "rotation_uncertain";
        if (lease.refresh_expires_at && Date.parse(lease.refresh_expires_at) <= now()) throw new GarminError("deregistration_recovery_required");
        await store.checkpoint(lease, { error_code: "rotation_pending" });
        const refreshed = await provider.refresh(tokens.refreshToken);
        // Preserve rotation durably BEFORE another remote call can fail or time out.
        lease = await store.checkpoint(lease, { ...tokenFields(lease.user_id, refreshed), error_code: null });
        tokens = refreshed;
      }
      phase = "deregistration_failed";
      if (await provider.identity(tokens.accessToken) !== lease.garmin_user_id) throw new GarminError("account_mismatch");
      await store.checkpoint(lease, { error_code: "revocation_pending" });
      await provider.revoke(tokens.accessToken);
      if (!await store.finish(lease, { ...erased, status: "disconnected", garmin_user_id: null, permissions: [], connected_at: null,
        authorized_at: null, checked_at: timestamp(), deregistered_at: timestamp(), error_code: null })) throw new GarminStorageError();
    } catch (error) {
      const code = error instanceof GarminError && (error.reauthorize || ["deregistration_recovery_required", "account_mismatch"].includes(error.code))
        ? "deregistration_recovery_required" : phase;
      await store.finish(lease, { status: "error", error_code: code });
      throw new GarminError(code);
    }
  }
  return {
    async verifyHealthAuthorization(userId: string) {
      let row = await store.read(userId);
      if (row) row = await recover(row);
      if (row) row = await fresh(row);
      if (!row || row.status !== "connected" || row.operation || row.deletion_requested_at || row.error_code
        || !row.token_ciphertext || !row.access_expires_at || Date.parse(row.access_expires_at) <= now()) throw new GarminError("reauthorization_required");
      const lease = await store.claim(row, "refresh", 90);
      if (!lease) throw new GarminError("busy");
      try {
        const access = secret(lease).accessToken;
        if (await provider.identity(access) !== lease.garmin_user_id) throw new GarminError("account_mismatch");
        const permissions = await provider.permissions(access);
        if (!permissions.includes("HEALTH_EXPORT") || !permissions.includes("ACTIVITY_EXPORT")) {
          if (!await store.finish(lease, { permissions, checked_at: timestamp() })) throw new GarminError("busy");
          throw new GarminError("permissions_required");
        }
        const verifiedAt = timestamp();
        if (!await store.finish(lease, { permissions, checked_at: verifiedAt })) throw new GarminError("busy");
        const verified = await store.read(userId);
        if (!verified || verified.operation || verified.status !== "connected" || verified.error_code || verified.deletion_requested_at
          || verified.checked_at !== verifiedAt || verified.authorized_at !== lease.authorized_at || verified.garmin_user_id !== lease.garmin_user_id) throw new GarminError("busy");
        return { version: verified.version, authorizedAt: verified.authorized_at };
      } catch (error) {
        await store.finish(lease, {});
        throw error;
      }
    },
    async status(userId: string) {
      let row = await store.read(userId);
      if (row) row = await recover(row);
      if (row && ["connected", "error"].includes(row.status)) row = await fresh(row);
      return row ? view(row) : { ...emptyGarminView(true), canConnect: eligible(userId) };
    },
    async start(userId: string) {
      if (!eligible(userId)) throw new GarminError("access_unavailable");
      const existing = await recover(await store.initialize(userId));
      if (!existing) throw new GarminError("connection_error");
      const lease = await store.claim(existing, "authorize", 600);
      if (!lease) throw new GarminError("busy");
      const state = oauthNonce(), binding = oauthNonce(), verifier = pkceVerifier();
      try {
        await store.saveTransaction({ user_id: userId, state_hash: hashState(state), binding_hash: hashState(binding),
          verifier_ciphertext: seal(verifier, config.encryptionKey, `verifier:${userId}:${hashState(state)}`),
          connection_version: lease.version, redirect_uri: config.redirectUri, expires_at: new Date(now() + 600000).toISOString() });
      } catch { await store.finish(lease, {}); throw new GarminError("connection_error"); }
      const url = new URL(GARMIN_AUTHORIZE);
      url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri,
        code_challenge: pkceChallenge(verifier), code_challenge_method: "S256", state }).toString();
      return { url: url.href, binding };
    },
    async callback(userId: string, state: string, binding: string, code: string | null, denied: boolean) {
      if (!eligible(userId)) throw new GarminError("access_unavailable");
      const transaction = await store.consume(userId, hashState(state), hashState(binding));
      if (!transaction || transaction.redirect_uri !== config.redirectUri) throw new GarminError("invalid_transaction");
      const row = await store.read(userId);
      if (!row || row.version !== transaction.connection_version) throw new GarminError("invalid_transaction");
      const lease = await store.claim(row, "exchange", 90, true);
      if (!lease) throw new GarminError("invalid_transaction");
      if (!eligible(userId)) { await store.finish(lease, {}); throw new GarminError("access_unavailable"); }
      if (denied || !code) { await store.finish(lease, {}); throw new GarminError(denied ? "cancelled" : "invalid_callback"); }
      try {
        const verifier = unseal<string>(transaction.verifier_ciphertext, config.encryptionKey, `verifier:${userId}:${hashState(state)}`);
        const tokens = await provider.exchange(code, verifier);
        const garminId = await provider.identity(tokens.accessToken);
        if (lease.garmin_user_id && lease.garmin_user_id !== garminId) throw new GarminError("account_mismatch");
        const permissions = await provider.permissions(tokens.accessToken);
        // Check+commit under the lease/version: stale callbacks cannot overwrite a disconnect/reconnect.
        const saved = await store.finish(lease, { ...tokenFields(userId, tokens), garmin_user_id: garminId,
          permissions, status: "connected", connected_at: lease.connected_at ?? timestamp(), authorized_at: timestamp(), checked_at: timestamp(), error_code: null });
        if (!saved) throw new GarminError("invalid_transaction");
      } catch (error) {
        await store.finish(lease, { status: "reauthorization_required", error_code: "exchange_uncertain" });
        throw new GarminError(error instanceof GarminStorageError && error.duplicate ? "already_connected" : error instanceof GarminError ? error.code : "connection_error");
      }
    },
    async disconnect(userId: string) {
      let row = await store.read(userId);
      if (!row) return { warning: false };
      row = await recover(row);
      if (!row) return { warning: false };
      if (row.deletion_requested_at) throw new GarminError("account_deletion_pending");
      if (row.status === "disconnected" && !row.token_ciphertext && !row.operation) return { warning: row.error_code === "revocation_unconfirmed" };
      const lease = await store.claim(row, "disconnect", 90);
      if (!lease) throw new GarminError("busy");
      await store.invalidate(userId, row.version);
      if (!lease.token_ciphertext) {
        await store.finish(lease, { status: "error", error_code: "deregistration_recovery_required" });
        throw new GarminError("deregistration_recovery_required");
      }
      await deregister(lease);
      return { warning: false };
    },
    deregisterForDeletion: deregister,
  };
}

// Called ONLY after the existing account-deletion identity/password checks.
// Initialize even a never-linked account so Connect cannot race an absence check.
export async function prepareGarminAccountDeletion(userId: string, store: GarminStore = createGarminStore(), config: GarminConfig | null = getGarminConfig(), fetcher: typeof fetch = fetch, now = Date.now) {
  const row = await store.initialize(userId);
  if (row.deletion_requested_at && row.deregistered_at && !row.token_ciphertext && row.status === "disconnected") return;
  if (row.operation && row.lease_until && Date.parse(row.lease_until) > now()) throw new GarminError("busy");
  if (row.operation && row.operation !== "delete" && row.lease_until && Date.parse(row.lease_until) <= now()) throw new GarminError("deregistration_recovery_required");
  if (["interrupted_authorization", "exchange_uncertain", "rotation_pending", "rotation_uncertain", "revocation_unconfirmed"].includes(row.error_code ?? "")) throw new GarminError("deregistration_recovery_required");
  const lease = await store.claim(row, "delete", 90);
  if (!lease) throw new GarminError("busy");
  await store.invalidate(userId, row.version);
  if (!lease.token_ciphertext && !lease.garmin_user_id && lease.status === "disconnected" && !lease.error_code) {
    if (!await store.finish(lease, { deregistered_at: new Date(now()).toISOString() })) throw new GarminStorageError();
    return;
  }
  if (!lease.token_ciphertext || !lease.garmin_user_id || !config) {
    await store.finish(lease, { status: "error", error_code: !config ? "provider_configuration" : "deregistration_recovery_required" });
    throw new GarminError(!config ? "provider_configuration" : "deregistration_recovery_required");
  }
  await createGarminService(config, store, fetcher, now).deregisterForDeletion(lease);
}

export function configuredGarminService() {
  const config = getGarminConfig();
  return config ? createGarminService(config, createGarminStore()) : null;
}
export async function readGarminStatus(userId: string): Promise<GarminView> {
  try { return await configuredGarminService()?.status(userId) ?? { ...emptyGarminView(false), status: "error", error: "unavailable" }; }
  catch { return { ...emptyGarminView(false), status: "error", error: "unavailable" }; }
}

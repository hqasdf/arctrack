import { createClient, type PasskeyListItem, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { NativePasskeyAdapter } from "./native-adapter";

export class PreparedPasskeyError extends Error {
  constructor(public readonly code: "blocked" | "adoption_disabled" | "authentication_required" | "stale" |
    "server_error" | "invalid_response" | "not_found" | "cleanup_failed") {
    super(code === "adoption_disabled" ? "Passkey session adoption is not enabled." : "The device authentication operation could not complete.");
    this.name = "PreparedPasskeyError";
  }
}

export type PasskeyOwnerSession = { userId: string; accessToken: string; refreshToken: string };
export type PasskeyServiceEnvironment = { supabaseUrl: string; publishableKey: string; relyingPartyId: string; assertAllowed: () => void };
type ClientFactory = (url: string, key: string, options: Parameters<typeof createClient>[2]) => Pick<SupabaseClient, "auth">;
export type PreparedPasskeyDependencies = {
  environment: PasskeyServiceEnvironment;
  native: NativePasskeyAdapter;
  currentOwner: () => PasskeyOwnerSession | null;
  isCurrent?: () => boolean;
  createClient?: ClientFactory;
  fetch?: typeof globalThis.fetch;
  adoptVerifiedSession?: (session: Session) => Promise<void>;
  ownsAdoptedSession?: (session: Session) => boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(code: ConstructorParameters<typeof PreparedPasskeyError>[0]): never { throw new PreparedPasskeyError(code); }

export function createPreparedPasskeyService(dependencies: PreparedPasskeyDependencies) {
  let disposed = false, generation = 0, ceremonyPending = false;
  const guard = () => {
    if (disposed || dependencies.isCurrent?.() === false) fail("stale");
    dependencies.environment.assertAllowed();
    let url: URL;
    try { url = new URL(dependencies.environment.supabaseUrl); } catch { return fail("blocked"); }
    if (url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash || !["", "/"].includes(url.pathname) ||
      !dependencies.environment.publishableKey.startsWith("sb_publishable_") ||
      !dependencies.environment.relyingPartyId || dependencies.environment.relyingPartyId.includes(":") ||
      dependencies.environment.relyingPartyId.includes("/")) fail("blocked");
    return url.origin;
  };
  const open = () => {
    const origin = guard();
    const transport = dependencies.fetch ?? globalThis.fetch;
    const checkedFetch: typeof globalThis.fetch = async (input, init) => {
      const endpoint = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (endpoint.origin !== origin || endpoint.pathname !== "/auth/v1/logout" &&
        (disposed || dependencies.isCurrent?.() === false)) fail("stale");
      // Borrowed owner sessions must never rotate their production-provider
      // refresh token. Explicit expired-token rejection below is reinforced at
      // transport level in case a token expires between checks and setSession.
      if (endpoint.pathname.endsWith("/token") && endpoint.searchParams.get("grant_type") === "refresh_token") fail("authentication_required");
      return transport(input, init);
    };
    return (dependencies.createClient ?? createClient)(origin, dependencies.environment.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
        experimental: { passkey: true } },
      global: { fetch: checkedFetch },
    }).auth;
  };
  const ownerCheck = (owner: PasskeyOwnerSession, lease: number) => {
    guard();
    const current = dependencies.currentOwner();
    if (lease !== generation || current?.userId !== owner.userId || current.accessToken !== owner.accessToken ||
      current.refreshToken !== owner.refreshToken) fail("stale");
  };
  const metadata = (value: PasskeyListItem): PasskeyListItem => {
    if (!value || !uuid.test(value.id) || typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at)) ||
      value.friendly_name !== undefined && typeof value.friendly_name !== "string" ||
      value.last_used_at !== undefined && typeof value.last_used_at !== "string") fail("invalid_response");
    return { id: value.id, created_at: value.created_at,
      ...(value.friendly_name === undefined ? {} : { friendly_name: value.friendly_name }),
      ...(value.last_used_at === undefined ? {} : { last_used_at: value.last_used_at }) };
  };
  const listOwned = async (auth: ReturnType<typeof open>, check: () => void) => {
    check(); const result = await auth.passkey.list(); check();
    if (result.error) fail("server_error");
    if (!Array.isArray(result.data)) fail("invalid_response");
    return result.data.map(metadata);
  };
  async function withOwner<T>(operation: (auth: ReturnType<typeof open>, check: () => void) => Promise<T>): Promise<T> {
    guard();
    const sourceOwner = dependencies.currentOwner();
    if (!sourceOwner?.accessToken || !sourceOwner.refreshToken || !uuid.test(sourceOwner.userId)) fail("authentication_required");
    // Snapshot primitives; callbacks may reuse and mutate an object in place.
    const owner = { ...sourceOwner };
    const lease = generation, auth = open();
    const check = () => ownerCheck(owner, lease);
    try {
      // getClaims rejects expiry before any setSession refresh path; identity is
      // separately checked against server getUser, never trusted from decoding.
      const claims = await auth.getClaims(owner.accessToken); check();
      if (claims.error || !claims.data?.claims.exp || claims.data.claims.exp <= Date.now() / 1000 + 30) fail("authentication_required");
      const verified = await auth.getUser(owner.accessToken); check();
      if (verified.error || verified.data.user?.id !== owner.userId) fail("authentication_required");
      const seeded = await auth.setSession({ access_token: owner.accessToken, refresh_token: owner.refreshToken }); check();
      if (seeded.error || seeded.data.user?.id !== owner.userId) fail("authentication_required");
      return await operation(auth, check);
    } finally {
      // Borrowed session: disposing memory must NOT revoke the actor's active
      // server session. This client has no persistent adapter or UI listeners.
      auth.dispose();
    }
  }
  async function verifyAuthentication(adopt: boolean): Promise<{ userId: string }> {
    guard(); if (ceremonyPending) fail("blocked");
    ceremonyPending = true;
    const lease = generation;
    let auth: ReturnType<typeof open> | null = null;
    const check = () => { guard(); if (lease !== generation) fail("stale"); };
    let created: Session | null = null, transferred = false;
    try {
      auth = open();
      if (!dependencies.native.isSupported()) fail("blocked");
      const started = await auth.passkey.startAuthentication(); check();
      if (started.error || !started.data?.challenge_id) fail("server_error");
      if (started.data.options?.rpId !== dependencies.environment.relyingPartyId) fail("blocked");
      const credential = await dependencies.native.get(started.data.options); check();
      const result = await auth.passkey.verifyAuthentication({ challengeId: started.data.challenge_id, credential });
      created = result.data?.session ?? null;
      check();
      if (result.error || !created?.access_token || !created.refresh_token || !created.user?.id) fail("server_error");
      const verified = await auth.getUser(created.access_token); check();
      if (verified.error || verified.data.user?.id !== created.user.id) fail("invalid_response");
      if (adopt) {
        await dependencies.adoptVerifiedSession!(created);
        transferred = true;
      }
      return { userId: verified.data.user.id };
    } finally {
      try {
        if (created && auth && !transferred && !dependencies.ownsAdoptedSession?.(created)) {
          // Revoke this exact abandoned JWT without SDK getSession/refresh.
          const result = await auth.admin.signOut(created.access_token, "local");
          if (result.error && ![401, 403, 404].includes(result.error.status ?? 0)) fail("cleanup_failed");
        }
      } finally { await auth?.dispose(); ceremonyPending = false; }
    }
  }
  return {
    async authenticate(): Promise<{ userId: string }> {
      // Authentication requires the reviewed feature/configuration gates.
      // Without a reviewed owner-aware adopter there is no persistence fallback.
      if (!dependencies.adoptVerifiedSession || !dependencies.ownsAdoptedSession) return fail("adoption_disabled");
      return verifyAuthentication(true);
    },
    list: () => withOwner((auth, check) => listOwned(auth, check)),
    async remove(passkeyId: string) {
      guard(); if (!uuid.test(passkeyId)) fail("not_found");
      return withOwner(async (auth, check) => {
        const before = await listOwned(auth, check);
        if (!before.some(item => item.id === passkeyId)) fail("not_found");
        check(); const removed = await auth.passkey.delete({ passkeyId }); check();
        if (removed.error) fail("server_error");
        const after = await listOwned(auth, check);
        if (after.some(item => item.id === passkeyId)) fail("invalid_response");
      });
    },
    async register() {
      guard(); if (ceremonyPending) fail("blocked");
      ceremonyPending = true;
      try {
        return await withOwner(async (auth, check) => {
          if (!dependencies.native.isSupported()) fail("blocked");
          const started = await auth.passkey.startRegistration(); check();
          if (started.error || !started.data?.challenge_id) fail("server_error");
          if (started.data.options?.rp?.id !== dependencies.environment.relyingPartyId) fail("blocked");
          const credential = await dependencies.native.create(started.data.options); check();
          const result = await auth.passkey.verifyRegistration({ challengeId: started.data.challenge_id, credential }); check();
          if (result.error || !result.data) fail("server_error");
          const confirmed = (await listOwned(auth, check)).find(item => item.id === result.data.id);
          if (!confirmed) fail("invalid_response");
          return confirmed;
        });
      } finally { ceremonyPending = false; }
    },
    // The diagnostic retains its original cleanup-only behavior.
    verifyAuthenticationWithoutAdoption: () => verifyAuthentication(false),
    invalidate() { generation++; },
    dispose() { disposed = true; generation++; },
  };
}

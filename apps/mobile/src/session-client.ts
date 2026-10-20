import { createClient, processLock, type AuthResponse, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createSessionAuthority, SessionAuthorityError, type AuthAttempt, type AuthAttemptKind } from "./session-authority";

type Storage = Parameters<typeof createSessionAuthority>[0]["records"];

/** One instance per project/runtime, constructed by the existing supabase module.
 * Candidate clients never share its storage/listeners. The SDK lock coordinates
 * complete refresh/update/adoption/removal operations, not just storage calls.
 */
export function createMobileSessionClient(url: string, key: string, input: {
  records: Storage; legacy: Storage; legacyRecovery: (session: Session) => Promise<boolean>;
  reportCleanupFailure: () => void; fetch?: typeof globalThis.fetch; autoRefreshToken?: boolean;
}) {
  const origin = new URL(url).origin;
  const project = new URL(url);
  const sessionKey = `sb-${project.hostname.split(".")[0]}-auth-token`;
  const authority = createSessionAuthority({
    authorityKey: `arc-track.auth-authority.v1.${project.hostname}.${project.port || "443"}`,
    sessionKey, records: input.records, legacy: input.legacy,
    legacyRecovery: input.legacyRecovery, reportCleanupFailure: input.reportCleanupFailure,
  });
  const transport = input.fetch ?? globalThis.fetch;
  const guardedFetch: typeof globalThis.fetch = async (request, init) => {
    const endpoint = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
    if (endpoint.origin !== origin || !endpoint.pathname.startsWith("/auth/v1/")) return transport(request, init);
    // These existing public actions request email only and cannot issue/save a
    // session. They must remain available while signed out.
    if (["/auth/v1/recover", "/auth/v1/resend"].includes(endpoint.pathname)) return transport(request, init);
    await authority.ready();
    const headers = new Headers(init?.headers ?? (typeof request === "object" && "headers" in request ? request.headers : undefined));
    const bearer = headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    const refresh = endpoint.pathname.endsWith("/token") && endpoint.searchParams.get("grant_type") === "refresh_token";
    const refreshToken = refresh && typeof init?.body === "string" ? JSON.parse(init.body).refresh_token : undefined;
    try {
      const lease = authority.requestLease(refresh ? undefined : bearer, refreshToken);
      const response = await transport(request, init);
      lease.current();
      if (refresh && response.ok) {
        const session = await response.clone().json();
        lease.current();
        if (!session.expires_at && Number.isFinite(session.expires_in)) session.expires_at = Math.round(Date.now() / 1000) + session.expires_in;
        lease.grantRefresh(session);
      }
      return response;
    } catch (issue) {
      if (refresh && issue instanceof SessionAuthorityError && issue.code === "stale") {
        // A retired refresh is not a network outage. A thrown fetch error makes
        // this SDK retry for ~30s while holding its lock. A nonretryable result
        // lets it drain. New adoption is behind that SAME SDK lock; any removal
        // here can only clear the retired session/tombstone, never a newer login.
        return new Response(JSON.stringify({ code: "arc_auth_superseded", message: "Authentication request superseded." }),
          { status: 409, headers: { "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01" } });
      }
      throw issue;
    }
  };
  const client = createClient(url, key, {
    auth: { storageKey: sessionKey, storage: authority.storage, persistSession: true,
      autoRefreshToken: input.autoRefreshToken ?? true, detectSessionInUrl: false, lock: processLock },
    global: { fetch: guardedFetch },
  });
  let commits: Promise<unknown> = Promise.resolve(), logoutBarrier: Promise<unknown> = Promise.resolve();
  let passkeyAttempt: AuthAttempt | null = null;
  function commit<T>(operation: () => Promise<T>): Promise<T> {
    const next = commits.catch(() => {}).then(operation);
    commits = next.catch(() => {});
    return next;
  }
  const volatile = () => createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: transport },
  });
  async function revoke(session: Session, scope: "local" | "global") {
    // This is the same JWT-authenticated logout API used internally by SDK
    // signOut. It needs no service key and does not seed/refresh another client.
    const cleanup = volatile();
    try {
      const { error } = await cleanup.auth.admin.signOut(session.access_token, scope);
      if (error && ![401, 403, 404].includes(error.status ?? 0)) throw error;
    } finally { cleanup.auth.dispose(); }
  }
  const adopt = (ticket: AuthAttempt, session: Session) => commit(async () => {
    authority.check(ticket);
    const result = await authority.withCandidate(ticket, session, () => client.auth.setSession({
      access_token: session.access_token, refresh_token: session.refresh_token,
    }));
    if (result.error || !result.data.session || !authority.owns(ticket, result.data.session)) {
      throw result.error ?? new SessionAuthorityError("invalid_session");
    }
    return result;
  });
  async function identity(kind: AuthAttemptKind, operation: (auth: SupabaseClient["auth"]) => Promise<AuthResponse>): Promise<AuthResponse> {
    const pending = authority.begin(kind); // invalidate older attempts synchronously
    const barrier = logoutBarrier;
    const ticket = await pending;
    await barrier.catch(() => {});
    authority.check(ticket);
    const candidateClient = volatile();
    let candidate: Session | null = null;
    try {
      const result = await operation(candidateClient.auth);
      candidate = result.data.session;
      authority.check(ticket);
      if (result.error || !candidate) return result;
      return await adopt(ticket, candidate);
    } finally {
      try {
        // Accepted ownership belongs to the primary client, including if its
        // tokens refreshed before this continuation. Never revoke that session.
        if (candidate && !authority.owns(ticket, candidate)) await revoke(candidate, "local");
      } finally {
        candidateClient.auth.dispose();
        if (!candidate || !authority.owns(ticket, candidate)) await authority.abandon(ticket);
      }
    }
  }
  return {
    client, authority,
    authentication: {
      signInWithPassword: (credentials: Parameters<SupabaseClient["auth"]["signInWithPassword"]>[0]) => identity("password", auth => auth.signInWithPassword(credentials)),
      signUp: (credentials: Parameters<SupabaseClient["auth"]["signUp"]>[0]) => identity("signup", auth => auth.signUp(credentials)),
      verifyOtp: (params: Parameters<SupabaseClient["auth"]["verifyOtp"]>[0]) => identity(params.type === "recovery" ? "recovery" : "verification", auth => auth.verifyOtp(params)),
      signOut() {
        const previous = authority.snapshot().accepted?.session ?? null;
        const retired = authority.retire(); // UI closes now; success waits for disk
        const result = commit(async () => {
          await retired;
          // SDK lock drains older refreshes before its own local cleanup.
          const cleared = await client.auth.signOut({ scope: "local" });
          if (cleared.error) throw cleared.error;
          if (previous) await revoke(previous, "global"); // preserve existing scope
        });
        logoutBarrier = result;
        return result;
      },
      async updateUser(attributes: Parameters<SupabaseClient["auth"]["updateUser"]>[0]) {
        await authority.ready();
        const accepted = authority.snapshot().accepted;
        if (!accepted) throw new SessionAuthorityError("stale");
        const result = await client.auth.updateUser(attributes);
        if (result.error) return result;
        if (!authority.allowsUser(result.data.user) || authority.snapshot().accepted?.epoch !== accepted.epoch) throw new SessionAuthorityError("stale");
        if (attributes.password && accepted.mode === "recovery") await authority.completeRecovery(accepted.epoch);
        return result;
      },
      async beginPasskey() {
        const pending = authority.begin("passkey");
        const barrier = logoutBarrier;
        const ticket = await pending;
        passkeyAttempt = ticket;
        await barrier.catch(() => {});
        authority.check(ticket);
        return {
          isCurrent: () => { try { authority.check(ticket); return true; } catch { return false; } },
          accept: (session: Session) => adopt(ticket, session),
          owns: (session: Session) => authority.owns(ticket, session),
          async abandon() { await authority.abandon(ticket); if (passkeyAttempt === ticket) passkeyAttempt = null; },
        };
      },
      abandonPasskey() {
        const ticket = passkeyAttempt;
        passkeyAttempt = null;
        if (ticket) return authority.abandon(ticket);
        return Promise.resolve();
      },
    },
  };
}

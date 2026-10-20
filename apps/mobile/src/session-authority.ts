import type { Session } from "@supabase/supabase-js";

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> };
export type AuthAttemptKind = "password" | "signup" | "verification" | "recovery" | "passkey";
export type AuthAttempt = Readonly<{ revision: number; epoch: number; kind: AuthAttemptKind }>;
type Accepted = { epoch: number; accountId: string; binding: string; mode: "normal" | "recovery"; session: Session };
export type AuthorityRecord = {
  version: 1; epoch: number; phase: "pending" | "accepted" | "signedOut";
  accepted: Accepted | null;
};
export class SessionAuthorityError extends Error {
  constructor(public readonly code: "stale" | "storage" | "corrupt" | "invalid_session") {
    super(code === "stale" ? "This sign-in attempt is no longer current." : "Secure sign-in state could not be verified. Please retry.");
    this.name = "SessionAuthorityError";
  }
}
const fail = (code: ConstructorParameters<typeof SessionAuthorityError>[0]): never => { throw new SessionAuthorityError(code); };
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

// Structural binding only. Server identity verification is required by the
// coordinator/SDK before accepting a candidate; decoded JWT claims are not proof.
export function sessionBinding(value: unknown): { session: Session; binding: string; expiresAt: number } {
  if (!value || typeof value !== "object") return fail("invalid_session");
  const session = value as Session;
  if (typeof session.access_token !== "string" || !session.access_token ||
    typeof session.refresh_token !== "string" || !session.refresh_token ||
    typeof session.user?.id !== "string" || !session.user.id ||
    !Number.isFinite(session.expires_at) || !Number.isFinite(session.expires_in) || session.token_type !== "bearer") return fail("invalid_session");
  try {
    const encoded = session.access_token.split(".")[1];
    const claims = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")));
    if (claims.sub !== session.user.id || !Number.isFinite(claims.exp) ||
      claims.session_id !== undefined && (typeof claims.session_id !== "string" || !claims.session_id)) return fail("invalid_session");
    return { session, binding: claims.session_id ? `session:${claims.session_id}` : `legacy:${session.user.id}`, expiresAt: claims.exp };
  } catch { return fail("invalid_session"); }
}

function parseRecord(raw: string): AuthorityRecord {
  try {
    const value = JSON.parse(raw) as AuthorityRecord;
    if (value.version !== 1 || !integer(value.epoch) || !["pending", "accepted", "signedOut"].includes(value.phase)) return fail("corrupt");
    if (value.accepted !== null) {
      const a = value.accepted, parsed = sessionBinding(a.session);
      if (!integer(a.epoch) || a.epoch > value.epoch || a.accountId !== parsed.session.user.id || a.binding !== parsed.binding ||
        !["normal", "recovery"].includes(a.mode)) return fail("corrupt");
    }
    if (value.phase === "accepted" && !value.accepted || value.phase === "signedOut" && value.accepted) return fail("corrupt");
    return value;
  } catch { return fail("corrupt"); }
}

export function createSessionAuthority(input: {
  authorityKey: string; sessionKey: string; records: Storage; legacy: Storage;
  legacyRecovery: (session: Session) => Promise<boolean>;
  reportCleanupFailure: () => void;
}) {
  let record: AuthorityRecord | null = null, revision = 0, retiring = false;
  let error: SessionAuthorityError | null = null, boot: Promise<void> | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  let candidate: { ticket: AuthAttempt; session: Session } | null = null;
  const refreshGrants = new Map<string, { epoch: number; accountId: string }>();
  const notify = () => { for (const listener of listeners) listener(); };
  const nextEpoch = () => { if (!record || !integer(record.epoch + 1)) return fail("corrupt"); return record.epoch + 1; };
  const current = () => !error && !retiring ? record?.accepted ?? null : null;
  const check = (ticket: AuthAttempt) => {
    if (error) throw error;
    if (retiring || ticket.revision !== revision || ticket.epoch !== record?.epoch) fail("stale");
  };
  async function persist(next: AuthorityRecord, ticket?: AuthAttempt) {
    const previous = record;
    try {
      await input.records.setItem(input.authorityKey, JSON.stringify(next));
      if (ticket && (retiring || ticket.revision !== revision || ticket.epoch !== record?.epoch)) {
        // An issued native write cannot be cancelled by a JS generation check.
        // Restore its predecessor with an acknowledged write in this SAME queue
        // before any newer transition can commit. Never publish the stale value.
        await input.records.setItem(input.authorityKey, JSON.stringify(previous));
        return fail("stale");
      }
    }
    catch (issue) {
      if (issue instanceof SessionAuthorityError && issue.code === "stale") throw issue;
      error = new SessionAuthorityError("storage"); notify(); throw error;
    }
    record = next;
    notify();
  }
  async function ready() {
    if (!boot) boot = (async () => {
      try {
        const raw = await input.records.getItem(input.authorityKey);
        if (raw !== null) {
          record = parseRecord(raw);
          // A terminated attempt is never resumed. Its previous accepted session
          // can survive; the abandoned pending epoch cannot.
          if (record.phase === "pending") await persist({ ...record, epoch: nextEpoch(), phase: record.accepted ? "accepted" : "signedOut" });
        } else {
          const previous = await input.legacy.getItem(input.sessionKey);
          let accepted: Accepted | null = null;
          if (previous !== null) {
            const parsed = sessionBinding(JSON.parse(previous));
            accepted = { epoch: 0, accountId: parsed.session.user.id, binding: parsed.binding,
              mode: await input.legacyRecovery(parsed.session) ? "recovery" : "normal", session: parsed.session };
          }
          await persist({ version: 1, epoch: 0, phase: accepted ? "accepted" : "signedOut", accepted });
        }
        // Authority is already committed. Failed old-key cleanup cannot turn it
        // into a legacy fallback or force an otherwise valid user to sign in.
        try { await input.legacy.removeItem(input.sessionKey); } catch { input.reportCleanupFailure(); }
        notify();
      } catch (issue) {
        error = issue instanceof SessionAuthorityError ? issue : new SessionAuthorityError("storage");
        notify(); throw error;
      }
    })();
    await boot;
    if (error) throw error;
  }
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.catch(() => {}).then(async () => { await ready(); return operation(); });
    tail = result.catch(() => {});
    return result;
  }
  const sameTokens = (a: Session, b: Session) => a.access_token === b.access_token && a.refresh_token === b.refresh_token;

  const storage: Storage = {
    async getItem(key) {
      if (key !== input.sessionKey) return input.legacy.getItem(key);
      try { await ready(); }
      catch {
        // SDK 2.116's initial-session subscription does not catch storage-read
        // rejection. Give ONLY the SDK a closed session; the authority retains
        // its explicit error, so UI/coordinator/transport stay blocked for retry.
        return null;
      }
      const accepted = current();
      return accepted ? JSON.stringify(accepted.session) : null;
    },
    async setItem(key, raw) {
      if (key !== input.sessionKey) return input.legacy.setItem(key, raw);
      const parsed = sessionBinding(JSON.parse(raw));
      return serialize(async () => {
        const grant = candidate;
        if (grant && record?.phase === "pending" && sameTokens(grant.session, parsed.session)) {
          check(grant.ticket);
          if (parsed.session.user.id !== grant.session.user.id) fail("invalid_session");
          await persist({ version: 1, epoch: grant.ticket.epoch, phase: "accepted", accepted: {
            epoch: grant.ticket.epoch, accountId: parsed.session.user.id, binding: parsed.binding,
            mode: grant.ticket.kind === "recovery" ? "recovery" : "normal", session: parsed.session,
          } }, grant.ticket);
          check(grant.ticket);
          return;
        }
        const accepted = current(), refresh = refreshGrants.get(parsed.session.access_token);
        if (!accepted) return fail("stale");
        if (parsed.session.user.id !== accepted.accountId ||
          !sameTokens(accepted.session, parsed.session) && (!refresh || refresh.epoch !== accepted.epoch || refresh.accountId !== accepted.accountId)) fail("stale");
        // Refresh/updateUser retain the accepted identity and recovery purpose.
        await persist({ ...record!, accepted: { ...accepted, binding: parsed.binding, session: parsed.session } });
        refreshGrants.delete(parsed.session.access_token);
      });
    },
    async removeItem(key) {
      if (key !== input.sessionKey) return input.legacy.removeItem(key);
      return serialize(async () => {
        // SDK expiry/removal does not cancel a different in-flight candidate.
        if (!record!.accepted) return;
        await persist({ ...record!, accepted: null, phase: record!.phase === "pending" ? "pending" : "signedOut" });
      });
    },
  };

  return {
    ready, storage,
    async retry() {
      ++revision;
      await tail;
      error = null; record = null; boot = null; retiring = false;
      await ready();
    },
    snapshot: () => ({ accepted: current(), error, ready: !!record && !error, retiring }),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    allowsSession(session: Session | null) { const a = current(); return !!a && !!session && a.accountId === session.user.id && sameTokens(a.session, session); },
    allowsUser(user: { id: string } | null) { return !!user && current()?.accountId === user.id; },
    async begin(kind: AuthAttemptKind): Promise<AuthAttempt> {
      const request = ++revision;
      return serialize(async () => {
        if (request !== revision) return fail("stale");
        const epoch = nextEpoch();
        await persist({ ...record!, epoch, phase: "pending" });
        const ticket = Object.freeze({ revision: request, epoch, kind });
        check(ticket);
        return ticket;
      });
    },
    check,
    async abandon(ticket: AuthAttempt) {
      if (ticket.revision !== revision) return;
      ++revision;
      await serialize(async () => {
        if (record!.epoch !== ticket.epoch || record!.phase !== "pending") return;
        await persist({ ...record!, epoch: nextEpoch(), phase: record!.accepted ? "accepted" : "signedOut" });
      });
    },
    retire() {
      ++revision; retiring = true; refreshGrants.clear(); notify();
      return serialize(async () => {
        await persist({ version: 1, epoch: nextEpoch(), phase: "signedOut", accepted: null });
        retiring = false;
        notify();
      });
    },
    async withCandidate<T>(ticket: AuthAttempt, session: Session, accept: () => Promise<T>): Promise<T> {
      check(ticket);
      if (record?.phase !== "pending") return fail("stale");
      const parsed = sessionBinding(session);
      if (parsed.expiresAt <= Date.now() / 1000 + 15) return fail("invalid_session");
      const grant = { ticket, session: parsed.session };
      if (candidate) return fail("stale");
      candidate = grant;
      try { const result = await accept(); check(ticket); return result; }
      finally { if (candidate === grant) candidate = null; }
    },
    owns(ticket: AuthAttempt, session: Session) { return record?.accepted?.epoch === ticket.epoch && record.accepted.accountId === session.user.id; },
    requestLease(accessToken?: string, refreshToken?: string) {
      const grant = candidate;
      if (grant && accessToken === grant.session.access_token) {
        check(grant.ticket);
        return { current: () => { check(grant.ticket); }, grantRefresh: () => fail("stale") };
      }
      const accepted = current();
      if (!accepted || accessToken && accessToken !== accepted.session.access_token || refreshToken && refreshToken !== accepted.session.refresh_token) return fail("stale");
      const isCurrent = () => { if (current()?.epoch !== accepted.epoch) fail("stale"); };
      return { current: isCurrent, grantRefresh(session: Session) {
        isCurrent();
        const parsed = sessionBinding(session);
        if (parsed.session.user.id !== accepted.accountId ||
          !accepted.binding.startsWith("legacy:") && parsed.binding !== accepted.binding) return fail("invalid_session");
        if (refreshGrants.size >= 8) refreshGrants.clear();
        refreshGrants.set(parsed.session.access_token, { epoch: accepted.epoch, accountId: accepted.accountId });
      } };
    },
    async completeRecovery(epoch: number) {
      await serialize(async () => {
        const a = current();
        if (!a || a.epoch !== epoch) return fail("stale");
        if (a.mode === "recovery") await persist({ ...record!, accepted: { ...a, mode: "normal" } });
      });
    },
  };
}
export type SessionAuthority = ReturnType<typeof createSessionAuthority>;

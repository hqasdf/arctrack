import {
  createFeedbackRequestId, mapCoachFeedback, mapSessionNote, notesFeedbackError, prepareFeedbackBody, prepareSessionNote,
  type CoachFeedback, type DbCoachFeedback, type DbSessionNote,
} from "@arc-track/core/notes-feedback";
import { readCoachAthletes } from "./organizations";
import { sessionAuthority, supabase } from "./supabase";

export type FeedbackCursor = { createdAt: string; id: string };
export type FeedbackScope = { athleteId?: string; organizationId?: string; sessionId?: string };
const PAGE_SIZE = 25;
const REQUEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type AuthorScope = { organizationId: string; athleteId: string; sessionId?: string };
type CreationScope = AuthorScope & { sessionId: string };
export type MobileFeedbackCreation = {
  requestId: string; userId: string; organizationId: string; athleteId: string;
  sessionId: string; kind: "session"; body: string;
};

/** SDK 57's existing Expo Core supplies native uuidv4; no optional crypto module is required. */
export function createMobileFeedbackRequestId(): string {
  return createFeedbackRequestId((length) => {
    if (length !== 16) throw new Error("Secure feedback request generation is unavailable. Please reopen the app.");
    if (typeof globalThis.expo?.uuidv4 === "function") {
      // Android java.util.UUID.randomUUID / iOS Foundation UUID already supply 122 random v4 bits.
      const nativeId = globalThis.expo.uuidv4();
      if (!REQUEST_UUID.test(nativeId)) throw new Error("Secure feedback request generation is unavailable. Please reopen the app.");
      return Uint8Array.from(nativeId.replaceAll("-", "").match(/../g)!, value => Number.parseInt(value, 16));
    }
    throw new Error("Secure feedback request generation is unavailable. Please reopen the app.");
  });
}

/** Keep one immutable payload and request identity until success or explicit cancellation. */
export function prepareMobileFeedbackCreation(userId: string, scope: CreationScope, body: string, pending: MobileFeedbackCreation | null): MobileFeedbackCreation {
  if (!scope.sessionId) throw new Error("Open a Session before creating coach feedback.");
  const payload = { userId, organizationId: scope.organizationId, athleteId: scope.athleteId, sessionId: scope.sessionId, kind: "session" as const, body: prepareFeedbackBody(body) };
  if (pending) {
    if (pending.userId !== payload.userId || pending.organizationId !== payload.organizationId || pending.athleteId !== payload.athleteId ||
      pending.sessionId !== payload.sessionId || pending.kind !== payload.kind || pending.body !== payload.body)
      throw new Error("An earlier submission may already be saved. Restore its submitted text and retry, or cancel this draft before starting a separate feedback entry.");
    return pending;
  }
  return { ...payload, requestId: createMobileFeedbackRequestId() };
}

/** Every operation uses the ordinary authenticated client. RLS / guarded RPCs remain authoritative. */
async function currentClient(userId: string) {
  if (!supabase) throw new Error("Notes and feedback are unavailable. Check the app configuration.");
  const accepted = sessionAuthority?.snapshot().accepted;
  if (!accepted || accepted.accountId !== userId || accepted.mode !== "normal") throw new Error("Sign in again to access notes and feedback.");
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user?.id !== userId) throw new Error("Your sign-in has expired. Sign in again.");
  function check() {
    const now = sessionAuthority?.snapshot();
    if (now?.retiring || now?.accepted?.accountId !== userId || now.accepted.epoch !== accepted!.epoch)
      throw new Error("Your account changed. Reopen this screen to continue.");
  }
  check();
  return { client: supabase, check };
}

export async function readMobileSessionNote(userId: string, sessionId: string, coach?: { organizationId: string; athleteId: string }) {
  const { client, check } = await currentClient(userId);
  if (coach) {
    const athletes = await readCoachAthletes(userId, coach.organizationId);
    check();
    if (!athletes?.some((athlete) => athlete.userId === coach.athleteId)) throw new Error("You no longer have access to this athlete's notes.");
    const { data, error } = await client.from("sessions").select("id").eq("id", sessionId).eq("user_id", coach.athleteId).maybeSingle();
    check();
    if (error || !data) throw new Error("This athlete's Session is no longer available.");
  }
  const { data, error } = await client.from("session_notes").select("session_id,body,technique_tags,created_at,updated_at").eq("session_id", sessionId).maybeSingle();
  check();
  if (error) throw new Error(notesFeedbackError(error));
  if (data && data.session_id !== sessionId) throw new Error("The note's Session could not be verified. Reopen this screen.");
  return data ? mapSessionNote(data as DbSessionNote) : null;
}

export async function saveMobileSessionNote(userId: string, sessionId: string, body: string, tags: string[], expectedUpdatedAt: string | null) {
  const input = prepareSessionNote(body, tags);
  const { client, check } = await currentClient(userId);
  const { data, error } = await client.rpc("save_session_notes", {
    p_session_id: sessionId, p_body: input.body, p_technique_tags: input.techniqueTags, p_expected_updated_at: expectedUpdatedAt,
  });
  check();
  if (error) throw new Error(notesFeedbackError(error));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.session_id !== sessionId) throw new Error("The note was not confirmed as saved. Your draft is still available.");
  return mapSessionNote(row as DbSessionNote);
}

export async function deleteMobileSessionNote(userId: string, sessionId: string, expectedUpdatedAt: string) {
  const { client, check } = await currentClient(userId);
  const { data, error } = await client.rpc("delete_session_notes", { p_session_id: sessionId, p_expected_updated_at: expectedUpdatedAt });
  check();
  if (error) throw new Error(notesFeedbackError(error));
  if (data !== true) throw new Error("The note was not deleted. Reload and try again.");
}

export async function readMobileFeedback(userId: string, scope: FeedbackScope, before: FeedbackCursor | null = null) {
  const { client, check } = await currentClient(userId);
  const { data, error } = await client.rpc("read_coach_feedback", {
    p_athlete_user_id: scope.athleteId ?? userId, p_organization_id: scope.organizationId ?? null,
    p_session_id: scope.sessionId ?? null, p_kind: "session",
    p_before_created_at: before?.createdAt ?? null, p_before_id: before?.id ?? null, p_limit: PAGE_SIZE,
  });
  check();
  if (error) throw new Error(notesFeedbackError(error));
  if (!Array.isArray(data)) throw new Error("Feedback could not be loaded. The server returned an unexpected response.");
  const entries = (data as DbCoachFeedback[]).map(mapCoachFeedback);
  // Defence in depth: never render a row outside the requested recipient / exact organisation.
  if (entries.some((entry) => entry.athleteUserId !== (scope.athleteId ?? userId) ||
    scope.organizationId && (entry.organizationId !== scope.organizationId || entry.authorUserId !== userId) ||
    scope.sessionId && entry.sessionId !== scope.sessionId || entry.kind !== "session"))
    throw new Error("Feedback access could not be verified. Reopen this screen.");
  const last = entries.at(-1);
  return { entries, next: entries.length === PAGE_SIZE && last ? { createdAt: last.createdAt, id: last.id } : null };
}

export async function saveMobileCoachFeedback(userId: string, scope: AuthorScope, body: string, existing: CoachFeedback | null, creationRequestId: string | null = null) {
  const prepared = prepareFeedbackBody(body);
  if (!existing && !scope.sessionId) throw new Error("Open a Session before creating coach feedback.");
  if (!existing && (!creationRequestId || !REQUEST_UUID.test(creationRequestId))) throw new Error("Prepare a new feedback submission before saving.");
  if (existing && creationRequestId !== null) throw new Error("An existing feedback edit cannot use a creation request identifier.");
  if (existing && (!existing.canEdit || existing.authorUserId !== userId || existing.organizationId !== scope.organizationId || existing.athleteUserId !== scope.athleteId))
    throw new Error("Only the original authorised coach can edit this feedback.");
  const { client, check } = await currentClient(userId);
  const { data, error } = await client.rpc("save_coach_feedback", {
    p_feedback_id: existing?.id ?? null, p_organization_id: scope.organizationId, p_athlete_user_id: scope.athleteId,
    p_kind: "session", p_session_id: existing ? existing.sessionId : scope.sessionId!,
    p_body: prepared, p_expected_updated_at: existing?.updatedAt ?? null, p_creation_request_id: creationRequestId,
  });
  check();
  if (error) throw new Error(notesFeedbackError(error));
  if (typeof data !== "string" || !data) throw new Error("The feedback was not confirmed as saved. Your draft is still available.");
  return data;
}

export async function deleteMobileCoachFeedback(userId: string, organizationId: string, entry: CoachFeedback) {
  if (!entry.canEdit || entry.authorUserId !== userId || entry.organizationId !== organizationId)
    throw new Error("Only the original authorised coach can delete this feedback.");
  const { client, check } = await currentClient(userId);
  const { data, error } = await client.rpc("delete_coach_feedback", { p_feedback_id: entry.id, p_expected_updated_at: entry.updatedAt });
  check();
  if (error) throw new Error(notesFeedbackError(error));
  if (data !== true) throw new Error("The feedback was not deleted. Reload and try again.");
}

/** A request ticket belongs to one mounted account/session/organisation scope. */
export function createNotesRequestGuard() {
  let generation = 0;
  return { begin() { const ticket = ++generation; return () => ticket === generation; }, invalidate() { generation++; } };
}

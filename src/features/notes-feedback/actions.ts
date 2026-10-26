"use server";

import { revalidatePath } from "next/cache";
import { mapCoachFeedback, mapSessionNote, notesFeedbackError, prepareFeedbackBody, prepareSessionNote,
  type DbCoachFeedback, type DbSessionNote } from "@arc-track/core/notes-feedback";
import { createAuthClient } from "@/lib/supabase/server";
import { readCoachAthletes } from "@/features/organizations/coach-read.server";
import type { FeatureResult, FeedbackContext, FeedbackPage, NotesContext, SessionNote } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class FeatureError extends Error {}
function id(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) throw new FeatureError("The record could not be identified.");
}
async function client(context: FeedbackContext) {
  id(context.viewerId);
  const supabase = await createAuthClient({ writable: true });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.id !== context.viewerId) throw new FeatureError("Your account changed or sign-in expired. Reopen this page before continuing.");
  if (context.sessionId) id(context.sessionId);
  if (context.organizationId || context.athleteUserId) {
    id(context.organizationId); id(context.athleteUserId);
    const athletes = await readCoachAthletes(context.organizationId);
    if (!athletes.some((athlete) => athlete.userId === context.athleteUserId)) throw new FeatureError("This athlete is no longer available in your active roster.");
  }
  return supabase;
}
async function sessionClient(context: NotesContext) {
  id(context.sessionId);
  const supabase = await client(context);
  const { data, error } = await supabase.from("sessions").select("id").eq("id", context.sessionId)
    .eq("user_id", context.athleteUserId ?? context.viewerId).maybeSingle();
  if (error) throw error;
  if (!data) throw new FeatureError("This Session is unavailable or you no longer have access.");
  return supabase;
}
function failure<T>(issue: unknown): FeatureResult<T> { return { ok: false, message: issue instanceof FeatureError ? issue.message : notesFeedbackError(issue) }; }
function refresh(context: FeedbackContext) {
  revalidatePath("/sessions");
  if (context.organizationId && context.athleteUserId) {
    const base = `/organization/${context.organizationId}/athletes/${context.athleteUserId}`;
    revalidatePath(base);
    if (context.sessionId) revalidatePath(`${base}/sessions/${context.sessionId}`);
  }
}

export async function loadSessionNote(context: NotesContext): Promise<FeatureResult<SessionNote | null>> {
  try {
    const supabase = await sessionClient(context);
    const { data, error } = await supabase.from("session_notes").select("session_id,body,technique_tags,created_at,updated_at")
      .eq("session_id", context.sessionId).maybeSingle();
    if (error) throw error;
    return { ok: true, data: data ? mapSessionNote(data as DbSessionNote) : null };
  } catch (issue) { return failure(issue); }
}

export async function saveSessionNote(context: NotesContext, body: string, tags: string[], expectedUpdatedAt: string | null): Promise<FeatureResult<SessionNote>> {
  try {
    if (context.organizationId || context.athleteUserId) throw new Error("Only the Session owner can change Session Notes.");
    const prepared = prepareSessionNote(body, tags);
    const supabase = await sessionClient(context);
    const { data, error } = await supabase.rpc("save_session_notes", {
      p_session_id: context.sessionId, p_body: prepared.body, p_technique_tags: prepared.techniqueTags, p_expected_updated_at: expectedUpdatedAt,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("The saved note could not be confirmed. Reload before trying again.");
    refresh(context);
    return { ok: true, data: mapSessionNote(row as DbSessionNote) };
  } catch (issue) { return failure(issue); }
}

export async function removeSessionNote(context: NotesContext, expectedUpdatedAt: string): Promise<FeatureResult<null>> {
  try {
    if (context.organizationId || context.athleteUserId) throw new Error("Only the Session owner can delete Session Notes.");
    const supabase = await sessionClient(context);
    const { data, error } = await supabase.rpc("delete_session_notes", { p_session_id: context.sessionId, p_expected_updated_at: expectedUpdatedAt });
    if (error) throw error;
    if (data !== true) throw new Error("Note deletion could not be confirmed. Reload before trying again.");
    refresh(context);
    return { ok: true, data: null };
  } catch (issue) { return failure(issue); }
}

export async function loadCoachFeedback(context: FeedbackContext, before?: { createdAt: string; id: string }, activeMembershipOnly = false): Promise<FeatureResult<FeedbackPage>> {
  try {
    const supabase = await client(context);
    if (before) id(before.id);
    if (activeMembershipOnly) {
      // Match the existing organisation reader: a real organisation and active membership.
      // Check before reading feedback; this presentation gate never grants authoring rights.
      const { data: memberships, error: membershipError } = await supabase.from("organization_members")
        .select("organization_id,organizations!inner(id)").eq("user_id", context.viewerId).eq("status", "active").limit(1);
      if (membershipError) throw membershipError;
      if (!memberships?.length) return { ok: true, data: { entries: [], hasMore: false, visible: false } };
    }
    const { data, error } = await supabase.rpc("read_coach_feedback", {
      p_athlete_user_id: context.athleteUserId ?? context.viewerId, p_organization_id: context.organizationId ?? null,
      p_session_id: context.sessionId ?? null, p_kind: "session",
      p_before_created_at: before?.createdAt ?? null, p_before_id: before?.id ?? null, p_limit: 25,
    });
    if (error) throw error;
    const entries = ((data ?? []) as DbCoachFeedback[]).map(mapCoachFeedback);
    return { ok: true, data: { entries, hasMore: entries.length === 25 } };
  } catch (issue) { return failure(issue); }
}

export async function saveCoachFeedback(context: FeedbackContext, feedbackId: string | null, body: string, expectedUpdatedAt: string | null, creationRequestId: string | null = null): Promise<FeatureResult<string>> {
  try {
    id(context.organizationId); id(context.athleteUserId);
    if (feedbackId) id(feedbackId);
    if (feedbackId === null) id(creationRequestId);
    else if (creationRequestId !== null) throw new FeatureError("Creation request identifiers cannot be used to edit feedback.");
    if (feedbackId === null) id(context.sessionId);
    const prepared = prepareFeedbackBody(body);
    const supabase = await client(context);
    const { data, error } = await supabase.rpc("save_coach_feedback", {
      p_feedback_id: feedbackId, p_organization_id: context.organizationId, p_athlete_user_id: context.athleteUserId,
      p_kind: "session", p_session_id: context.sessionId ?? null, p_body: prepared, p_expected_updated_at: expectedUpdatedAt,
      p_creation_request_id: creationRequestId,
    });
    if (error) throw error;
    if (typeof data !== "string" || !UUID.test(data)) throw new Error("Feedback saving could not be confirmed. Reload before trying again.");
    refresh(context);
    return { ok: true, data };
  } catch (issue) { return failure(issue); }
}

export async function removeCoachFeedback(context: FeedbackContext, feedbackId: string, expectedUpdatedAt: string): Promise<FeatureResult<null>> {
  try {
    id(context.organizationId); id(context.athleteUserId); id(feedbackId);
    const supabase = await client(context);
    const { data, error } = await supabase.rpc("delete_coach_feedback", { p_feedback_id: feedbackId, p_expected_updated_at: expectedUpdatedAt });
    if (error) throw error;
    if (data !== true) throw new Error("Feedback deletion could not be confirmed. Reload before trying again.");
    refresh(context);
    return { ok: true, data: null };
  } catch (issue) { return failure(issue); }
}

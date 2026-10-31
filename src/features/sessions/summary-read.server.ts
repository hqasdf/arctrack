import "server-only";
import { mapCompleteSummaryBatch, type SessionSummary } from "@arc-track/core/sessions";
import type { SessionType } from "@arc-track/core/scoring";
import { requireUser } from "@/lib/auth/session.server";
import { createAuthClient } from "@/lib/supabase/server";

export const SESSION_SUMMARY_SELECT = 'id,title,session_date,created_at,session_type,arrow_count,session_rounds(count)';
/** Additive, currently unused by UI. A capped result fails rather than truncating history. */
export async function readSessionSummaries(options?: { sessionType?: SessionType }): Promise<SessionSummary[]> {
  const user = await requireUser();
  const client = await createAuthClient();
  let query = client.from('sessions').select(SESSION_SUMMARY_SELECT, { count: 'exact' })
    .eq('user_id', user.id).order('session_date', { ascending: false })
    .order('created_at', { ascending: false }).order('id', { ascending: false });
  if (options?.sessionType) query = query.eq('session_type', options.sessionType);
  const { data, error, count } = await query;
  if (error) throw Error('Session summaries could not be loaded.');
  return mapCompleteSummaryBatch(data, count);
}

import { mapCompleteSummaryBatch, type SessionSummary } from '@arc-track/core/sessions';
import type { SessionType } from '@arc-track/core/scoring';
import { supabase } from './supabase';

export const SESSION_SUMMARY_SELECT = 'id,title,session_date,created_at,session_type,arrow_count,session_rounds(count)';
/** Additive read; existing native lists/detail/offline consumers are unchanged. */
export async function readOwnSessionSummaries(userId: string, options?: { sessionType?: SessionType }): Promise<SessionSummary[]> {
  if (!supabase) throw Error('Supabase is not configured.');
  const { data: identity, error: authError } = await supabase.auth.getUser();
  if (authError || !identity.user || identity.user.id !== userId) throw Error('Session ownership could not be verified.');
  let query = supabase.from('sessions').select(SESSION_SUMMARY_SELECT, { count: 'exact' })
    .eq('user_id', identity.user.id).order('session_date', { ascending: false })
    .order('created_at', { ascending: false }).order('id', { ascending: false });
  if (options?.sessionType) query = query.eq('session_type', options.sessionType);
  const { data, error, count } = await query;
  if (error) throw Error('Session summaries could not be loaded.');
  return mapCompleteSummaryBatch(data, count);
}

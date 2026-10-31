import type { SessionDraft, SessionType } from './scoring-model.ts';

/** Listing metadata only. Never pass this to a scoring/detail consumer. */
export type SessionSummary = {
  id: string;
  title: string;
  date: string;
  createdAt: string;
  sessionType: SessionType;
  /** Athlete-recorded Session count, NOT the number of scored Arrow rows. */
  arrowCount: number;
  roundCount: number;
};
/** Future listing response only; Phase 3A supplies no cursor implementation. */
export type SessionSummaryPage = { items: SessionSummary[]; nextCursor: string | null };
/** Compatible name for the existing complete scoring DTO, not a summary conversion. */
export type SessionDetail = SessionDraft;

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
/** Validate a PostgREST embedded count response; missing data is not an empty Session. */
export function mapSessionSummary(input: unknown): SessionSummary {
  const invalid = () => Error('Session summary could not be verified.');
  if (!input || typeof input !== 'object') throw invalid();
  const row = input as Record<string, unknown>;
  if (typeof row.id !== 'string' || !uuid.test(row.id) || typeof row.title !== 'string'
    || typeof row.session_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.session_date)
    || !Number.isFinite(Date.parse(row.session_date)) || new Date(row.session_date).toISOString().slice(0, 10) !== row.session_date
    || typeof row.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.created_at) || !Number.isFinite(Date.parse(row.created_at))
    || row.session_type !== 'training' && row.session_type !== 'competition' || !nonnegative(row.arrow_count)) throw invalid();
  if (!Array.isArray(row.session_rounds) || row.session_rounds.length !== 1) throw invalid();
  const count = row.session_rounds[0]?.count as unknown;
  if (!nonnegative(count)) throw invalid();
  return { id: row.id, title: row.title, date: row.session_date, createdAt: row.created_at,
    sessionType: row.session_type, arrowCount: row.arrow_count, roundCount: count };
}
/** Fail explicitly if a one-request read was capped. Pagination is a later phase. */
export function mapCompleteSummaryBatch(data: unknown, count: number | null): SessionSummary[] {
  if (!Array.isArray(data) || !nonnegative(count) || count !== data.length) throw Error('Session summary result is incomplete. Pagination support is required.');
  return data.map(mapSessionSummary);
}

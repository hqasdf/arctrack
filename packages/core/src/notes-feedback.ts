export type SessionNote = { sessionId: string; body: string; techniqueTags: string[]; createdAt: string; updatedAt: string };
export type CoachFeedback = { id: string; organizationId: string | null; athleteUserId: string; authorUserId: string | null; kind: "session"; sessionId: string | null; body: string; createdAt: string; updatedAt: string; authorDisplayName: string | null; canEdit: boolean };
export type DbSessionNote = { session_id: string; body: string; technique_tags: string[]; created_at: string; updated_at: string };
export type DbCoachFeedback = { id: string; organization_id: string | null; athlete_user_id: string; author_user_id: string | null; kind: "session"; session_id: string | null; body: string; created_at: string; updated_at: string; author_display_name: string | null; can_edit: boolean };
export function mapSessionNote(row: DbSessionNote): SessionNote { return { sessionId: row.session_id, body: row.body, techniqueTags: row.technique_tags, createdAt: row.created_at, updatedAt: row.updated_at }; }
export function mapCoachFeedback(row: DbCoachFeedback): CoachFeedback {
  if (row.kind !== "session") throw new Error("Only Session Feedback is supported.");
  return { id: row.id, organizationId: row.organization_id, athleteUserId: row.athlete_user_id, authorUserId: row.author_user_id, kind: row.kind, sessionId: row.session_id, body: row.body, createdAt: row.created_at, updatedAt: row.updated_at, authorDisplayName: row.author_display_name, canEdit: row.can_edit };
}
export const NOTE_BODY_LIMIT = 4000;
export const NOTE_TAG_LIMIT = 8;
export const NOTE_TAG_LENGTH = 40;
export const FEEDBACK_BUDGET_MESSAGE = "Too many feedback entries. Try again shortly.";
export const FEEDBACK_REQUEST_CONFLICT_MESSAGE = "This feedback request conflicts with an earlier submission. Refresh feedback and start a new entry.";
class NotesValidationError extends Error {}
const length = (value: string) => Array.from(value).length;
/** Platforms provide their existing secure entropy source; core does not assume Web Crypto. */
export function createFeedbackRequestId(randomBytes: (size: number) => Uint8Array): string {
  try {
    const source = randomBytes(16);
    if (!(source instanceof Uint8Array) || source.length !== 16) throw new Error("Invalid entropy source.");
    const bytes = Uint8Array.from(source);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    throw new NotesValidationError("A secure feedback request could not be prepared. Please try again.");
  }
}
export function prepareFeedbackBody(value: string): string {
  const body = value.trim();
  if (!body || length(body) > NOTE_BODY_LIMIT || body.includes("\0")) throw new NotesValidationError("Enter between 1 and 4,000 characters.");
  return body;
}
export function parseTechniqueTags(value: string): string[] { return value.split(",").map(tag => tag.trim()).filter(Boolean); }
export function prepareSessionNote(value: string, tags: string[]) {
  const body = prepareFeedbackBody(value);
  const techniqueTags = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
  if (techniqueTags.length > NOTE_TAG_LIMIT || techniqueTags.some(tag => length(tag) > NOTE_TAG_LENGTH || tag.includes("\0"))) throw new NotesValidationError("Use up to 8 technique tags, each at most 40 characters.");
  return { body, techniqueTags };
}
export function notesFeedbackError(issue: unknown): string {
  if (issue instanceof NotesValidationError) return issue.message;
  const code = typeof issue === "object" && issue !== null && "code" in issue ? String(issue.code) : "";
  const message = typeof issue === "object" && issue !== null && "message" in issue ? String(issue.message) : "";
  if (code === "P0001" && message === FEEDBACK_BUDGET_MESSAGE) return FEEDBACK_BUDGET_MESSAGE;
  if (code === "22023" && message === FEEDBACK_REQUEST_CONFLICT_MESSAGE) return FEEDBACK_REQUEST_CONFLICT_MESSAGE;
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(code)) return "Notes and feedback are not available yet. The database update has not been applied.";
  if (code === "40001") return "This entry changed on another device. Your draft is kept. Reload the latest entry before saving again.";
  if (code === "42501") return "You no longer have permission to access or change this entry.";
  if (code === "22023") return "The note or feedback is invalid. Check its text, tags and Session.";
  return "The request could not be completed. Check your connection and try again. Your draft has been kept.";
}

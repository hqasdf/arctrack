import type { CoachFeedback, SessionNote } from "@arc-track/core/notes-feedback";

export type FeedbackContext = {
  viewerId: string;
  organizationId?: string;
  athleteUserId?: string;
  sessionId?: string;
};
export type NotesContext = FeedbackContext & { sessionId: string };
export type FeatureResult<T> = { ok: true; data: T } | { ok: false; message: string };
export type FeedbackPage = { entries: CoachFeedback[]; hasMore: boolean };
export type { CoachFeedback, SessionNote };

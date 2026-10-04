import { ROUND_PRESETS } from "@arc-track/core/presets";
import type { SessionType } from "@arc-track/core/scoring";

export type NewMobileSessionInput = {
  title: string;
  date: string;
  sessionType: SessionType;
};

export type SessionRpcArgs = {
  p_title: string;
  p_session_date: string;
  p_session_type: SessionType;
};

export type CreatedMobileSession = {
  id: string;
  title: string;
  date: string;
  type: SessionType;
  arrowCount: number;
};

export type RoundCreationResult = { roundId: string; roundNumber: number };

export function buildSessionRpcArgs(userId: string, input: NewMobileSessionInput): SessionRpcArgs {
  const title = input.title.trim() || "Practice session";
  if (!userId) throw new Error("Sign in again before creating a Session.");
  if (Array.from(title).length > 80) throw new Error("Session titles must be 80 characters or fewer.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(`${input.date}T00:00:00Z`))) {
    throw new Error("Choose a valid Session date.");
  }
  if (input.sessionType !== "training" && input.sessionType !== "competition") {
    throw new Error("Choose a valid Session type.");
  }

  return { p_title: title, p_session_date: input.date, p_session_type: input.sessionType };
}

export function buildDefaultRoundRpcArgs(sessionId: string) {
  const preset = ROUND_PRESETS[3];
  return {
    p_session_id: sessionId,
    p_name: preset.name,
    p_division: "Recurve",
    p_distance_metres: preset.distanceMetres,
    p_face_diameter_cm: preset.faceDiameterCm,
    p_face_type: preset.faceType,
    p_planned_ends: preset.defaultEnds,
    p_arrows_per_end: preset.defaultArrowsPerEnd,
  };
}

export function mapSessionInsertResult(data: unknown, hasError: boolean): CreatedMobileSession {
  if (hasError || typeof data !== "object" || data === null) {
    throw new Error("The Session could not be created. Check your connection and try again.");
  }
  const row = data as { id?: unknown; title?: unknown; session_date?: unknown; session_type?: unknown; arrow_count?: unknown };
  if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.session_date !== "string"
    || (row.session_type !== "training" && row.session_type !== "competition") || typeof row.arrow_count !== "number") {
    throw new Error("The Session could not be created. Check your connection and try again.");
  }
  return { id: row.id, title: row.title, date: row.session_date, type: row.session_type, arrowCount: row.arrow_count };
}

export function mapRoundCreationResult(data: unknown, hasError: boolean): RoundCreationResult {
  if (hasError || typeof data !== "object" || data === null) {
    throw new Error("The Round could not be created. Check your connection and try again.");
  }
  const row = data as { round_id?: unknown; round_number?: unknown };
  if (typeof row.round_id !== "string" || row.round_id.length === 0 || !Number.isInteger(row.round_number) || Number(row.round_number) < 1) {
    throw new Error("The Round could not be created. Check your connection and try again.");
  }
  return { roundId: row.round_id, roundNumber: Number(row.round_number) };
}

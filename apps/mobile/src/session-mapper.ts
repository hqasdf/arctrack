import type { ArrowEntry, RoundDraft, ScoreLabel, SessionDraft, TargetFaceType } from "@arc-track/core/scoring";
import { newestRoundsFirst } from "@arc-track/core/round-order";
import type { Division } from "@arc-track/core/presets";

type DbArrow = { id: string; arrow_number: number; score_points: number; is_x: boolean; plot_x: number | null; plot_y: number | null; face_index: number | null };
type DbEnd = { id?: string; end_number: number; arrows: DbArrow[] | null };
type DbRound = { id: string; round_number: number; name: string; division: string; distance_metres: number; face_diameter_cm: number; face_type: string; planned_ends: number; arrows_per_end: number; session_ends: DbEnd[] | null };
export type DbSessionDetail = { id: string; title: string; session_date: string; session_type: string; arrow_count: number; session_rounds: DbRound[] | null };

function mapArrow(row: DbArrow, end: number): ArrowEntry {
  const score = (row.is_x ? "X" : row.score_points === 0 ? "M" : String(row.score_points)) as ScoreLabel;
  const plot = row.plot_x === null || row.plot_y === null ? null : {
    x: row.plot_x,
    y: row.plot_y,
    ...(row.face_index === null ? {} : { faceIndex: row.face_index as 0 | 1 | 2 }),
  };
  return { id: row.id, end, arrow: row.arrow_number, score, plot, syncState: "saved" };
}

function mapRound(row: DbRound): RoundDraft {
  const arrows = (row.session_ends ?? [])
    .flatMap((end) => (end.arrows ?? []).map((arrow) => mapArrow(arrow, end.end_number)))
    .sort((a, b) => a.end - b.end || a.arrow - b.arrow);
  return {
    id: row.id,
    roundNumber: row.round_number,
    name: row.name,
    division: row.division as Division,
    distanceMetres: row.distance_metres,
    ends: row.planned_ends,
    arrowsPerEnd: row.arrows_per_end,
    faceDiameterCm: row.face_diameter_cm,
    faceType: row.face_type as TargetFaceType,
    arrows,
  };
}

export function mapSessionDetail(row: DbSessionDetail): SessionDraft {
  return {
    id: row.id,
    title: row.title,
    date: row.session_date,
    sessionType: row.session_type as SessionDraft["sessionType"],
    arrowCount: row.arrow_count,
    rounds: newestRoundsFirst((row.session_rounds ?? []).map(mapRound)),
  };
}

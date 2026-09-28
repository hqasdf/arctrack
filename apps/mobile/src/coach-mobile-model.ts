import type { buildCoachTeamAnalytics } from "@arc-track/core/coach-analytics";

type Team = ReturnType<typeof buildCoachTeamAnalytics>;
export function filterCoachDirectory(rows: Team["perAthlete"], search: string, division: string, activity: "all" | "recent" | "none") {
  const query = search.trim().toLowerCase();
  return rows.filter((item) => item.name.toLowerCase().includes(query) &&
    (division === "all" || item.latestSession?.rounds.some((round) => round.division === division)) &&
    (activity === "all" || (activity === "recent" ? item.sessionCount > 0 : item.sessionCount === 0)));
}

export function coachSessionNeighbors(index: Array<{ id: string }>, sessionId: string) {
  const position = index.findIndex((item) => item.id === sessionId);
  return { previous: position < 0 ? null : index[position + 1]?.id ?? null,
    next: position > 0 ? index[position - 1].id : null };
}

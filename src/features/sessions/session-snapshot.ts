import type { SessionDraft } from "@arc-track/core/scoring";

/** Stable comparison only, never a write revision or an authorization token. */
export function sessionSnapshot(session:SessionDraft) {
  return JSON.stringify([session.id,session.title,session.date,session.sessionType,session.arrowCount,
    session.rounds.map(round=>[round.id,round.roundNumber,round.name,round.division,round.distanceMetres,round.faceDiameterCm,
      round.faceType,round.ends,round.arrowsPerEnd,[...round.arrows].sort((a,b)=>a.end-b.end||a.arrow-b.arrow).map(a=>
        [a.id,a.end,a.arrow,a.score,a.plot?.x??null,a.plot?.y??null,a.plot?.faceIndex??null])])]);
}

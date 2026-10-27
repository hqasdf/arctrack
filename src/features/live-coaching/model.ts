import { roundTotal, type SessionDraft } from '@/features/sessions/scoring-model';
export type LiveSession={id:string;organization_id:string;created_by:string;title:string;training_date:string;state:'created'|'waiting'|'active'|'completed'|'cancelled';version:number;organization_name?:string;started_at?:string|null;ended_at?:string|null};
export type Participant={athleteId:string;displayName:string;state:'invited'|'joined'|'declined'|'left';scoringSessionId:string|null;scoring:SessionDraft|null};
export type LiveData={session:LiveSession;coach:boolean;viewerId:string;organizationName:string;participants:Participant[];eligibleSessions:{id:string;title:string;session_date:string}[]};
export type LiveIndex={sessions:LiveSession[];roster:{userId:string;displayName:string}[]};
export function scoringProgress(session:SessionDraft|null){
 const rounds=[...(session?.rounds??[])].sort((a,b)=>a.roundNumber-b.roundNumber).map(round=>{const ends=Array.from({length:round.ends},(_,i)=>{const number=i+1,arrows=round.arrows.filter(a=>a.end===number&&a.syncState!=='failed'&&a.syncState!=='saving').sort((a,b)=>a.arrow-b.arrow);return {number,arrows,complete:arrows.length===round.arrowsPerEnd,total:roundTotal(arrows)};});return {round,ends};});
 const complete=rounds.flatMap(r=>r.ends.filter(e=>e.complete)),arrows=rounds.flatMap(r=>r.ends.flatMap(e=>e.arrows));
 return {rounds,completedEnds:complete.length,plannedEnds:rounds.reduce((n,r)=>n+r.round.ends,0),confirmedTotal:complete.reduce((n,e)=>n+e.total,0),savedArrows:arrows.length,savedArrowTotal:roundTotal(arrows),provisionalArrows:rounds.flatMap(r=>r.ends.filter(e=>!e.complete).flatMap(e=>e.arrows)).length,latest:complete.at(-1)??null,finished:rounds.length>0&&complete.length===rounds.reduce((n,r)=>n+r.round.ends,0)};
}

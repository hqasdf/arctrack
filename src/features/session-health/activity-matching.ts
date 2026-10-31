import type { HRCandidate, SessionActivityLink } from './model';
export function isGarminArchery(type: string|null|undefined):boolean {
 // Official Activity API category is ARCHERY. Case is normalized; names never classify sport.
 return typeof type==='string'&&type.trim().toUpperCase()==='ARCHERY';
}
export type ActivityMatch={mode:'explicit'|'automatic'|'waiting'|'unlinked';activity:HRCandidate|null;activities:HRCandidate[];incomplete:boolean;reason:string};
export function matchSessionActivity(candidates:HRCandidate[],link:SessionActivityLink|null,_sessionsOnDay=1,excluded:readonly string[]=[],sessionDate?:string,discoveryComplete=false):ActivityMatch {
 void _sessionsOnDay; // Compatibility only; peer Session count no longer restricts matching.
 const incomplete=!discoveryComplete&&candidates.length>=50;
 if(link&&link.activity_id===null)return {mode:'unlinked',activity:null,activities:[],incomplete,reason:'Your explicit unlink is preserved. Choose an activity manually to change this decision.'};
 const valid=[...new Map(candidates.filter(c=>Number.isSafeInteger(c.start_seconds)&&Number.isFinite(new Date(c.start_seconds*1000).getTime())&&Number.isFinite(c.duration_seconds)&&c.duration_seconds>0&&['summary_only','receiving','complete','conflict'].includes(c.state)).map(c=>[c.source_id,c])).values()];
 const activities=valid.filter(c=>isGarminArchery(c.activity_type)&&(!sessionDate||new Date(c.start_seconds*1000+8*3600000).toISOString().slice(0,10)===sessionDate)&&!excluded.includes(c.source_id)).sort((a,b)=>a.start_seconds-b.start_seconds||a.source_id.localeCompare(b.source_id));
 const explicit=link?valid.find(c=>c.source_id===link.activity_id&&!excluded.includes(c.source_id))??null:null;
 return {mode:link?'explicit':activities.length?'automatic':'waiting',activity:link?explicit:activities[0]??null,activities,incomplete,
  reason:incomplete?'Activity discovery reached 50 records. This list may be incomplete; it is not a complete day of Archery activities.':`${activities.length} same-day Archery ${activities.length===1?'activity':'activities'}. Date matching does not prove participation in this specific Session.`};
}

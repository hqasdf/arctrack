import "server-only";
import { requireUser } from "@/lib/auth/session.server";
import { createAuthClient } from "@/lib/supabase/server";
import { newestRoundsFirst } from "@arc-track/core/round-order";
import type { ArrowEntry, RoundDraft, SessionDraft, SessionType, TargetFaceType } from "./scoring-model";
import type { Division } from "./round-presets";

type DbArrow={id:string;arrow_number:number;score_points:number;is_x:boolean;plot_x:number|null;plot_y:number|null;face_index:number|null};
type DbEnd={id?:string;end_number:number;arrows:DbArrow[]|null};
type DbRound={id:string;round_number:number;name:string;division:string;distance_metres:number;face_diameter_cm:number;face_type:string;planned_ends:number;arrows_per_end:number;session_ends:DbEnd[]|null};
export type DbSession={id:string;title:string;session_date:string;session_type:string;arrow_count:number;created_at:string;session_rounds:DbRound[]|null};
export const SESSION_DETAIL_SELECT=`
  id,title,session_date,session_type,arrow_count,created_at,
  session_rounds(id,round_number,name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end,
    session_ends(end_number,arrows(id,arrow_number,score_points,is_x,plot_x,plot_y,face_index)))
`;

export async function readSessions(options?:{sessionType?:SessionType}):Promise<SessionDraft[]> {
  const user=await requireUser();
  const supabase=await createAuthClient();
  function buildQuery() {
    let query=supabase.from("sessions").select(SESSION_DETAIL_SELECT).eq("user_id",user.id).order("session_date",{ascending:false}).order("created_at",{ascending:false});
    if (options?.sessionType) query=query.eq("session_type",options.sessionType);
    return query;
  }
  const {data,error}=await buildQuery();
  if (error) throw new Error("Sessions could not be loaded.");
  return ((data??[]) as unknown as DbSession[]).map(mapSession);
}

export function mapSession(row:DbSession):SessionDraft {
  const rounds=(row.session_rounds??[]).map(mapRound);
  return {id:row.id,title:row.title,date:row.session_date,sessionType:row.session_type as SessionType,arrowCount:row.arrow_count,rounds:newestRoundsFirst(rounds)};
}

function mapRound(row:DbRound):RoundDraft {
  const arrows:ArrowEntry[]=(row.session_ends??[]).sort((a,b)=>a.end_number-b.end_number).flatMap((end)=>(end.arrows??[]).sort((a,b)=>a.arrow_number-b.arrow_number).map((arrow)=>({
    id:arrow.id,end:end.end_number,arrow:arrow.arrow_number,score:arrow.is_x?"X":arrow.score_points===0?"M":String(arrow.score_points) as ArrowEntry["score"],
    plot:arrow.plot_x===null||arrow.plot_y===null?null:{x:arrow.plot_x,y:arrow.plot_y,...(arrow.face_index===null?{}:{faceIndex:arrow.face_index as 0|1|2})},syncState:"saved" as const,
  })));
  return {id:row.id,roundNumber:row.round_number,name:row.name,division:row.division as Division,distanceMetres:row.distance_metres,ends:row.planned_ends,arrowsPerEnd:row.arrows_per_end,faceDiameterCm:row.face_diameter_cm,faceType:row.face_type as TargetFaceType,arrows};
}

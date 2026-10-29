import "server-only";
import { requireUser } from "@/lib/auth/session.server";
import { createAuthClient } from "@/lib/supabase/server";
import { isUuid, validateArrowInput } from "./validation";
import type { ArrowIntent, ArrowSnapshot } from "@arc-track/core/arrow-persistence";
import type { ArrowEntry } from "./scoring-model";

type Slot = { roundId: string; end: number; arrow: number };
async function ownedSlot(slot: Slot) {
  await requireUser();
  if (!isUuid(slot.roundId) || ![slot.end,slot.arrow].every(v=>Number.isInteger(v)&&v>0&&v<=32767)) throw Error("Invalid Arrow slot.");
  const client = await createAuthClient({writable:true});
  const result = await client.from("session_ends").select("id").eq("session_round_id",slot.roundId).eq("end_number",slot.end).maybeSingle();
  if (result.error || !result.data) throw Error("The planned End is unavailable.");
  return {client,endId:result.data.id};
}
function snapshot(raw: unknown, slot: Slot): ArrowSnapshot {
  const data = raw as {revision:string;arrow:null|{id:string;arrow_number:number;score_points:number;is_x:boolean;plot_x:number|null;plot_y:number|null;face_index:number|null}};
  if (!data || typeof data.revision!=="string" || !("arrow" in data)) throw Error("Arrow confirmation unavailable.");
  const a=data.arrow;
  return {revision:data.revision,arrow:a?{id:a.id,end:slot.end,arrow:a.arrow_number,score:a.is_x?"X":a.score_points===0?"M":String(a.score_points) as ArrowEntry["score"],
    plot:a.plot_x===null||a.plot_y===null?null:{x:a.plot_x,y:a.plot_y,...(a.face_index===null?{}:{faceIndex:a.face_index as 0|1|2})},syncState:"saved"}:null};
}
export async function readArrowSlot(slot: Slot): Promise<ArrowSnapshot> {
  const {client,endId}=await ownedSlot(slot);
  const {data,error}=await client.rpc("read_owned_arrow_slot",{p_end:endId,p_number:slot.arrow});
  if(error) throw Error("The Arrow could not be verified. Retry or reload this Round.");
  return snapshot(data,slot);
}
export async function writeArrowSlot(slot: Slot, desired: ArrowEntry|null, intent: ArrowIntent): Promise<ArrowSnapshot> {
  if(!intent||!isUuid(intent.requestId)||!/^([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i.test(intent.expectedRevision))throw Error("Invalid Arrow request.");
  const valid=desired?validateArrowInput({roundId:slot.roundId,endNumber:slot.end,arrowNumber:slot.arrow,score:desired.score,plot:desired.plot}):null;
  if(valid&&!valid.ok)throw Error(valid.message);
  const {client,endId}=await ownedSlot(slot),value=valid?.ok?valid.value:null;
  const {data,error}=await client.rpc("write_owned_arrow_slot",{p_end:endId,p_number:slot.arrow,p_expected:intent.expectedRevision,p_request:intent.requestId,
    p_arrow:value?{score_points:value.scorePoints,is_x:value.isX,plot_x:value.plot?.x??null,plot_y:value.plot?.y??null,face_index:value.plot?.faceIndex??null}:null});
  if(error)throw Error(error.code==="40001"?"This Arrow changed. Retry to reconcile, or reload this Round.":"The Arrow change could not be confirmed. Retry or reload this Round.");
  return snapshot(data,slot);
}

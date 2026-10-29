import type { ArrowEntry } from "@arc-track/core/scoring";
import { arrowWriteFields } from "./arrow-write-model";
import { supabase } from "./supabase";
import { createArrowPersistence, type ArrowSnapshot } from "@arc-track/core/arrow-persistence";

function client() {
  if (!supabase) throw new Error("Arc Track could not connect to Supabase.");
  return supabase;
}

export async function readRoundEndIds(roundId: string): Promise<Map<number, string>> {
  const { data, error } = await client().from("session_ends")
    .select("id,end_number")
    .eq("session_round_id", roundId)
    .order("end_number");
  if (error) throw new Error("The planned Ends could not be loaded. Check your connection and try again.");
  return new Map((data ?? []).map((row) => [row.end_number, row.id]));
}

async function requireCurrentOwner(expectedUserId?: string) {
  if (!expectedUserId) return;
  const { data, error } = await client().auth.getSession();
  if (error || data.session?.user.id !== expectedUserId) throw new Error("The scoring account changed. Sign in again before saving.");
}

function mobileSnapshot(raw: unknown, end: number): ArrowSnapshot {
  const row = raw as { revision: string; arrow: null | { id: string; arrow_number: number; score_points: number; is_x: boolean; plot_x: number | null; plot_y: number | null; face_index: number | null } };
  if (!row || typeof row.revision !== "string" || !("arrow" in row)) throw Error("Arrow confirmation unavailable.");
  const a = row.arrow;
  return { revision: row.revision.toLowerCase(), arrow: a ? { id: a.id, end, arrow: a.arrow_number,
    score: a.is_x ? "X" : a.score_points === 0 ? "M" : String(a.score_points) as ArrowEntry["score"],
    plot: a.plot_x === null || a.plot_y === null ? null : { x: a.plot_x, y: a.plot_y,
      ...(a.face_index === null ? {} : { faceIndex: a.face_index as 0 | 1 | 2 }) }, syncState: "saved" } : null };
}
async function offlineSlotCall(slot: { end: number; arrow: number }, endId: string, owner: string, name: string, args: Record<string, unknown>) {
  await requireCurrentOwner(owner);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const { data, error } = await client().rpc(name, { p_end: endId, p_number: slot.arrow, ...args }).abortSignal(controller.signal);
    await requireCurrentOwner(owner);
    if (error) throw Object.assign(Error("The server revision could not be verified. Check sign-in and connectivity. Offline scoring requires the scoring-integrity migration."), { code: error.code });
    return mobileSnapshot(data, slot.end);
  } finally { clearTimeout(timer); }
}
export function readMobileArrowSnapshot(slot: { end: number; arrow: number }, endId: string, owner: string) {
  return offlineSlotCall(slot, endId, owner, "read_owned_arrow_slot", {});
}
export function writeMobileArrowSnapshot(slot: { end: number; arrow: number }, endId: string, desired: ArrowEntry | null, expected: string, request: string, owner: string) {
  return offlineSlotCall(slot, endId, owner, "write_owned_arrow_slot", { p_expected: expected, p_request: request, p_arrow: desired ? arrowWriteFields(desired) : null });
}

/** Loaded-Round writer with authoritative reconciliation and durable CAS fences. */
export function createMobileArrowPersistence(initial:ArrowEntry[],endIds:Map<number,string>,owner:string) {
  function snapshot(raw:unknown,end:number):ArrowSnapshot {
    const row=raw as {revision:string;arrow:null|{id:string;arrow_number:number;score_points:number;is_x:boolean;plot_x:number|null;plot_y:number|null;face_index:number|null}};
    if(!row||typeof row.revision!=="string"||!("arrow" in row))throw Error("Arrow confirmation unavailable.");
    const a=row.arrow;
    return {revision:row.revision,arrow:a?{id:a.id,end,arrow:a.arrow_number,score:a.is_x?"X":a.score_points===0?"M":String(a.score_points) as ArrowEntry["score"],
      plot:a.plot_x===null||a.plot_y===null?null:{x:a.plot_x,y:a.plot_y,...(a.face_index===null?{}:{faceIndex:a.face_index as 0|1|2})},syncState:"saved"}:null};
  }
  async function call(end:number,name:string,args:Record<string,unknown>) {
    await requireCurrentOwner(owner);
    const endId=endIds.get(end);if(!endId)throw Error("The planned End is unavailable.");
    const {data,error}=await client().rpc(name,{p_end:endId,...args});
    await requireCurrentOwner(owner);
    if(error)throw Error("The Arrow change could not be confirmed. Retry to reconcile, or reload this Round.");
    return snapshot(data,end);
  }
  return createArrowPersistence({initial,
    requestId:()=>{const id=globalThis.expo?.uuidv4?.();if(!id)throw Error("Secure Arrow request generation unavailable.");return id;},
    read:slot=>call(slot.end,"read_owned_arrow_slot",{p_number:slot.arrow}),
    write:(slot,desired,intent)=>call(slot.end,"write_owned_arrow_slot",{p_number:slot.arrow,p_expected:intent.expectedRevision,p_request:intent.requestId,p_arrow:desired?arrowWriteFields(desired):null})});
}

export async function saveArrowRecord(entry: ArrowEntry, endId: string, savedId?: string, expectedUserId?: string): Promise<string> {
  await requireCurrentOwner(expectedUserId);
  const fields = arrowWriteFields(entry);
  const { data, error } = await client().rpc("save_owned_arrow", {
    p_session_end_id: endId,
    p_arrow_number: entry.arrow,
    p_score_points: fields.score_points,
    p_is_x: fields.is_x,
    p_plot_x: fields.plot_x,
    p_plot_y: fields.plot_y,
    p_face_index: fields.face_index,
    p_arrow_id: savedId ?? null,
  }).single<{ id: string }>();
  if (error || !data) throw new Error("The Arrow could not be saved. Select it and retry.");
  return data.id;
}

export async function deleteArrowRecord(savedId: string, endId: string, expectedUserId?: string): Promise<void> {
  await requireCurrentOwner(expectedUserId);
  const { data, error } = await client().rpc("delete_owned_arrow", {
    p_session_end_id: endId, p_arrow_number: null, p_arrow_id: savedId,
  });
  if (error || data !== true) throw new Error("The Arrow could not be deleted. Try again.");
}

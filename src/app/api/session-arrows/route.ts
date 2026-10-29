import { revalidatePath } from "next/cache";
import { saveArrowRecord } from "@/features/sessions/arrow-save.server";
import type { ArrowInput } from "@/features/sessions/validation";
import { readArrowSlot, writeArrowSlot } from "@/features/sessions/arrow-slot.server";
import type { ArrowEntry } from "@/features/sessions/scoring-model";
import type { ArrowIntent } from "@arc-track/core/arrow-persistence";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const maxBodyBytes = 16 * 1024;
class ArrowBodyTooLarge extends Error {}

async function readArrowBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maxBodyBytes) throw new ArrowBodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing Arrow input");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        await reader.cancel();
        throw new ArrowBodyTooLarge();
      }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally { reader.releaseLock(); }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return Response.json({ ok: false, message: "The Arrow could not be saved." }, { status: 403, headers: privateHeaders });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return Response.json({ ok: false, message: "The Arrow could not be saved." }, { status: 415, headers: privateHeaders });
  }
  try {
    const input = await readArrowBody(request);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid Arrow input");
    if ("intent" in input) {
      const value=input as ArrowInput & {intent:ArrowIntent;deleted?:boolean};
      const slot={roundId:value.roundId,end:value.endNumber,arrow:value.arrowNumber};
      const desired:ArrowEntry|null=value.deleted===true?null:{id:"pending",end:slot.end,arrow:slot.arrow,score:value.score as ArrowEntry["score"],plot:value.plot};
      const snapshot=await writeArrowSlot(slot,desired,value.intent);
      revalidatePath("/sessions");
      return Response.json({ok:true,snapshot},{headers:privateHeaders});
    }
    const result = await saveArrowRecord(input as ArrowInput);
    if (result.ok) revalidatePath("/sessions");
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    return Response.json({ ok: false, message: "The Arrow could not be saved. Check your connection and retry." }, {
      status: error instanceof ArrowBodyTooLarge ? 413 : 400, headers: privateHeaders,
    });
  }
}

export async function GET(request:Request) {
  if(request.headers.get("sec-fetch-site")==="cross-site")return Response.json({ok:false},{status:403,headers:privateHeaders});
  try {
    const query=new URL(request.url).searchParams;
    const snapshot=await readArrowSlot({roundId:query.get("roundId")??"",end:Number(query.get("end")),arrow:Number(query.get("arrow"))});
    return Response.json({ok:true,snapshot},{headers:privateHeaders});
  }catch{return Response.json({ok:false,message:"The Arrow could not be verified. Retry or reload this Round."},{status:400,headers:privateHeaders});}
}

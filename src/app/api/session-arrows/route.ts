import { revalidatePath } from "next/cache";
import { saveArrowRecord } from "@/features/sessions/arrow-save.server";
import type { ArrowInput } from "@/features/sessions/validation";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return Response.json({ ok: false, message: "The Arrow could not be saved." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ ok: false, message: "The Arrow could not be saved." }, { status: 415 });
  }
  try {
    const input = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid Arrow input");
    const result = await saveArrowRecord(input as ArrowInput);
    if (result.ok) revalidatePath("/sessions");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, message: "The Arrow could not be saved. Check your connection and retry." }, { status: 400 });
  }
}

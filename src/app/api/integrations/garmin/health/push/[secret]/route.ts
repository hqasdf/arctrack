import { privateGarminHealthPush } from "@/features/garmin/health/private-push.server";
export const runtime = "nodejs";
export const maxDuration = 25;
export async function POST(request: Request, { params }: { params: Promise<{ secret: string }> }) {
  return privateGarminHealthPush(request, (await params).secret);
}

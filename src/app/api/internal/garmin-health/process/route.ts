import { garminHealthWorker } from "@/features/garmin/health/http.server";
export const runtime = "nodejs";
export const maxDuration = 25;
export const GET = garminHealthWorker;

import { approximateLocation } from "@arc-track/core/weather";
import { readWeatherJson } from "@/features/weather/http.server";
import { captureSessionWeather, isWeatherId, readSessionWeather, weatherIdentity } from "@/features/weather/service.server";

const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer" };
function unavailable(status = 400) { return Response.json({ ok: false, message: "Weather unavailable" }, { status, headers }); }
function safeOrigin(request: Request, mutation: boolean) {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  return !mutation || origin !== null || request.headers.has("authorization");
}

export async function GET(request: Request) {
  if (!safeOrigin(request, false)) return unavailable(403);
  const id = new URL(request.url).searchParams.get("sessionId");
  if (!isWeatherId(id)) return unavailable();
  try {
    const identity = await weatherIdentity(request);
    if (!identity) return unavailable(401);
    return Response.json(await readSessionWeather(identity, id), { headers });
  } catch { return unavailable(); }
}

export async function POST(request: Request) {
  if (!safeOrigin(request, true)) return unavailable(403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return unavailable(415);
  try {
    const identity = await weatherIdentity(request);
    if (!identity) return unavailable(401);
    const input = await readWeatherJson(request, 2048);
    if (!input || typeof input !== "object" || Array.isArray(input)) return unavailable();
    const body = input as Record<string, unknown>;
    if (Object.keys(body).some(key => !["roundId", "location"].includes(key)) || !isWeatherId(body.roundId)
      || !body.location || typeof body.location !== "object" || Array.isArray(body.location)) return unavailable();
    const location = body.location as Record<string, unknown>;
    if (Object.keys(location).some(key => !["latitude", "longitude"].includes(key))
      || typeof location.latitude !== "number" || typeof location.longitude !== "number") return unavailable();
    const coarse = approximateLocation(location.latitude, location.longitude);
    return Response.json(await captureSessionWeather(identity, body.roundId, coarse), { headers });
  } catch { return unavailable(); }
}

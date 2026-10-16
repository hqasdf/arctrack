import "server-only";

/** Bounded streams, including chunked bodies with no Content-Length. */
export async function readWeatherJson(message: Request | Response, limit: number): Promise<unknown> {
  if (Number(message.headers.get("content-length")) > limit) throw new Error("Weather unavailable");
  const reader = message.body?.getReader();
  if (!reader) throw new Error("Weather unavailable");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error("Weather unavailable"); }
      text += decoder.decode(result.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

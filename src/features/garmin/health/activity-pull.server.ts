import "server-only";
import { normalizeGarminActivityDetails, normalizeGarminPush } from "./normalize.server";
import type { GarminAdmissionResult } from "./store.server";
import type { GarminHealthEvent } from "./types";

export const GARMIN_ACTIVITY_RESPONSE_LIMIT = 16 * 1024 * 1024;
const CALLBACK_ROOT = "https://apis.garmin.com/wellness-api/rest/";
type PullKind = "activities" | "activityDetails";
export type GarminActivityPullJob = {
  id: string; user_id: string; garmin_user_id: string; source_id: string;
  pull_kind: PullKind; callback_ciphertext: string; lease_token: string;
};
type SafeFailure = "network_retryable" | "provider_retryable" | "provider_rejected" | "invalid_callback" | "invalid_response" | "response_too_large" | "storage_retryable";
export class GarminActivityPullError extends Error {
  constructor(readonly code: SafeFailure) { super("Garmin Activity Details pull could not be completed."); }
}
type Dependencies = {
  claim(limit: number): Promise<GarminActivityPullJob[]>;
  finish(id: string, leaseToken: string, outcome: "complete" | "retry" | "reject", code: SafeFailure | null): Promise<void>;
  decrypt(job: GarminActivityPullJob): string;
  stage(events: GarminHealthEvent[]): Promise<GarminAdmissionResult>;
  fetcher?: typeof fetch;
};

function safeCallback(value: string, expected: PullKind): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new GarminActivityPullError("invalid_callback"); }
  if (url.origin !== "https://apis.garmin.com" || url.hostname !== "apis.garmin.com" || url.port
    || url.username || url.password || url.hash || url.pathname !== `/wellness-api/rest/${expected}`
    || url.searchParams.size !== 3 || new Set([...url.searchParams.keys()]).size !== 3
    || [...url.searchParams.keys()].some(key => !["uploadStartTimeInSeconds", "uploadEndTimeInSeconds", "token"].includes(key))
    || !url.searchParams.get("token") || url.searchParams.get("token")!.length > 4096) {
    throw new GarminActivityPullError("invalid_callback");
  }
  return url;
}

async function readJsonBounded(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > GARMIN_ACTIVITY_RESPONSE_LIMIT)) throw new GarminActivityPullError("response_too_large");
  const media = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (media !== "application/json" && !/^application\/[a-z0-9.+-]+\+json$/.test(media)) throw new GarminActivityPullError("invalid_response");
  const reader = response.body?.getReader();
  if (!reader) throw new GarminActivityPullError("invalid_response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > GARMIN_ACTIVITY_RESPONSE_LIMIT) {
        await reader.cancel();
        throw new GarminActivityPullError("response_too_large");
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new GarminActivityPullError("invalid_response"); }
}

function retryable(status: number): boolean { return status === 408 || status === 425 || status === 429 || status >= 500; }
function safeEvents(job: GarminActivityPullJob, body: unknown): GarminHealthEvent[] {
  if (job.pull_kind === "activityDetails") return normalizeGarminActivityDetails(body, job.garmin_user_id);
  const events = normalizeGarminPush({ activities: Array.isArray(body) ? body.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const row = item as Record<string, unknown>;
    if (row.userId != null && row.userId !== job.garmin_user_id) throw new GarminActivityPullError("invalid_response");
    return { ...row, userId: job.garmin_user_id };
  }) : body });
  // The callback response is a summary list, never a second callback ping.
  if (events.some(event => event.activityDetailsPull || event.heartRate)) throw new GarminActivityPullError("invalid_response");
  return events;
}

export function createGarminActivityPullProcessor(deps: Dependencies) {
  const fetcher = deps.fetcher ?? fetch;
  return async (limit = 3): Promise<number> => {
    const jobs = await deps.claim(Math.min(5, Math.max(1, Math.trunc(limit))));
    if (!Array.isArray(jobs) || jobs.length > 5) throw new Error("Garmin Activity processing unavailable.");
    let handled = 0;
    for (const job of jobs) {
      let outcome: "complete" | "retry" | "reject" = "complete";
      let code: SafeFailure | null = null;
      try {
        const url = safeCallback(deps.decrypt(job), job.pull_kind);
        const response = await fetcher(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20000), headers: { Accept: "application/json" } });
        if (response.status < 200 || response.status >= 300) {
          outcome = retryable(response.status) ? "retry" : "reject";
          code = retryable(response.status) ? "provider_retryable" : "provider_rejected";
        } else {
          const events = safeEvents(job, await readJsonBounded(response));
          if (events.length > 30000) throw new GarminActivityPullError("invalid_response");
          let accepted = 0, duplicates = 0;
          for (let offset = 0; offset < events.length; offset += 100) {
            const result = await deps.stage(events.slice(offset, offset + 100));
            if (!result || !["accepted", "duplicate", "ineligible"].includes(result.status)
              || result.accepted + result.duplicate + result.ineligible !== Math.min(100, events.length - offset)) {
              throw new GarminActivityPullError("storage_retryable");
            }
            accepted += result.accepted;
            duplicates += result.duplicate;
            if (result.status === "temporary" || result.status === "storage_failure") throw new GarminActivityPullError("storage_retryable");
          }
          if (events.length > 0 && accepted === 0 && duplicates === 0) {
            outcome = "reject";
            code = "provider_rejected";
          }
        }
      } catch (error) {
        if (error instanceof GarminActivityPullError) {
          code = error.code;
          outcome = ["network_retryable", "provider_retryable", "storage_retryable"].includes(error.code) ? "retry" : "reject";
        } else {
          // fetch/timeout exceptions and storage transport errors retry without logging the URL.
          code = "network_retryable";
          outcome = "retry";
        }
      }
      try { await deps.finish(job.id, job.lease_token, outcome, code); }
      catch { throw new Error("Garmin Activity processing unavailable."); }
      handled++;
    }
    return handled;
  };
}

export const garminActivityCallbackRoot = CALLBACK_ROOT;

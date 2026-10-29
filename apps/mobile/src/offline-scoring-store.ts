import { arrowKey, SCORE_LABELS, type ArrowEntry, type RoundDraft, type SessionDraft } from "@arc-track/core/scoring";
import type { ArrowSnapshot } from "@arc-track/core/arrow-persistence";

export type Slot = { end: number; arrow: number };
export type CachedRound = { session: SessionDraft; round: RoundDraft };
export function offlineRoundConfiguration(round: RoundDraft) {
  return JSON.stringify([round.id, round.roundNumber, round.name, round.division, round.distanceMetres,
    round.ends, round.arrowsPerEnd, round.faceDiameterCm, round.faceType]);
}
type Mutation = Slot & { id: string; desired: ArrowEntry | null; expected?: string; conflict?: ArrowSnapshot };
export type OfflineRecord = {
  version: 1; owner: string; roundId: string; loaded: CachedRound;
  ends: [number, string][]; baselines: Record<string, ArrowSnapshot>;
  queue: Mutation[]; review: { mutations: Mutation[]; remote: ArrowSnapshot; choice: "device" | "server" }[];
};
export type OfflineStatus = "synced" | "device" | "waiting" | "syncing" | "failed" | "conflict";
export type OfflineView = { loaded: CachedRound; arrows: ArrowEntry[]; status: OfflineStatus; pending: number;
  conflicts: { slot: Slot; device: ArrowEntry | null; server: ArrowEntry | null }[]; message?: string };
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const LIMIT = 900_000; // Below Android AsyncStorage's usual per-entry CursorWindow limit.
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
// Accidental-corruption detector only, not authentication or encryption. Trust
// still comes from SecureStore identity, server revisions and Supabase RLS.
function fingerprint(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
const validInt = (n: number, max: number) => Number.isInteger(n) && n > 0 && n <= max;
function same(a: ArrowEntry | null, b: ArrowEntry | null) {
  return a === null || b === null ? a === b : a.score === b.score &&
    a.end === b.end && a.arrow === b.arrow && a.plot?.x === b.plot?.x &&
    a.plot?.y === b.plot?.y && a.plot?.faceIndex === b.plot?.faceIndex;
}
function validArrow(a: ArrowEntry | null, slot: Slot): boolean {
  return a === null || !!a && typeof a.id === "string" && a.end === slot.end && a.arrow === slot.arrow &&
    SCORE_LABELS.includes(a.score) && (a.plot === null || !!a.plot && Number.isFinite(a.plot.x) &&
    Number.isFinite(a.plot.y) && Math.abs(a.plot.x) <= 2 && Math.abs(a.plot.y) <= 2 &&
    (a.plot.faceIndex === undefined || [0, 1, 2].includes(a.plot.faceIndex)));
}
export function verifyOfflineRecord(value: unknown, owner: string, roundId: string, trustedPreparation = false): OfflineRecord {
  const { integrity, ...body } = (value ?? {}) as OfflineRecord & { integrity?: string };
  const r = body as OfflineRecord;
  try {
    if (!trustedPreparation && integrity !== fingerprint(JSON.stringify(body))) throw Error();
    if (!r || r.version !== 1 || r.owner !== owner || r.roundId !== roundId ||
      r.loaded.round.id !== roundId || !UUID.test(r.loaded.session.id) ||
      !validInt(r.loaded.round.ends, 120) || !validInt(r.loaded.round.arrowsPerEnd, 60) ||
      !Array.isArray(r.ends) || r.ends.length !== r.loaded.round.ends ||
      !Array.isArray(r.queue) || !Array.isArray(r.review) || !r.baselines || Array.isArray(r.baselines) ||
      Object.keys(r.baselines).length !== r.loaded.round.ends * r.loaded.round.arrowsPerEnd) throw Error();
    if (typeof r.loaded.session.title !== "string" || typeof r.loaded.session.date !== "string" ||
      !["training", "competition"].includes(r.loaded.session.sessionType) ||
      typeof r.loaded.round.name !== "string" || typeof r.loaded.round.division !== "string" ||
      !validInt(r.loaded.round.roundNumber, 32767)) throw Error();
    if (new Set(r.ends.map(([n, id]) => { if (!validInt(n, r.loaded.round.ends) || !UUID.test(id)) throw Error(); return n; })).size !== r.ends.length) throw Error();
    if (new Set(r.ends.map(([, id]) => id)).size !== r.ends.length) throw Error();
    const slot = (s: Slot) => validInt(s.end, r.loaded.round.ends) && validInt(s.arrow, r.loaded.round.arrowsPerEnd);
    const snapshot = (s: ArrowSnapshot, p: Slot) => s && UUID.test(s.revision) && validArrow(s.arrow, p);
    for (let end = 1; end <= r.loaded.round.ends; end++) for (let arrow = 1; arrow <= r.loaded.round.arrowsPerEnd; arrow++) {
      if (!snapshot(r.baselines[arrowKey(end, arrow)], { end, arrow })) throw Error();
    }
    const ids = new Set<string>();
    for (const m of r.queue) {
      if (!slot(m) || !UUID.test(m.id) || ids.has(m.id) || !validArrow(m.desired, m) ||
        m.expected !== undefined && !UUID.test(m.expected) || m.conflict && !snapshot(m.conflict, m)) throw Error();
      ids.add(m.id);
    }
    if (!["full_face", "six_ring", "triple_face"].includes(r.loaded.round.faceType) ||
      !Number.isFinite(r.loaded.round.faceDiameterCm) || r.loaded.round.faceDiameterCm <= 0 ||
      !Number.isFinite(r.loaded.round.distanceMetres)) throw Error();
  } catch { throw Error("Offline scoring storage is incompatible or damaged. Its contents were preserved; do not clear app storage. Restore connectivity or contact support."); }
  return r;
}

/** A single owned-Round journal. The adapter supplies one instance per storage key.
 * Storage is serialized, but network I/O never holds the local-edit queue.
 */
export function createOfflineRound(input: {
  owner: string; roundId: string; storage: Storage; current(): boolean; requestId(): string;
  read(slot: Slot, endId: string): Promise<ArrowSnapshot>;
  write(slot: Slot, endId: string, desired: ArrowEntry | null, expected: string, id: string): Promise<ArrowSnapshot>;
}) {
  const key = `arctrack:offline-scoring:v1:${input.owner}:${input.roundId}`;
  let record: OfflineRecord | null = null, tail: Promise<unknown> = Promise.resolve(), syncing: Promise<void> | null = null;
  let status: OfflineStatus = "synced", stopped = true, generation = 0, storageFailed = false;
  let failureMessage: string | undefined;
  // A native storage failure cannot be made crash-durable. Keep its exact latest
  // intentions visible in memory; never let unrelated acknowledgments erase them.
  const unsaved = new Map<string, Mutation>();
  const listeners = new Set<(view: OfflineView) => void>();
  const current = () => { if (!input.current()) throw Error("The scoring account changed. Sign in to the original account to recover its device scores."); };
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const job = tail.catch(() => {}).then(work); tail = job.catch(() => {}); return job;
  }
  function view(): OfflineView {
    current(); if (!record) throw Error("No prepared offline Round is available.");
    const arrows = new Map<string, ArrowEntry>(Object.entries(record.baselines).flatMap(([key, s]) => s.arrow ? [[key, { ...s.arrow, syncState: "saved" as const }] as const] : []));
    for (const m of record.queue) {
      const k = arrowKey(m.end, m.arrow);
      if (m.desired) arrows.set(k, { ...m.desired, syncState: "saving" }); else arrows.delete(k);
    }
    for (const [key, m] of unsaved) {
      if (m.desired) arrows.set(key, { ...m.desired, syncState: "failed" }); else arrows.delete(key);
    }
    const conflicts = record.queue.filter(m => m.conflict).map(m => ({ slot: { end: m.end, arrow: m.arrow },
      device: [...record!.queue].reverse().find(n => n.end === m.end && n.arrow === m.arrow)!.desired, server: m.conflict!.arrow }));
    return { loaded: clone(record.loaded), arrows: clone([...arrows.values()]), status: unsaved.size ? "failed" : conflicts.length ? "conflict" : status, pending: record.queue.length + unsaved.size, conflicts: clone(conflicts), message: unsaved.size ? "Device save could not be verified. Keep the app open and retry device storage." : failureMessage };
  }
  function publish() { if (record && input.current()) for (const listener of listeners) listener(view()); }
  async function commit(next: OfflineRecord) {
    current();
    const payload = JSON.stringify(next);
    const raw = payload.slice(0, -1) + `,"integrity":"${fingerprint(payload)}"}`;
    if (raw.length * 3 > LIMIT) { status = "failed"; throw Error("Device scoring storage is full for this Round. Existing scores were kept. Keep the app open and synchronize or recover device data before adding more."); }
    try {
      // If native write commits but its acknowledgment is lost, read-back settles it.
      try { await input.storage.setItem(key, raw); }
      catch { if (await input.storage.getItem(key) !== raw) throw Error(); }
      if (await input.storage.getItem(key) !== raw) throw Error();
    } catch { storageFailed = true; status = "failed"; throw Error("Device save could not be verified. Stop scoring and retry; do not close or clear the app."); }
    record = JSON.parse(payload) as OfflineRecord; storageFailed = false; current(); publish();
  }
  async function load() {
    return serial(async () => {
      if (unsaved.size) return view();
      current(); const raw = await input.storage.getItem(key); current();
      if (raw === null) return null;
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { throw Error("Offline scoring storage is damaged. Its contents were preserved; do not clear app storage."); }
      record = verifyOfflineRecord(parsed, input.owner, input.roundId); storageFailed = false;
      status = record.queue.length ? "device" : "synced";
      return view();
    });
  }
  async function prepare(loaded: CachedRound, ends: Map<number, string>, progress?: (count: number, total: number) => void, verify?: () => Promise<void>) {
    current(); if (record?.queue.length) return view();
    if (!validInt(loaded.round.ends, 120) || !validInt(loaded.round.arrowsPerEnd, 60)) throw Error("Invalid offline Round configuration.");
    const baselines: Record<string, ArrowSnapshot> = {}, total = loaded.round.ends * loaded.round.arrowsPerEnd;
    const reusable = record && offlineRoundConfiguration(record.loaded.round) === offlineRoundConfiguration(loaded.round)
      && record.ends.every(([n, id]) => ends.get(n) === id) ? clone(record.baselines) : null;
    const incoming = new Map(loaded.round.arrows.map(a => [arrowKey(a.end, a.arrow), a]));
    let cursor = 0, completed = 0, failure: unknown;
    // Four outstanding requests maximum; never create an unbounded Promise.all.
    await Promise.all(Array.from({ length: Math.min(4, total) }, async () => {
      while (cursor < total && !failure) {
        try {
        const index = cursor++, slot = { end: Math.floor(index / loaded.round.arrowsPerEnd) + 1, arrow: index % loaded.round.arrowsPerEnd + 1 };
        current(); const endId = ends.get(slot.end); if (!endId) throw Error("Planned End unavailable.");
        const key = arrowKey(slot.end, slot.arrow), previous = reusable?.[key], observed = incoming.get(key) ?? null;
        baselines[key] = previous && same(previous.arrow, observed) && previous.arrow?.id === observed?.id
          ? previous : await input.read(slot, endId);
        current(); progress?.(++completed, total);
        } catch (issue) { failure = issue; }
      }
    }));
    if (failure) throw failure;
    await verify?.();
    return serial(async () => {
      if (record?.queue.length) return view();
      const session: SessionDraft = { id: loaded.session.id, title: loaded.session.title, date: loaded.session.date,
        sessionType: loaded.session.sessionType, arrowCount: loaded.session.arrowCount, rounds: [loaded.round] };
      const candidate: OfflineRecord = { version: 1, owner: input.owner, roundId: input.roundId,
        loaded: { session, round: loaded.round }, ends: [...ends], baselines, queue: [], review: record?.review ?? [] };
      verifyOfflineRecord(candidate, input.owner, input.roundId, true);
      await commit(candidate); return view();
    });
  }
  async function enqueue(slot: Slot, desired: ArrowEntry | null) {
    return serial(async () => {
      current();
      if (storageFailed) {
        const raw = await input.storage.getItem(key);
        if (raw === null) throw Error("Device storage needs verification. Existing changes remain in memory; do not close the app.");
        record = verifyOfflineRecord(JSON.parse(raw), input.owner, input.roundId); storageFailed = false;
      }
      if (!record) throw Error("Device storage needs verification before more scoring. Retry loading this Round.");
      if (!record.baselines[arrowKey(slot.end, slot.arrow)] || !validArrow(desired, slot)) throw Error("This Arrow slot has not been prepared for offline use.");
      const id = input.requestId(); if (!UUID.test(id)) throw Error("Secure scoring identity unavailable.");
      const next = clone(record);
      const mutation = clone({ ...slot, id, desired: desired && { id: desired.id, end: desired.end, arrow: desired.arrow, score: desired.score, plot: desired.plot } });
      next.queue.push(mutation);
      status = "device";
      try { await commit(next); unsaved.delete(arrowKey(slot.end, slot.arrow)); publish(); }
      catch (issue) { unsaved.set(arrowKey(slot.end, slot.arrow), mutation); publish(); throw issue; }
      return view();
    });
  }
  function sync() {
    if (syncing || stopped || !input.current() || !record || storageFailed) return syncing ?? Promise.resolve();
    const epoch = generation;
    const active = () => !stopped && epoch === generation && input.current();
    syncing = (async () => {
      // Bounded foreground pass. A timer/resume/manual retry starts the next batch.
      for (let count = 0; count < 32 && active(); count++) {
        let task: Mutation | undefined, endId = "";
        await serial(async () => {
          if (!active() || !record || storageFailed) return;
          const blocked = new Set(record.queue.filter(m => m.conflict).map(m => arrowKey(m.end, m.arrow)));
          const m = record.queue.find(m => !blocked.has(arrowKey(m.end, m.arrow)));
          if (!m) return;
          const next = clone(record), n = next.queue.find(n => n.id === m.id)!;
          const needsExpected = n.expected === undefined;
          n.expected ??= next.baselines[arrowKey(n.end, n.arrow)].revision;
          status = "syncing"; failureMessage = undefined;
          if (needsExpected) await commit(next); else publish();
          task = clone(n); endId = new Map(next.ends).get(n.end)!;
        });
        if (!task || !active()) break;
        const m = task;
        try {
          let actual = await input.read(m, endId);
          if (!active()) break;
          if (!UUID.test(actual.revision) || !validArrow(actual.arrow, m)) throw Error("Invalid server confirmation.");
          if (actual.revision !== m.id && actual.revision === m.expected) {
            actual = await input.write(m, endId, m.desired, m.expected!, m.id);
          }
          if (!active()) break;
          if (!UUID.test(actual.revision) || !validArrow(actual.arrow, m)) throw Error("Invalid server confirmation.");
          await serial(async () => {
            if (!active() || !record || storageFailed) return;
            const next = clone(record), pending = next.queue.find(n => n.id === m.id);
            if (!pending) return;
            if (actual.revision === m.id && same(actual.arrow, m.desired)) {
              next.baselines[arrowKey(m.end, m.arrow)] = actual;
              next.queue = next.queue.filter(n => n.id !== m.id);
            } else { pending.conflict = actual; }
            status = next.queue.length ? "device" : "synced"; await commit(next);
          });
        } catch (issue) {
          const code = issue instanceof Error && "code" in issue ? String(issue.code) : "";
          const denied = ["42501", "22023", "PGRST202", "PGRST301"].includes(code);
          status = storageFailed || denied ? "failed" : "waiting";
          failureMessage = denied ? "The server did not authorize this change or its scoring contract is unavailable. Device scores are preserved. Verify sign-in and retry." : undefined;
          publish(); break;
        }
      }
      if (status === "syncing") { status = record?.queue.length ? "device" : "synced"; publish(); }
    })().catch(() => { status = "failed"; publish(); }).finally(() => { syncing = null; });
    return syncing;
  }
  async function resolveConflict(slot: Slot, choice: "device" | "server") {
    return serial(async () => {
      current(); if (!record) throw Error("Round unavailable.");
      const next = clone(record), k = arrowKey(slot.end, slot.arrow);
      const changes = next.queue.filter(m => arrowKey(m.end, m.arrow) === k), conflict = changes.find(m => m.conflict)?.conflict;
      if (!conflict) throw Error("No conflict is available for review.");
      const fresh = await input.read(slot, new Map(next.ends).get(slot.end)!);
      current();
      if (!UUID.test(fresh.revision) || !validArrow(fresh.arrow, slot)) throw Error("Server conflict state could not be verified.");
      if (fresh.revision !== conflict.revision || !same(fresh.arrow, conflict.arrow)) {
        changes.find(m => m.conflict)!.conflict = fresh;
        await commit(next);
        throw Error("The server Arrow changed again. Review the latest version before choosing.");
      }
      next.review.push({ mutations: changes, remote: conflict, choice });
      next.queue = next.queue.filter(m => arrowKey(m.end, m.arrow) !== k);
      next.baselines[k] = conflict;
      if (choice === "device") {
        const id = input.requestId(); if (!UUID.test(id)) throw Error("Secure scoring identity unavailable.");
        next.queue.push({ ...slot, desired: changes.at(-1)!.desired, id, expected: conflict.revision });
      }
      status = next.queue.length ? "device" : "synced"; await commit(next); return view();
    });
  }
  async function retryDevice() {
    return serial(async () => {
      current(); if (!record) return;
      const raw = await input.storage.getItem(key);
      if (raw === null) throw Error("Device storage is unavailable. Keep the app open; pending data was not discarded.");
      const next = clone(verifyOfflineRecord(JSON.parse(raw), input.owner, input.roundId));
      for (const m of unsaved.values()) if (!next.queue.some(n => n.id === m.id)) next.queue.push(clone(m));
      await commit(next); unsaved.clear(); status = next.queue.length ? "device" : "synced"; publish();
    });
  }
  return { load, prepare, enqueue, resolveConflict, view, sync, retryDevice, hasUnstored: () => unsaved.size > 0,
    start() { stopped = false; generation++; },
    stop() { stopped = true; generation++; },
    subscribe(listener: (value: OfflineView) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

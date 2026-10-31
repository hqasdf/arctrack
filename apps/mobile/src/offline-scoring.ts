import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { sessionAuthority } from "./supabase";
import { readOwnRound } from "./sessions";
import { readRoundEndIds, readMobileArrowSnapshot, writeMobileArrowSnapshot } from "./arrow-writes";
import { createOfflineRound, offlineRoundConfiguration, verifyOfflineRecord, type OfflineView, type Slot } from "./offline-scoring-store";
import type { ArrowEntry } from "@arc-track/core/scoring";

// Share one journal per accepted authentication epoch and Round, including when
// an Expo screen is reopened. Failed native writes stay resident until recovered.
const journals = new Map<string, { engine: ReturnType<typeof createOfflineRound>; readers: number; running: boolean }>();
const disk = new Map<string, Promise<unknown>>();
const projectScope = () => `arctrack-project:${process.env.EXPO_PUBLIC_SUPABASE_URL}:`;
function storageOperation<T>(key: string, operation: () => Promise<T>) {
  const task = (disk.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  disk.set(key, task);
  void task.finally(() => { if (disk.get(key) === task) disk.delete(key); }).catch(() => {});
  return task;
}
export async function openOfflineScoring(owner: string, roundId: string,
  progress?: (done: number, total: number) => void, localOnly = false) {
  const accepted = sessionAuthority?.snapshot().accepted;
  if (!accepted || accepted.accountId !== owner || accepted.mode !== "normal") throw Error("Sign in to score this Round.");
  const current = () => {
    const actual = sessionAuthority?.snapshot().accepted;
    return actual?.accountId === owner && actual.epoch === accepted.epoch && actual.mode === "normal";
  };
  const identity = `${owner}:${accepted.epoch}:${roundId}`;
  let entry = journals.get(identity);
  if (!entry) {
    const scope = projectScope();
    const engine = createOfflineRound({ owner, roundId, current,
      storage: {
        getItem: key => storageOperation(scope + key, () => AsyncStorage.getItem(scope + key)),
        setItem: (key, value) => storageOperation(scope + key, () => AsyncStorage.setItem(scope + key, value)),
      },
      requestId: () => { const id = globalThis.expo?.uuidv4?.(); if (!id) throw Error("Secure scoring identity unavailable."); return id; },
      read: (slot, end) => readMobileArrowSnapshot(slot, end, owner),
      write: (slot, end, desired, expected, request) => writeMobileArrowSnapshot(slot, end, desired, expected, request, owner),
    });
    entry = { engine, readers: 0, running: false }; journals.set(identity, entry);
  }
  const shared = entry, engine = shared.engine;
  shared.readers++;
  let released = false;
  function release() {
    if (released) return; released = true; shared.readers--;
    if (!shared.readers) { engine.stop(); shared.running = false;
      if (!engine.hasUnstored() && journals.get(identity) === shared) journals.delete(identity); }
  }
  async function prepare(loaded: NonNullable<Awaited<ReturnType<typeof readOwnRound>>>, ends: Map<number, string>) {
    return engine.prepare(loaded, ends, progress, async () => {
      const latest = await readOwnRound(owner, roundId), latestEnds = await readRoundEndIds(roundId);
      if (!current() || !latest || offlineRoundConfiguration(latest.round) !== offlineRoundConfiguration(loaded.round) ||
        ends.size !== latestEnds.size || [...ends].some(([n, id]) => latestEnds.get(n) !== id)) {
        throw Error("Round configuration changed during offline preparation. Reload while online before scoring.");
      }
    });
  }
  let cached: OfflineView | null;
  try {
  cached = await engine.load();
  if (!current()) throw Error("The scoring account changed.");
  if (!cached) {
    if (localOnly) throw Error("This Round was not prepared on this device. Reconnect and verify sign-in first.");
    const loaded = await readOwnRound(owner, roundId);
    if (!loaded) throw Error("Round not found or access is no longer available.");
    const ends = await readRoundEndIds(roundId);
    await prepare(loaded, ends);
  }
  } catch (issue) { release(); throw issue; }
  let detach: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  async function refresh() {
    if (engine.view().pending) return;
    const loaded = await readOwnRound(owner, roundId);
    if (!loaded || !active || !current()) return;
    const ends = await readRoundEndIds(roundId);
    if (active && current()) await prepare(loaded, ends);
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    if (!active || AppState.currentState !== "active" || !current()) return;
    timer = setTimeout(() => { void engine.sync().finally(schedule); }, 15_000);
  }
  return {
    view: engine.view,
    hasUnstored: engine.hasUnstored,
    start(listener: (view: OfflineView) => void) {
      active = true; detach?.(); detach = engine.subscribe(listener);
      if (!localOnly && !shared.running) { engine.start(); shared.running = true; } listener(engine.view());
      if (!localOnly) void engine.sync().finally(schedule);
      // Refresh authoritative idle snapshots once on screen entry, not on every timer.
      if (!localOnly && cached && !cached.pending) void refresh().catch(() => {});
    },
    stop() {
      active = false; detach?.(); detach = undefined;
      if (timer) clearTimeout(timer);
      release();
    },
    async save(entry: ArrowEntry) { await engine.enqueue(entry, entry); if (!localOnly) void engine.sync().finally(schedule); },
    async remove(slot: Slot) { await engine.enqueue(slot, null); if (!localOnly) void engine.sync().finally(schedule); },
    async resolve(slot: Slot, choice: "device" | "server") {
      if (localOnly) throw Error("Reconnect and verify sign-in before resolving a server conflict.");
      const latest = await readOwnRound(owner, roundId);
      if (!current() || !latest || offlineRoundConfiguration(latest.round) !== offlineRoundConfiguration(engine.view().loaded.round)) {
        throw Error("Round configuration changed. Device scores were preserved; do not apply them to a different target configuration. Recover the original Round settings before resolving.");
      }
      await engine.resolveConflict(slot, choice); void engine.sync().finally(schedule);
    },
    async retry() { await engine.retryDevice(); if (!localOnly) void engine.sync().finally(schedule); },
    synchronize: () => localOnly ? Promise.resolve() : engine.sync(),
  };
}
export type OfflineScoring = Awaited<ReturnType<typeof openOfflineScoring>>;

/** One foreground scheduler for durable journals, even outside the scoring route.
 * Five disk entries per pass; one Round / 32 mutations at a time. Round-robin
 * selection prevents a conflicting or revoked Round blocking all other Rounds.
 */
export function startOfflineScoringSync(owner: string) {
  let active = true, cursor = 0, running = false;
  let timer: ReturnType<typeof setTimeout> | undefined, writer: OfflineScoring | undefined;
  const actor = sessionAuthority?.snapshot().accepted;
  const allowed = () => { const a = sessionAuthority?.snapshot().accepted;
    return active && a?.accountId === owner && a.epoch === actor?.epoch && a.mode === "normal" && AppState.currentState === "active"; };
  const schedule = () => { if (timer) clearTimeout(timer); if (allowed()) timer = setTimeout(() => { void run(); }, 15_000); };
  async function run() {
    if (running || !allowed()) return;
    running = true;
    try {
      const prefix = `${projectScope()}arctrack:offline-scoring:v1:${owner}:`;
      const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix)).sort();
      for (let i = 0; i < Math.min(5, keys.length) && allowed(); i++) {
        const key = keys[cursor++ % keys.length], raw = await storageOperation(key, () => AsyncStorage.getItem(key));
        if (!allowed() || !raw) continue;
        try {
          const id = key.slice(prefix.length), record = verifyOfflineRecord(JSON.parse(raw), owner, id);
          if (journals.get(`${owner}:${actor?.epoch}:${id}`)?.readers) continue;
          if (!record.queue.length) continue;
          writer = await openOfflineScoring(owner, id);
          if (!allowed()) { writer.stop(); break; }
          writer.start(() => {}); await writer.synchronize(); writer.stop(); writer = undefined;
        } catch { writer?.stop(); writer = undefined; /* Preserve failed journals for explicit review. */ }
      }
    } catch { /* A later foreground pass retries storage/network availability. */ }
    finally { running = false; schedule(); }
  }
  const subscription = AppState.addEventListener("change", state => {
    if (state === "active") void run();
    else { if (timer) clearTimeout(timer); writer?.stop(); }
  });
  void run();
  return () => { active = false; if (timer) clearTimeout(timer); writer?.stop(); subscription.remove(); };
}

export async function listOfflineScoring(owner: string, limit = 50) {
  const actor = sessionAuthority?.snapshot().accepted;
  const current = () => { const a = sessionAuthority?.snapshot().accepted;
    return a?.accountId === owner && a.epoch === actor?.epoch && a.mode === "normal"; };
  if (!current()) throw Error("Sign in to view device scoring.");
  const prefix = `${projectScope()}arctrack:offline-scoring:v1:${owner}:`;
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix)).sort();
  const rounds: { id: string; title: string; session: string; pending: number }[] = [];
  let damaged = 0;
  // Read only this owner's namespaced scoring keys, never auth or another account.
  for (const key of keys.slice(0, Math.min(1000, Math.max(1, limit)))) {
    if (!current()) throw Error("The scoring account changed.");
    const raw = await storageOperation(key, () => AsyncStorage.getItem(key));
    if (!raw) continue;
    try {
      const record = verifyOfflineRecord(JSON.parse(raw), owner, key.slice(prefix.length));
      rounds.push({ id: record.roundId, title: record.loaded.round.name, session: record.loaded.session.title, pending: record.queue.length });
    } catch { damaged++; }
  }
  if (!current()) throw Error("The scoring account changed.");
  return { rounds, damaged, more: keys.length > Math.min(1000, Math.max(1, limit)) };
}

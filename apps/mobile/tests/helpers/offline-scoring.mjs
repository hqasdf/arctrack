import { randomUUID } from "node:crypto";
import { createOfflineRound } from "../../src/offline-scoring-store.ts";

// Actual journal/state machine; only native disk and RPC transport are synthetic.
export async function memoryScoring({ loaded, owner = "owner", read, write, current = () => true }) {
  const data = new Map();
  const round = loaded.round;
  const engine = createOfflineRound({ owner, roundId: round.id, current, requestId: randomUUID,
    storage: { getItem: async key => data.get(key) ?? null, setItem: async (key, value) => { data.set(key, value); } },
    read, write: (slot, _end, desired, expectedRevision, requestId) => write(slot, desired, { expectedRevision, requestId }) });
  await engine.prepare({ ...loaded, session: { title: "Training", sessionType: "training", arrowCount: 0, ...loaded.session, id: "00000000-0000-4000-8000-000000000001" } },
    new Map(Array.from({ length: round.ends }, (_, i) => [i + 1, `00000000-0000-4000-8000-${String(i + 2).padStart(12, "0")}`])));
  let detach;
  return { view: engine.view,
    start(listener) { detach = engine.subscribe(listener); engine.start(); listener(engine.view()); },
    stop() { detach?.(); engine.stop(); },
    async save(entry) { await engine.enqueue(entry, entry); void engine.sync(); },
    async remove(slot) { await engine.enqueue(slot, null); void engine.sync(); },
    async resolve(slot, choice) { await engine.resolveConflict(slot, choice); void engine.sync(); },
    async retry() { await engine.retryDevice(); void engine.sync(); },
  };
}

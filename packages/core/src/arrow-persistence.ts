import { arrowKey, type ArrowEntry } from "./scoring-model.ts";

export type ArrowSnapshot = { revision: string; arrow: ArrowEntry | null };
export type ArrowIntent = { expectedRevision: string; requestId: string };
export type ArrowRecovery = Array<[string, { snapshot?: ArrowSnapshot; ownRequests: string[] }]>;
type Slot = { end: number; arrow: number };
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

function same(a: ArrowEntry | null, b: ArrowEntry | null): boolean {
  if (!a || !b) return a === b;
  const coordinate = (x: number | undefined, y: number | undefined) =>
    x === y || x !== undefined && y !== undefined && Math.abs(x - y) <= 1e-12;
  return a.id === b.id && a.end === b.end && a.arrow === b.arrow && a.score === b.score
    && coordinate(a.plot?.x, b.plot?.x) && coordinate(a.plot?.y, b.plot?.y)
    && a.plot?.faceIndex === b.plot?.faceIndex;
}

/** One instance per loaded Round. Callers serialize each slot, not the whole Round.
 * A durable revision also fences an older HTTP request that outlives a lost response.
 * Other-device changes are conflicts, never silently adopted as this writer's intent.
 */
export function createArrowPersistence(options: {
  initial: ArrowEntry[];
  read: (slot: Slot) => Promise<ArrowSnapshot>;
  write: (slot: Slot, desired: ArrowEntry | null, intent: ArrowIntent) => Promise<ArrowSnapshot>;
  requestId: () => string;
  recovery?: ArrowRecovery;
  beforeWrite?: () => void;
}) {
  type State = { snapshot?: ArrowSnapshot; unknown: boolean; ownRequests: Set<string> };
  const states = new Map<string, State>();
  function restore(recovery: ArrowRecovery) { for (const [key, state] of recovery) {
    if (!/^\d+-\d+$/.test(key) || !Array.isArray(state.ownRequests) || state.ownRequests.length > 64
      || state.ownRequests.some(id => !UUID.test(id)) || state.snapshot && !UUID.test(state.snapshot.revision)) {
      throw Error("Saved Arrow recovery state is invalid. Keep the device data for recovery.");
    }
    states.set(key, { snapshot: state.snapshot, unknown: true, ownRequests: new Set(state.ownRequests) });
  } }
  restore(options.recovery ?? []);
  const initial = new Map(options.initial.map(a => [arrowKey(a.end, a.arrow), a]));
  function checked(snapshot: ArrowSnapshot, slot: Slot) {
    if (!snapshot || !UUID.test(snapshot.revision) || snapshot.arrow
      && (snapshot.arrow.end !== slot.end || snapshot.arrow.arrow !== slot.arrow)) {
      throw Error("The saved Arrow could not be verified. Reload this Round.");
    }
    return { ...snapshot, revision: snapshot.revision.toLowerCase() };
  }
  async function mutate(slot: Slot, desired: ArrowEntry | null) {
    const key = arrowKey(slot.end, slot.arrow);
    const state = states.get(key) ?? { unknown: false, ownRequests: new Set<string>() };
    states.set(key, state);
    if (!state.snapshot || state.unknown) {
      const actual = checked(await options.read(slot), slot);
      if (state.snapshot ? actual.revision !== state.snapshot.revision && !state.ownRequests.has(actual.revision)
        : !same(initial.get(key) ?? null, actual.arrow)) {
        throw Error("This Arrow changed on another device. Reload this Round before editing it.");
      }
      state.snapshot = actual;
      state.unknown = false;
    }
    const requestId = options.requestId().toLowerCase();
    if (!UUID.test(requestId)) throw Error("Secure Arrow request generation is unavailable.");
    state.ownRequests.add(requestId);
    // Bounded local recovery identities. An exceptionally old response fails closed.
    if (state.ownRequests.size > 64) state.ownRequests.delete(state.ownRequests.values().next().value!);
    state.unknown = true;
    // Optional device journal must record the request identity before network I/O.
    options.beforeWrite?.();
    const actual = checked(await options.write(slot, desired, { expectedRevision: state.snapshot.revision, requestId }), slot);
    const expected = desired && { ...desired, id: actual.arrow?.id ?? desired.id };
    if (actual.revision !== requestId || !same(expected, actual.arrow)) {
      throw Error("The latest Arrow change could not be confirmed. Retry or reload this Round.");
    }
    state.snapshot = actual;
    state.unknown = false;
    return actual.arrow;
  }
  return {
    restore,
    inspect: async (slot: Slot) => checked(await options.read(slot), slot),
    chooseSnapshot(slot: Slot, snapshot: ArrowSnapshot) {
      const actual=checked(snapshot,slot),key=arrowKey(slot.end,slot.arrow);
      states.set(key,{snapshot:actual,unknown:true,ownRequests:new Set()});
      if(actual.arrow)initial.set(key,actual.arrow);else initial.delete(key);
    },
    restoreBaseline(slot: Slot, expected: ArrowEntry | null) {
      const key=arrowKey(slot.end,slot.arrow);
      if(expected)initial.set(key,expected);else initial.delete(key);
    },
    recovery: (): ArrowRecovery => [...states].map(([key, state]) => [key, { snapshot: state.snapshot, ownRequests: [...state.ownRequests] }]),
    save: async (entry: ArrowEntry) => {
      const saved = await mutate(entry, entry);
      if (!saved) throw Error("The Arrow save could not be confirmed.");
      return saved;
    },
    remove: async (slot: Slot) => { await mutate(slot, null); },
  };
}

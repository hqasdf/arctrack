export type CounterAddition = { amount: number; addedAt: string | null };
export type CounterState = { version: 3; totalArrows: number; increment: number; history: CounterAddition[] };
export const COUNTER_STORAGE_KEY = "arc-track-arrow-counter";
export const DEFAULT_COUNTER: CounterState = { version: 3, totalArrows: 0, increment: 6, history: [] };
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null;
}
// A failed read must never authorize overwriting saved history with defaults.
export function readCounter(value: unknown): CounterState {
  if (!value || typeof value !== "object") throw new Error("Invalid saved counter");
  const item = value as Record<string, unknown>;
  if (!Number.isSafeInteger(item.totalArrows) || Number(item.totalArrows) < 0) throw new Error("Invalid saved total");
  if (item.version === 1) return { ...DEFAULT_COUNTER, totalArrows: Number(item.totalArrows) };
  if ((item.version !== 2 && item.version !== 3) || !positive(item.increment) || !Array.isArray(item.history)) throw new Error("Invalid saved counter");
  const history = item.history.map((entry: unknown): CounterAddition => {
    if (item.version === 2 && positive(entry)) return { amount: entry, addedAt: null };
    if (item.version === 3 && entry && typeof entry === "object" && "amount" in entry && positive(entry.amount))
      return { amount: entry.amount, addedAt: timestamp("addedAt" in entry ? entry.addedAt : null) };
    throw new Error("Invalid saved history");
  });
  const sum = history.reduce((total, entry) => total + entry.amount, 0);
  if (!Number.isSafeInteger(sum) || sum > Number(item.totalArrows)) throw new Error("Invalid saved history total");
  return { version: 3, totalArrows: Number(item.totalArrows), increment: item.increment, history };
}
export function addArrows(state: CounterState, addedAt = new Date().toISOString()): CounterState {
  if (state.totalArrows > Number.MAX_SAFE_INTEGER - state.increment) return state;
  return { ...state, totalArrows: state.totalArrows + state.increment, history: [...state.history, { amount: state.increment, addedAt: timestamp(addedAt) }] };
}
export function undoLastAddition(state: CounterState): CounterState {
  const last = state.history.at(-1);
  return last ? { ...state, totalArrows: state.totalArrows - last.amount, history: state.history.slice(0, -1) } : state;
}
export function setIncrement(state: CounterState, increment: number): CounterState { return positive(increment) ? { ...state, increment } : state; }
export function resetCounter(state: CounterState): CounterState { return { ...state, totalArrows: 0, history: [] }; }
export function lastAdditionDisplay(state: CounterState, locale?: string) {
  const last = state.history.at(-1);
  if (!last) return { time: "No additions yet", detail: "" };
  if (!last.addedAt) return { time: "Time not recorded", detail: `+${last.amount} arrows` };
  const date = new Date(last.addedAt);
  return { time: date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
    detail: `${date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })} · +${last.amount} arrows` };
}

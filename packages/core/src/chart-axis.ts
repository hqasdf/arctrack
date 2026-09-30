export type ChartAxisKind = "count" | "score" | "percentage" | "measurement";

// Bars always start at zero; trends may use a labelled, padded range.
export function chartAxis(values: number[], kind: ChartAxisKind, bar = false) {
  const finite = values.filter(Number.isFinite);
  const low = finite.length ? Math.min(...finite) : 0;
  const high = finite.length ? Math.max(...finite) : 0;
  const limit = kind === "score" ? 10 : kind === "percentage" ? 100 : Infinity;
  const span = Math.max(high - low, kind === "score" ? 0.2 : kind === "percentage" ? 2 : Math.max(1, Math.abs(high) * 0.1));
  const desiredMin = bar ? 0 : Math.max(0, low - span * 0.35);
  const desiredMax = Math.min(limit, high + span * 0.35);
  const range = Math.max(desiredMax - desiredMin, kind === "score" ? 0.2 : 1);
  const roughStep = range / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const candidateStep = [1, 2, 2.5, 5, 10].map((unit) => unit * magnitude).find((candidate) => candidate >= roughStep) ?? 10 * magnitude;
  const step = kind === "count" ? Math.max(1, candidateStep) : candidateStep;
  const min = bar ? 0 : Math.max(0, Math.floor(desiredMin / step) * step);
  const max = Math.max(step, Math.min(limit, Math.ceil(desiredMax / step) * step));
  const ticks = Array.from({ length: Math.floor((max - min) / step + 1e-8) + 1 }, (_, index) => Number((min + index * step).toFixed(6)));
  return { min, max, ticks };
}

export function chartTick(value: number, kind: ChartAxisKind) {
  if (kind === "count") return String(Math.round(value));
  const digits = Math.abs(value) < 10 && value % 1 !== 0 ? 2 : value % 1 !== 0 ? 1 : 0;
  return `${Number(value.toFixed(digits))}${kind === "percentage" ? "%" : ""}`;
}

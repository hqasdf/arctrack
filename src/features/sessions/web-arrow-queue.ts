import { arrowKey, type ArrowEntry } from "@arc-track/core/scoring";

export type ArrowSaveResult = { ok: true; data: ArrowEntry } | { ok: false; message: string };
type Save = (arrow: ArrowEntry) => Promise<ArrowSaveResult>;
type Remove = (arrow: ArrowEntry) => Promise<{ ok: true } | { ok: false; message: string }>;
type Cell = {
  confirmed: ArrowEntry | null;
  desired: ArrowEntry | null;
  version: number;
  status: "saved" | "saving" | "failed";
  error: string | null;
  job: Promise<void> | null;
};

// Postgres double precision may serialize through JSON with a few last-bit changes.
const PLOT_COORDINATE_EPSILON = 1e-12;

function sameCoordinate(first: number | undefined, second: number | undefined) {
  return first === second || (first !== undefined && second !== undefined
    && Math.abs(first - second) <= PLOT_COORDINATE_EPSILON);
}

function sameContent(first: ArrowEntry | null, second: ArrowEntry | null) {
  if (!first || !second) return first === second;
  return first.end === second.end && first.arrow === second.arrow && first.score === second.score
    && sameCoordinate(first.plot?.x, second.plot?.x) && sameCoordinate(first.plot?.y, second.plot?.y)
    && first.plot?.faceIndex === second.plot?.faceIndex;
}

/** Each slot has one in-flight write. A newer complete desired Arrow replaces unsent edits. */
export class WebArrowQueue {
  private readonly cells = new Map<string, Cell>();
  private readonly save: Save;
  private readonly remove: Remove;
  private readonly changed: () => void;

  constructor(
    initial: ArrowEntry[],
    save: Save,
    remove: Remove,
    changed: () => void,
  ) {
    this.save = save;
    this.remove = remove;
    this.changed = changed;
    for (const arrow of initial) this.cells.set(arrowKey(arrow.end, arrow.arrow), {
      confirmed: { ...arrow, syncState: "saved" }, desired: { ...arrow, syncState: "saved" },
      version: 0, status: "saved", error: null, job: null,
    });
  }

  desiredAt(key: string) { return this.cells.get(key)?.desired ?? null; }
  desiredArrows() {
    return [...this.cells.values()].flatMap((cell) => cell.desired
      ? [{ ...cell.desired, syncState: cell.status }] : []);
  }
  confirmedArrows() {
    return [...this.cells.values()].flatMap((cell) => cell.confirmed ? [cell.confirmed] : []);
  }
  hasUnconfirmed() { return [...this.cells.values()].some((cell) => cell.status !== "saved"); }
  firstError() { return [...this.cells.values()].find((cell) => cell.error)?.error ?? null; }

  edit(arrow: ArrowEntry) {
    const key = arrowKey(arrow.end, arrow.arrow);
    const cell = this.cells.get(key) ?? {
      confirmed: null, desired: null, version: 0, status: "saved" as const,
      error: null, job: null,
    };
    if (cell.status === "saved" && sameContent(cell.confirmed, arrow)) return;
    cell.desired = { ...arrow, id: cell.confirmed?.id ?? arrow.id };
    cell.version += 1;
    cell.status = "saving";
    cell.error = null;
    this.cells.set(key, cell);
    this.changed();
    this.start(key, cell);
  }

  delete(key: string) {
    const cell = this.cells.get(key);
    if (!cell || cell.desired === null) return;
    cell.desired = null;
    cell.version += 1;
    cell.status = "saving";
    cell.error = null;
    this.changed();
    this.start(key, cell);
  }

  retry(key: string) {
    const cell = this.cells.get(key);
    if (!cell || cell.status !== "failed") return;
    cell.status = "saving";
    cell.error = null;
    this.changed();
    this.start(key, cell);
  }

  async flush() {
    for (;;) {
      const jobs = [...this.cells.values()].flatMap((cell) => cell.job ? [cell.job] : []);
      if (!jobs.length) return ![...this.cells.values()].some((cell) => cell.status === "failed" || cell.error);
      await Promise.all(jobs);
    }
  }

  private start(key: string, cell: Cell) {
    if (cell.job) return;
    cell.job = this.drain(key, cell).finally(() => {
      cell.job = null;
      if (cell.status === "saving" && !sameContent(cell.confirmed, cell.desired)) this.start(key, cell);
    });
  }

  private async drain(key: string, cell: Cell) {
    for (;;) {
      if (sameContent(cell.confirmed, cell.desired)) {
        if (cell.desired === null) this.cells.delete(key);
        else {
          cell.desired = { ...cell.confirmed!, syncState: "saved" };
          cell.status = "saved";
        }
        this.changed();
        return;
      }
      const version = cell.version;
      const intended = cell.desired;
      let result: ArrowSaveResult | { ok: true } | { ok: false; message: string };
      try {
        result = intended ? await this.save({ ...intended }) : await this.remove(cell.confirmed!);
      } catch {
        result = { ok: false, message: "The Arrow could not be saved. Check your connection and retry." };
      }
      if (result.ok) {
        cell.confirmed = intended ? { ...(result as { ok: true; data: ArrowEntry }).data, syncState: "saved" } : null;
        if (cell.desired && cell.confirmed) cell.desired = { ...cell.desired, id: cell.confirmed.id };
        cell.error = null;
        if (cell.version !== version) {
          this.changed();
          continue;
        }
        if (sameContent(cell.confirmed, cell.desired)) {
          if (cell.desired === null) this.cells.delete(key);
          else {
            cell.desired = { ...cell.confirmed!, syncState: "saved" };
            cell.status = "saved";
          }
          this.changed();
          return;
        }
        this.changed();
        continue;
      }
      if (cell.version !== version) continue;
      if (intended === null) {
        cell.desired = cell.confirmed;
        cell.status = "saved";
      } else cell.status = "failed";
      cell.error = result.message;
      this.changed();
      return;
    }
  }
}

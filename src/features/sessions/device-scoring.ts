import { SCORE_LABELS, type ArrowEntry } from "@arc-track/core/scoring";
import type { ArrowRecovery } from "@arc-track/core/arrow-persistence";
import type { QueueRecovery } from "./web-arrow-queue";

type Journal = { version: 1; owner: string; roundId: string; configuration: string; queue: QueueRecovery; persistence: ArrowRecovery };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export class DeviceScoringRecovery {
  private journal: ReturnType<typeof scoringJournal> | null = null;
  private online = false;
  private attached = true;
  attach(){this.attached=true;}
  detach(){this.attached=false;}
  canNavigate(){return this.attached;}
  open(storage:Storage,project:string,owner:string,round:string,configuration:string) {
    const journal=scoringJournal(storage,project,owner,round,configuration);
    const saved=journal.load();this.journal=journal;return saved;
  }
  persist(queue:QueueRecovery,persistence:ArrowRecovery) {
    if(this.online)return false;
    if(!this.journal)throw Error("Device recovery is not ready.");
    this.journal.save(queue,persistence);
    return true;
  }
  onlineOnly(storage:Storage,project:string,owner:string,round:string,configuration:string) {
    if(scoringJournal(storage,project,owner,round,configuration).load())throw Error("Pending device recovery requires an exclusive editor.");
    this.online=true;
  }
}
export function scoringJournal(storage: Storage, project: string, owner: string, roundId: string, configuration: string) {
  const key = `arctrack:scoring-recovery:1:${project}:${owner}:${roundId}`;
  function validArrow(arrow: ArrowEntry | null, end: number, slot: number) {
    return arrow === null || arrow && typeof arrow.id === "string" && arrow.end === end && arrow.arrow === slot
      && SCORE_LABELS.includes(arrow.score) && (arrow.plot === null || arrow.plot && Number.isFinite(arrow.plot.x)
        && Number.isFinite(arrow.plot.y) && Math.abs(arrow.plot.x) <= 2 && Math.abs(arrow.plot.y) <= 2
        && (arrow.plot.faceIndex === undefined || [0,1,2].includes(arrow.plot.faceIndex)));
  }
  return {
    load(): Journal | null {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      if (raw.length > 2_000_000) throw Error("Device scoring recovery is too large. Its contents were preserved.");
      const value = JSON.parse(raw) as Journal;
      if (value.version !== 1 || value.owner !== owner || value.roundId !== roundId || value.configuration !== configuration
        || !Array.isArray(value.queue) || value.queue.length > 7200 || !Array.isArray(value.persistence)
        || value.persistence.length > 7200) throw Error("Device scoring recovery does not match this Round. Its contents were preserved.");
      const slots = new Set<string>();
      const [ends,arrowsPerEnd]=JSON.parse(configuration) as number[];
      for (const cell of value.queue) {
        const { end, arrow } = cell.identity ?? {};
        if (!Number.isInteger(end) || end < 1 || end > ends || !Number.isInteger(arrow) || arrow < 1 || arrow > arrowsPerEnd
          || slots.has(`${end}-${arrow}`) || !validArrow(cell.identity,end,arrow)
          || !validArrow(cell.confirmed,end,arrow) || !validArrow(cell.desired,end,arrow)) {
          throw Error("Device scoring recovery is invalid. Its contents were preserved.");
        }
        slots.add(`${end}-${arrow}`);
      }
      return value;
    },
    save(queue: QueueRecovery, persistence: ArrowRecovery) {
      if (!queue.length) { storage.removeItem(key); return; }
      const raw = JSON.stringify({ version: 1, owner, roundId, configuration, queue, persistence } satisfies Journal);
      if (raw.length > 2_000_000) throw Error("Device scoring recovery storage is full.");
      storage.setItem(key, raw);
    },
  };
}

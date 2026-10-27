/** Bluetooth SIG Heart Rate Measurement, UUID 0x2A37. No derived/interpolated BPM. */
export function parseHeartRate(value: DataView): { bpm: number; contact: boolean | null } | null {
  if (value.byteLength < 2) return null;
  const flags = value.getUint8(0), wide = (flags & 1) !== 0;
  let offset = wide ? 3 : 2;
  if (value.byteLength < offset) return null;
  const bpm = wide ? value.getUint16(1, true) : value.getUint8(1);
  // Reject unusable physiology; a supported contact sensor reporting no contact is unavailable.
  const contact = flags & 4 ? Boolean(flags & 2) : null;
  if (bpm < 1 || bpm > 300 || contact === false) return null;
  if (flags & 8) offset += 2; // Energy Expended is uint16, not another HR sample.
  if (value.byteLength < offset) return null;
  if (flags & 16) {
    const remaining = value.byteLength - offset;
    if (remaining < 2 || remaining % 2 !== 0) return null;
  } else if (value.byteLength !== offset) return null;
  return { bpm, contact };
}

export type HeartRateReading = {
  historyConsent?: boolean; historyVersion?: number; lastSeenAt?: string | null;
  athleteId: string; consent: boolean; generation: string | null; sourceId: string | null;
  bpm: number | null; receivedAt: string | null;
};

/** Per-athlete subscriptions keep 1 Hz updates out of the team component state. */
export function createReadingStore(){
 const rows=new Map<string,HeartRateReading>(),listeners=new Map<string,Set<()=>void>>();
 return {
  get:(id:string)=>rows.get(id),
  subscribe(id:string,listener:()=>void){const set=listeners.get(id)??new Set();set.add(listener);listeners.set(id,set);return()=>{set.delete(listener);if(!set.size)listeners.delete(id);};},
  publish(next:HeartRateReading[]){const incoming=new Map(next.map(r=>[r.athleteId,r]));for(const id of new Set([...rows.keys(),...incoming.keys()])){const a=rows.get(id),b=incoming.get(id);if(JSON.stringify(a)===JSON.stringify(b))continue;if(b)rows.set(id,b);else rows.delete(id);for(const listener of listeners.get(id)??[])listener();}}
 };
}
export type ReadingStore=ReturnType<typeof createReadingStore>;
export function historyAuthorityMatches(checked:HeartRateReading|undefined,current:HeartRateReading|undefined):boolean{
 return Boolean(current?.consent&&current.historyConsent&&checked?.athleteId===current.athleteId&&checked.generation===current.generation&&checked.historyVersion===current.historyVersion);
}
export function heartRateFresh(reading: HeartRateReading | undefined, now: number): boolean {
  if (!reading?.consent || reading.bpm === null || !reading.receivedAt || !reading.sourceId) return false;
  const age = now - Date.parse(reading.receivedAt);
  return age >= -5000 && age <= 10000;
}

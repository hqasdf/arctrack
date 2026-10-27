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
export function heartRateFresh(reading: HeartRateReading | undefined, now: number): boolean {
  if (!reading?.consent || reading.bpm === null || !reading.receivedAt || !reading.sourceId) return false;
  const age = now - Date.parse(reading.receivedAt);
  return age >= -5000 && age <= 10000;
}

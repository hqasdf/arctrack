export type HRSample = [number, number | null];
export type SessionActivityLink = { session_id: string; activity_id: string | null; updated_at: string };
export type HRCandidate = { source_id: string; start_seconds: number; duration_seconds: number; activity_type: string | null; state: string; sample_count: number; published: boolean };
export type HRDataset = { id: string; source: 'activity' | 'daily'; sourceId: string; start: number; duration: number; samples: HRSample[] };
export type SessionHealth = { link: SessionActivityLink | null; recording: HRCandidate | null; authorized: boolean; paused?: boolean; sync?: {state:string;error:string|null}|null; candidates: HRCandidate[]; datasets: HRDataset[] };
export const singaporeTime = (seconds: number) => new Intl.DateTimeFormat('en-SG', { timeZone:'Asia/Singapore', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(new Date(seconds*1000));
// Statistics use all original points, never graph downsampling. Activity values
// hold until the next sample; we cap uncertain gaps at 60s rather than imply
// uninterrupted recording. Daily samples describe only the PRECEDING 15 seconds.
export function hrAnalysis(datasets: HRDataset[], start: number, end: number) {
  const source = datasets.some(d=>d.source==='activity') ? 'activity' : 'daily';
  const rows = datasets.filter(d=>d.source===source).flatMap(d=>d.samples).sort((a,b)=>a[0]-b[0]);
  const unique = new Map<number, number | null>();
  for (const [time,bpm] of rows) {
    if (!Number.isSafeInteger(time) || bpm!==null && (!Number.isInteger(bpm)||bpm<1||bpm>300)) continue;
    // Conflicting overlapping daily summaries are unavailable, not arrival-order winners.
    unique.set(time, unique.has(time) && unique.get(time)!==bpm ? null : bpm);
  }
  const points = [...unique].sort((a,b)=>a[0]-b[0]);
  const valid = points.filter((p):p is [number,number]=>p[1]!==null && p[0]>=start && p[0]<=end);
  const segments: {start:number;end:number;bpm:number}[]=[];
  let weight=0,total=0, representedUntil=start;
  for(let i=0;i<points.length;i++) {
    const [time,bpm]=points[i]; if(bpm===null) continue;
    const left = Math.max(start,source==='daily'?Math.max(time-15,representedUntil):time);
    const right = Math.min(end,source==='daily'?time:Math.min(points[i+1]?.[0]??time,time+60));
    if(right>left) { representedUntil=right; segments.push({start:left,end:right,bpm}); total+=bpm*(right-left);weight+=right-left; }
  }
  // Union coverage (overlapping daily bins must not double count).
  let covered=0,until=start;
  for(const s of [...segments].sort((a,b)=>a.start-b.start)) { covered+=Math.max(0,s.end-Math.max(until,s.start)); until=Math.max(until,s.end); }
  return {source,points,valid,segments,average:weight?total/weight:null,minimum:valid.length?valid.reduce((v,p)=>Math.min(v,p[1]),Infinity):null,
    maximum:valid.length?valid.reduce((v,p)=>Math.max(v,p[1]),-Infinity):null,count:valid.length,first:valid[0]?.[0]??null,last:valid.at(-1)?.[0]??null,
    duration:end-start,covered,coverage:end>start?Math.min(1,covered/(end-start)):0};
}
// Min/max envelope keeps peaks, troughs and explicit gaps. Tooltips use originals.
export function chartPoints(points: HRSample[], max=600): HRSample[] {
  if(points.length<=max) return points;
  const size=Math.ceil(points.length/(max/4)); const out:HRSample[]=[];
  for(let i=0;i<points.length;i+=size) {
    const bucket=points.slice(i,i+size), valid=bucket.filter((p):p is [number,number]=>p[1]!==null);
    const selected=[bucket[0],bucket.at(-1)!,bucket.find(p=>p[1]===null),valid.reduce<[number,number]|undefined>((a,p)=>a===undefined||p[1]<a[1]?p:a,undefined),valid.reduce<[number,number]|undefined>((a,p)=>a===undefined||p[1]>a[1]?p:a,undefined)];
    out.push(...selected.filter((p):p is HRSample=>!!p).sort((a,b)=>a[0]-b[0]));
  }
  return out.filter((p,i)=>!i||p[0]!==out[i-1][0]);
}

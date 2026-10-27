export type HrUpload={athleteId:string;generation:string;sourceId:string;bpm:number;sequence:number;receivedAt:string};
/** One bounded pending frame per athlete, one request in flight, no retries. */
export class HeartRateBatcher {
 private pending=new Map<string,{sample:HrUpload;resolve:()=>void;reject:(error:Error)=>void}>();
 private sending=false;private stopped=false;
 constructor(private send:(samples:HrUpload[],signal:AbortSignal)=>Promise<{athleteId:string;status:string}[]>,private now=Date.now){}
 private abort:AbortController|null=null;
 enqueue(sample:HrUpload){
  if(this.stopped||this.pending.has(sample.athleteId)||this.pending.size>=12)return Promise.reject(Object.assign(Error('Frame dropped'),{status:429}));
  return new Promise<void>((resolve,reject)=>this.pending.set(sample.athleteId,{sample,resolve,reject}));
 }
 async flush(){
  if(this.stopped||this.sending||!this.pending.size)return;
  const frames=[...this.pending.values()];this.pending.clear();
  const fresh=frames.filter(f=>this.now()-Date.parse(f.sample.receivedAt)<=5000);
  for(const frame of frames)if(!fresh.includes(frame))frame.reject(Object.assign(Error('Expired frame dropped'),{status:429}));
  if(!fresh.length)return;
  this.sending=true;const abort=new AbortController();this.abort=abort;
  const timeout=setTimeout(()=>abort.abort(),5000);
  try{
   const results=await this.send(fresh.map(f=>f.sample),abort.signal);
   if(this.stopped||abort.signal.aborted)throw Error('Upload stopped');
   for(const frame of fresh){const status=results.find(r=>r.athleteId===frame.sample.athleteId)?.status;if(status==='accepted')frame.resolve();else frame.reject(Object.assign(Error('Measurement not accepted'),{status:status==='rate_limited'?429:403}));}
  }catch{for(const frame of fresh)frame.reject(Error('Upload could not be confirmed; reconnect to retry.'));}
  finally{clearTimeout(timeout);this.sending=false;this.abort=null;}
 }
 clear(){this.abort?.abort();for(const frame of this.pending.values())frame.reject(Error('Upload stopped'));this.pending.clear();}
 dispose(){this.stopped=true;this.clear();}
}

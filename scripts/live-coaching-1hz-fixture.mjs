import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
/** Synthetic workload ONLY in the existing owned disposable cluster. */
export async function testLiveHr1Hz(db){
 let assertions=0;const check=(v,label)=>{assert.ok(v,label);assertions++;};
 const id=n=>'c2000000-0000-4000-8000-'+String(n).padStart(12,'0'),coach='b1000000-0000-4000-8000-000000000001',org='b1000000-0000-4000-8000-000000000005';
 const roster=Array.from({length:12},(_,i)=>id(i+1)),leases=[],sequence=new Map();
 const admin=async(sql,args=[])=>{await db.query('reset role');return db.query(sql,args);};
 const user=async(actor,sql,args=[])=>{await db.query('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);return db.query(sql,args);};
 const command=async(actor,action,live=null,scoring=null)=>{const version=live?(await user(actor,'select public.read_live_coaching($1,null) v',[live])).rows[0].v.session.version:null;return (await user(actor,'select public.live_coaching_command($1,$2,$3,$4,$5,$6,$7,$8) v',[action,live,org,'1 Hz disposable load','2026-10-27',roster,scoring,version])).rows[0].v;};
 for(let i=0;i<12;i++){await admin('insert into auth.users(id,email) values($1,$2)',[roster[i],`hz-${i}@example.invalid`]);await admin("insert into public.organization_members(organization_id,user_id,role,status) values($1,$2,'archer','active')",[org,roster[i]]);await admin("insert into public.sessions(id,user_id,title,session_date,session_type) values($1,$2,'Synthetic Hz scoring','2026-10-27','training')",[id(100+i),roster[i]]);}
 const live=await command(coach,'create');await command(coach,'waiting',live);for(let i=0;i<12;i++)await command(roster[i],'join',live,id(100+i));await command(coach,'start',live);
 for(let i=0;i<12;i++){
  const consent=(await user(roster[i],"select public.live_hr_command('consent',$1,$2) v",[live,roster[i]])).rows[0].v;
  await user(roster[i],'select public.set_live_hr_history($1,true,$2,0)',[live,consent.generation]);
  leases.push((await user(coach,"select public.live_hr_command('assign',$1,$2,$3,$4) v",[live,roster[i],consent.generation,id(200+i)])).rows[0].v);
 }
 const batch=async(samples,actor=coach)=>(await user(actor,'select public.live_hr_batch($1,$2::jsonb) v',[live,JSON.stringify(samples)])).rows[0].v;
 const samples=n=>Array.from({length:n},(_,i)=>{const seq=(sequence.get(i)??0)+1;sequence.set(i,seq);return {athleteId:roster[i],...leases[i],bpm:70+i,sequence:seq,receivedAt:new Date().toISOString()};});
 const workloads=[];
 for(const n of [1,2,8,12]){
  const times=[];let accepted=0;
  for(let tick=0;tick<3;tick++){
   await new Promise(resolve=>setTimeout(resolve,1050-Date.now()%1000));const payload=samples(n),start=performance.now(),result=await batch(payload);times.push(performance.now()-start);accepted+=result.filter(r=>r.status==='accepted').length;
   check(result.every(r=>r.status==='accepted'),`${n} independent athletes accepted at genuine wall-clock 1 Hz`);
   const duplicate=await batch(payload);check(duplicate.every(r=>r.status!=='accepted'),'Duplicate frames rejected independently');
  }
  workloads.push({athletes:n,seconds:3,accepted,requests:3,meanAdmissionMs:Math.round(times.reduce((a,b)=>a+b,0)/times.length*100)/100});
 }
 check((await admin('select count(*)::int n from public.live_coaching_hr_samples where live_id=$1',[live])).rows[0].n===69,'One-second storage contains all 69 accepted observations, not ten-second buckets');
 check((await admin('select bool_and(observed_at is not null) ok from public.live_coaching_hr_samples where live_id=$1',[live])).rows[0].ok,'Sensor notification and server reception timestamps both retained');
 const denied=await batch(samples(1),roster[1]);check(denied[0].status==='revoked','Joined athlete cannot act as coach batch sender');
 const delayed=samples(1);delayed[0].receivedAt=new Date(Date.now()-60000).toISOString();check((await batch(delayed))[0].status==='invalid','Delayed old frames rejected');
 const loadStart=performance.now();await admin('delete from public.live_coaching_hr_samples where live_id=$1',[live]);
 await admin(`with t as materialized(select date_trunc('second',clock_timestamp()) base), athletes as(select athlete_id,generation,source_id from public.live_coaching_hr where live_id=$1)
 insert into public.live_coaching_hr_samples(live_id,athlete_id,sample_bucket,received_at,expires_at,bpm,generation,source_id,observed_at)
 select $1,a.athlete_id,extract(epoch from t.base-make_interval(secs=>s))::bigint,t.base-make_interval(secs=>s),t.base-make_interval(secs=>s)+interval '24 hours',65+(s%60),a.generation,a.source_id,t.base-make_interval(secs=>s)
 from athletes a cross join t cross join generate_series(1,10800) s`,[live]);
 await admin('analyze public.live_coaching_hr_samples');
 const loadMs=performance.now()-loadStart;
 check((await admin('select count(*)::int n from public.live_coaching_hr_samples where live_id=$1',[live])).rows[0].n===129600,'Twelve three-hour histories contain 129600 actual synthetic fixture records');
 const queries=[];
 for(const window of [60,900,10800,86400]){
  const start=performance.now(),snapshot=(await user(coach,'select public.read_live_monitor($1,$2,true) v',[live,window])).rows[0].v;
  queries.push({windowSeconds:window,queryMs:Math.round((performance.now()-start)*100)/100,points:snapshot.history.reduce((n,h)=>n+h.points.length,0),responseBytes:Buffer.byteLength(JSON.stringify(snapshot))});
  check(snapshot.history.length===12,'Team query preserves all twelve authorized histories');
  check(snapshot.history.every(h=>h.points.length<=724),'Overview selection bounded across the entire interval');
  if(window===10800){check(snapshot.history.every(h=>h.count>=10780),'Three-hour statistics cover the complete interval');check(snapshot.history.every(h=>Date.parse(h.points.at(-1).at)-Date.parse(h.points[0].at)>10700*1000),'Overview includes beginning and end, not only latest 240 samples');}
  if(window===60)check(snapshot.history.every(h=>h.points.length===h.count),'One-minute zoom returns every recorded one-second point');
 }
 const before=new Date(Date.now()-3600000).toISOString(),older=(await user(roster[0],'select public.read_live_monitor($1,60,true,$2) v',[live,before])).rows[0].v;
 check(older.history.length===1&&older.history[0].points.every(p=>Date.parse(p.at)<=Date.parse(before)),'Higher-resolution historical navigation remains owner-only');
 const consent=(await user(roster[0],'select public.read_live_monitor($1) v',[live])).rows[0].v.readings[0];await user(roster[0],'select public.set_live_hr_history($1,false,$2,$3)',[live,consent.generation,consent.historyVersion]);
 check((await admin('select count(*)::int n from public.live_coaching_hr_samples where live_id=$1 and athlete_id=$2',[live,roster[0]])).rows[0].n===0,'Erasure removes the full high-resolution history');
 await command(coach,'complete',live);check((await batch(samples(2))).every(r=>r.status==='revoked'),'Completion rejects queued multi-athlete uploads');
 return {assertions,workloads,historyRecords:129600,historyLoadMs:Math.round(loadMs*100)/100,queries};
}

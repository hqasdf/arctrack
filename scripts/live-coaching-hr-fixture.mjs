import assert from 'node:assert/strict';
export async function testLiveHeartRate(db,pg,configuration) {
 let passed=0;const check=(value,label)=>{assert.ok(value,label);passed++;};
 const id=n=>'b1000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const coach=id(1),a=id(2),b=id(3),outsider=id(4),org=id(5);
 const admin=async(sql,args=[])=>{await db.query('reset role');return db.query(sql,args);};
 const user=async(actor,sql,args=[])=>{await db.query('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);return db.query(sql,args);};
 const denied=async(work,code,label)=>{let error;try{await work();}catch(e){error=e;}check(error?.code===code,label);};
 const rpc=async(actor,action,live,athlete,lease={},bpm=null,sequence=null,observed=null)=>(await user(actor,'select public.live_hr_command($1,$2,$3,$4,$5,$6,$7,$8) v',[action,live,athlete,lease.generation??null,lease.sourceId??null,bpm,sequence,observed])).rows[0].v;
 const read=async(actor,live)=>(await user(actor,'select public.read_live_hr($1) v',[live])).rows[0].v;
 const liveCommand=async(actor,action,live,scoring=null)=>{
  const version=live?(await user(actor,'select public.read_live_coaching($1,null) v',[live])).rows[0].v.session.version:null;
  return (await user(actor,'select public.live_coaching_command($1,$2,$3,$4,$5,$6,$7,$8) v',[action,live,org,'BLE fixture','2026-10-26',[a,b],scoring,version])).rows[0].v;
 };
 await admin("update public.organization_members set status='active',left_at=null where organization_id=$1 and user_id=$2",[org,b]);
 const live=await liveCommand(coach,'create',null);await liveCommand(coach,'waiting',live);await liveCommand(a,'join',live,id(7));await liveCommand(b,'join',live,id(8));await liveCommand(coach,'start',live);
 const source=id(20),now=()=>new Date().toISOString();
 await denied(()=>rpc(coach,'consent',live,a),'42501','Coach cannot grant athlete consent');
 await denied(()=>rpc(coach,'assign',live,a,{sourceId:source}),'42501','Sensor assignment requires explicit athlete consent');
 let consent=await rpc(a,'consent',live,a);check((await read(a,live))[0].consent,'Athlete grants per-session consent');
 let lease=await rpc(coach,'assign',live,a,{...consent,sourceId:source});
 await rpc(coach,'sample',live,a,lease,72,1,now());
 check((await read(coach,live)).find(x=>x.athleteId===a).bpm===72,'Coach receives actual accepted latest value');
 check((await read(a,live)).length===1,'Athlete reads only own HR');
 check((await read(b,live)).every(x=>x.athleteId===b),'Other athlete cannot read first athlete HR');
 await denied(()=>read(outsider,live),'42501','Unrelated identity cannot read HR');
 await denied(()=>rpc(a,'sample',live,a,lease,90,2,now()),'42501','Only the authorized coach can ingest');
 const sameSecond=(await admin('select observed_at from public.live_coaching_hr where live_id=$1 and athlete_id=$2',[live,a])).rows[0].observed_at.toISOString();
 await denied(()=>rpc(coach,'sample',live,a,lease,90,2,sameSecond),'P0001','Database enforces sample rate across processes');
 const bConsent=await rpc(b,'consent',live,b);
 await denied(()=>rpc(coach,'assign',live,b,{...bConsent,sourceId:source}),'23505','Server rejects duplicate live assignment ID');
 await denied(()=>rpc(coach,'sample',live,a,lease,90,1,now()),'22023','Duplicate sequence cannot replay');
 await denied(()=>rpc(coach,'sample',live,a,lease,90,3,new Date(Date.now()-60000).toISOString()),'22023','Delayed measurement is rejected');
 await denied(()=>rpc(coach,'sample',live,a,lease,301,3,now()),'22023','Invalid BPM rejected');
 const revoked=await rpc(a,'revoke',live,a,lease);check(!(await read(coach,live)).find(x=>x.athleteId===a).consent,'Revocation persists and clears sharing');
 await denied(()=>rpc(coach,'sample',live,a,lease,80,3,now()),'42501','Old assignment cannot resurrect revoked data');
 await denied(()=>rpc(a,'consent',live,a,consent),'40001','Delayed consent cannot undo newer revocation');
 consent=await rpc(a,'consent',live,a,revoked);lease=await rpc(coach,'assign',live,a,{...consent,sourceId:source});
 await rpc(coach,'sample',live,a,lease,80,1,now());
 await admin("update public.live_coaching_hr set received_at=clock_timestamp()-interval '65 seconds' where live_id=$1 and athlete_id=$2",[live,a]);
 check((await read(coach,live)).find(x=>x.athleteId===a).bpm===null,'Expired measurements are not presented as live');
 await admin("update public.live_coaching_hr set bpm=80,received_at=clock_timestamp()-interval '65 seconds' where live_id=$1 and athlete_id=$2",[live,a]);
 await db.query('set role service_role');await db.query('select public.prune_live_coaching_hr()');
 check((await admin('select bpm is null and received_at is null and consent v from public.live_coaching_hr where live_id=$1 and athlete_id=$2',[live,a])).rows[0].v,'TTL cleanup erases values while preserving consent control');
 await denied(()=>user(a,'select * from public.live_coaching_hr'),'42501','No direct client table access');
 await denied(()=>user(a,'select public.prune_live_coaching_hr()'),'42501','Client cannot invoke service cleanup');
 // Prove consent revocation waits behind an in-flight sample, then wins durably.
 const first=new pg.Client(configuration),second=new pg.Client(configuration);
 try {
  await first.connect();await second.connect();
  await first.query('begin');await first.query('set local role authenticated');await first.query("select set_config('request.jwt.claim.sub',$1,true)",[coach]);
  await first.query('select public.live_hr_command($1,$2,$3,$4,$5,$6,$7,$8)',['sample',live,a,lease.generation,lease.sourceId,82,2,now()]);
  await second.query('set role authenticated');await second.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);
  let finished=false;const revoke=second.query('select public.live_hr_command($1,$2,$3,$4)', ['revoke',live,a,lease.generation]).finally(()=>{finished=true;});
  const deadline=Date.now()+3000;let waiting=false;
  while(Date.now()<deadline){waiting=(await admin("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock') v",[second.processID])).rows[0].v;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
  check(waiting&&!finished,'Concurrent revocation serializes behind the accepted sample');await first.query('commit');await revoke;
  check(!(await read(coach,live)).find(x=>x.athleteId===a).consent,'Committed revocation clears in-flight sample');
  await denied(()=>rpc(coach,'sample',live,a,lease,85,3,now()),'42501','Late retry cannot cross revoked generation');
 }finally{await first.query('rollback').catch(()=>{});await first.end();await second.end();}
 const next=(await read(a,live))[0];consent=await rpc(a,'consent',live,a,next);lease=await rpc(coach,'assign',live,a,{...consent,sourceId:source});await rpc(coach,'sample',live,a,lease,75,1,now());
 const disconnected=await rpc(coach,'disconnect',live,a,lease);
 check((await read(a,live))[0].bpm===null,'Disconnect immediately clears the latest reading');
 await denied(()=>rpc(coach,'sample',live,a,lease,80,2,now()),'42501','Disconnected assignment cannot replay');
 lease=await rpc(coach,'assign',live,a,{...disconnected,sourceId:source});
 const bLease=await rpc(coach,'assign',live,b,{...bConsent,sourceId:id(21)});await rpc(coach,'sample',live,b,bLease,90,1,now());
 await admin("update public.organization_members set status='left',left_at=now() where organization_id=$1 and user_id=$2",[org,b]);
 check((await admin('select count(*)::int n from public.live_coaching_hr where live_id=$1 and athlete_id=$2',[live,b])).rows[0].n===0,'Membership revocation erases HR consent and value');
 await denied(()=>rpc(coach,'sample',live,b,bLease,91,2,now()),'42501','Membership revocation blocks ingestion');
 await admin("update public.organization_members set status='active',left_at=null where organization_id=$1 and user_id=$2",[org,b]);
 await liveCommand(a,'leave',live);check((await admin('select count(*)::int n from public.live_coaching_hr where live_id=$1 and athlete_id=$2',[live,a])).rows[0].n===0,'Leaving clears consent and latest value');
 await liveCommand(a,'join',live,id(7));await denied(()=>rpc(coach,'sample',live,a,lease,80,4,now()),'42501','Rejoining does not restore old consent');
 await rpc(b,'consent',live,b,(await read(b,live))[0]);
 await liveCommand(coach,'complete',live);
 check((await admin('select count(*)::int n from public.live_coaching_hr where live_id=$1',[live])).rows[0].n===0,'Completion erases all per-session HR control and values');
 await denied(()=>rpc(coach,'sample',live,a,lease,80,5,now()),'42501','Completed sessions reject HR ingestion');
 return passed;
}

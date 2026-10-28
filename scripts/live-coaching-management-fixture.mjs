import assert from 'node:assert/strict';
export async function testLiveManagement(db,pg,configuration){
 let passed=0;const check=(v,label)=>{assert.ok(v,label);passed++;};const id=n=>'d6000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const [coach,a,other,org,otherOrg,scoring,round,end]=Array.from({length:8},(_,i)=>id(i+1));
 const admin=async(sql,args=[])=>{await db.query('reset role');return db.query(sql,args);};
 const user=async(actor,sql,args=[])=>{await db.query('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);return db.query(sql,args);};
 const deny=async(work,label)=>{await assert.rejects(work,{code:'42501'},label);passed++;};
 const read=async(actor,live=null,context=actor===coach?org:null)=>(await user(actor,'select public.read_live_coaching($1,$2) v',[live,context])).rows[0].v;
 const cmd=async(actor,action,live=null)=>{const version=live?(await read(actor,live)).session.version:null;return (await user(actor,'select public.live_coaching_command($1,$2,$3,$4,$5,$6,$7,$8) v',[action,live,org,'Managed training','2026-10-28',[a],action==='join'?scoring:null,version])).rows[0].v;};
 const remove=async(actor,live,version,context=org)=>(await user(actor,'select public.delete_live_coaching($1,$2,$3) v',[live,context,version])).rows[0].v;
 await admin("insert into auth.users(id,email) values($1,'manage-coach@example.invalid'),($2,'manage-athlete@example.invalid'),($3,'manage-other@example.invalid')",[coach,a,other]);
 await admin("insert into public.organizations(id,name,created_by) values($1,'Managed team',$2),($3,'Other managed team',$4)",[org,coach,otherOrg,other]);
 await admin("insert into public.organization_members(organization_id,user_id,role,status) values($1,$2,'archer','active'),($1,$3,'head_coach','active')",[org,a,other]);
 await admin("insert into public.sessions(id,user_id,title,session_date,session_type) values($1,$2,'Preserved scoring','2026-10-28','training')",[scoring,a]);
 await admin("insert into public.session_rounds(id,session_id,round_number,name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end) values($1,$2,1,'Preserved Round','Recurve',70,122,'full_face',1,3)",[round,scoring]);
 await admin('insert into public.session_ends(id,session_round_id,end_number) values($1,$2,1)',[end,round]);
 await admin("insert into public.session_notes(session_id,body) values($1,'Preserved athlete note')",[scoring]);
 await admin("insert into public.coach_feedback(organization_id,athlete_user_id,author_user_id,kind,session_id,body) values($1,$2,$3,'session',$4,'Preserved Session Feedback')",[org,a,coach,scoring]);
 for(const state of ['created','waiting','active','completed','cancelled']){
  const live=await cmd(coach,'create');let lease;
  if(state!=='created')await cmd(coach,'waiting',live);
  if(['active','completed','cancelled'].includes(state)){
   await cmd(a,'join',live);await cmd(coach,'start',live);
   const consent=(await user(a,"select public.live_hr_command('consent',$1,$2,null,null,null,null,null) v",[live,a])).rows[0].v;
   await user(a,'select public.set_live_hr_history($1,true,$2,0)',[live,consent.generation]);
   lease=(await user(coach,"select public.live_hr_command('assign',$1,$2,$3,$4,null,null,null) v",[live,a,consent.generation,id(30)])).rows[0].v;
   await user(coach,"select public.live_hr_command('sample',$1,$2,$3,$4,79,1,clock_timestamp())",[live,a,lease.generation,lease.sourceId]);
   for(let slot=1;slot<=3;slot++)await user(a,'select public.save_owned_arrow($1,$2,9,false,0.1,0.1,null)',[end,slot]);
   if(state==='completed')await cmd(coach,'complete',live);
   if(state==='cancelled')await cmd(coach,'cancel',live);
  }
  if(state==='created'){
   await admin("update public.profiles set display_name='Coach Full Name' where id=$1",[coach]);
   const invitations=(await user(a,'select public.read_live_coaching_invitations($1) v',[org])).rows[0].v.sessions;
   check(invitations.some(s=>s.id===live&&s.coach_name==='Coach Full Name'&&s.participation_state==='invited'),'Own pending invitations include real coach name and invitation status');
   check(!('scoring' in invitations[0])&&!('email' in invitations[0])&&!('hr' in invitations[0]),'Invitation summaries expose no scoring, HR or contact fields');
   check((await user(other,'select public.read_live_coaching_invitations(null) v')).rows[0].v.sessions.length===0,'Uninvited coach cannot read another athlete invitations');
   check((await user(a,'select public.read_live_coaching_invitations($1) v',[otherOrg])).rows[0].v.sessions.length===0,'Organisation filter cannot reveal another organisation');
   await db.query('set role anon');await deny(()=>db.query('select public.read_live_coaching_invitations(null)'),'Anonymous invitation access denied');
   check((await admin("select not has_function_privilege('service_role','public.read_live_coaching_invitations(uuid)','EXECUTE') ok")).rows[0].ok,'No service role invitation bypass');
  }
  if(state==='active')check((await user(a,'select public.read_live_coaching_invitations($1) v',[org])).rows[0].v.sessions.some(s=>s.id===live&&s.participation_state==='joined'),'Joined status updates through authoritative summary');
  const version=(await read(coach,live)).session.version;
  await deny(()=>remove(a,live,version),'Athlete cannot delete training');
  await deny(()=>remove(other,live,version),'Another coach cannot delete creator-owned training');
  await deny(()=>remove(coach,live,version,otherOrg),'Other organization context denied');
  await assert.rejects(()=>remove(coach,live,version+1),{code:'40001'});passed++;
  check(await remove(coach,live,version)===live,'Delete '+state+' training succeeds');
  check(await remove(coach,live,version)===live,'Repeated deletion is idempotent');
  check(!(await read(coach)).sessions.some(s=>s.id===live),'Deleted training absent from index');
  check((await user(coach,'select public.live_coaching_view_access($1,$2) ok',[live,org])).rows[0].ok===false,'Stale subscription cannot reauthorize');
  await deny(()=>read(a,live),'Deleted invitation no longer readable');
  await deny(()=>read(coach,live),'Deleted coach training no longer readable');
  for(const table of ['live_coaching_participants','live_coaching_hr','live_coaching_hr_samples','live_coaching_end_activity'])check((await admin('select count(*)::int n from public.'+table+' where live_id=$1',[live])).rows[0].n===0,table+' erased for deleted training');
  if(lease)await deny(()=>user(coach,"select public.live_hr_command('sample',$1,$2,$3,$4,80,2,clock_timestamp())",[live,a,lease.generation,lease.sourceId]),'Stale HR generation cannot recreate deleted training');
  if(lease)await deny(()=>user(coach,'select public.live_hr_batch($1,$2::jsonb) v',[live,JSON.stringify([{athleteId:a,generation:lease.generation,sourceId:lease.sourceId,bpm:80,sequence:2,receivedAt:new Date().toISOString()}])]),'A queued one-second batch is denied before processing deleted training');
 }
 check((await admin('select count(*)::int n from public.sessions where id=$1',[scoring])).rows[0].n===1,'Scoring Session preserved');
 check((await admin('select count(*)::int n from public.session_rounds where id=$1',[round])).rows[0].n===1,'Round preserved');
 check((await admin('select count(*)::int n from public.session_ends where id=$1',[end])).rows[0].n===1,'End preserved');
 check((await admin('select count(*)::int n from public.arrows where session_end_id=$1',[end])).rows[0].n===3,'All scored arrows preserved');
 check((await admin('select count(*)::int n from public.session_notes where session_id=$1',[scoring])).rows[0].n===1,'Session note preserved');
 check((await admin('select count(*)::int n from public.coach_feedback where session_id=$1',[scoring])).rows[0].n===1,'Coach feedback preserved');
 // Two independent requests serialize on the training row and both finish safely.
 const concurrent=await cmd(coach,'create'),version=(await read(coach,concurrent)).session.version;
 const clients=[new pg.Client(configuration),new pg.Client(configuration)];
 try{await Promise.all(clients.map(async c=>{await c.connect();await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[coach]);}));
 const results=await Promise.all(clients.map(c=>c.query('select public.delete_live_coaching($1,$2,$3) v',[concurrent,org,version])));check(results.every(r=>r.rows[0].v===concurrent),'Concurrent duplicate deletions both succeed without history repair');
 }finally{await Promise.all(clients.map(c=>c.end()));}
 // An already-admitted HR operation holds the same training lock until commit.
 const active=await cmd(coach,'create');await cmd(coach,'waiting',active);await cmd(a,'join',active);await cmd(coach,'start',active);
 const v=(await read(coach,active)).session.version;
 const locker=new pg.Client(configuration),deleter=new pg.Client(configuration);let pending;
 try{await locker.connect();await deleter.connect();await locker.query('begin');await locker.query('select id from public.live_coaching_sessions where id=$1 for share',[active]);await deleter.query('set role authenticated');await deleter.query("select set_config('request.jwt.claim.sub',$1,false)",[coach]);const pid=(await deleter.query('select pg_backend_pid() pid')).rows[0].pid;pending=deleter.query('select public.delete_live_coaching($1,$2,$3) v',[active,org,v]);
 let blocked=false;for(let i=0;i<30;i++){blocked=(await admin('select cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked;if(blocked)break;await new Promise(r=>setTimeout(r,10));}check(blocked,'Deletion waits behind an in-flight HR-compatible session lock');await locker.query('commit');check((await pending).rows[0].v===active,'Deletion completes after the admitted transaction');
 }finally{await locker.query('rollback').catch(()=>{});await Promise.all([locker.end(),deleter.end()]);}
 const revoked=await cmd(coach,'create');await admin("update public.organization_members set status='left',left_at=clock_timestamp() where organization_id=$1 and user_id=$2",[org,coach]);await deny(()=>remove(coach,revoked,1),'Revoked coach cannot delete');
 await db.query('set role anon');await deny(()=>db.query('select public.delete_live_coaching($1,$2,1)',[revoked,org]),'Anonymous deletion denied');
 check((await admin("select not has_function_privilege('service_role','public.delete_live_coaching(uuid,uuid,bigint)','EXECUTE') ok")).rows[0].ok,'No service-role deletion bypass');
 await admin("update public.organization_members set status='left',left_at=clock_timestamp() where organization_id=$1 and user_id=$2",[org,a]);
 check((await user(a,'select public.read_live_coaching_invitations($1) v',[org])).rows[0].v.sessions.length===0,'Membership revocation removes invitation access');
 await admin('select 1');return passed;
}

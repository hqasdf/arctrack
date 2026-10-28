import assert from 'node:assert/strict';

export async function testLiveRoles(db) {
 let passed=0;
 const check=(ok,label)=>{assert.ok(ok,label);passed++;};
 const id=n=>'b5000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const [coach,a,b,other,org,otherOrg,sa,sb]=Array.from({length:8},(_,i)=>id(i+1));
 const admin=async(sql,args=[])=>{await db.query('reset role');return db.query(sql,args);};
 const user=async(actor,sql,args=[])=>{await db.query('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);return db.query(sql,args);};
 const read=async(actor,live,context=null)=>(await user(actor,'select public.read_live_coaching($1,$2) v',[live,context])).rows[0].v;
 const denied=async(work,label)=>{await assert.rejects(work,{code:'42501'},label);passed++;};
 const cmd=async(actor,action,live=null,scoring=null)=>{
  const version=live?(await read(actor,live,actor===coach?org:null)).session.version:null;
  return (await user(actor,'select public.live_coaching_command($1,$2,$3,$4,$5,$6,$7,$8) v',[action,live,org,'Role boundary training','2026-10-28',[a,b],scoring,version])).rows[0].v;
 };
 await admin("insert into auth.users(id,email) values($1,'role-coach@example.invalid'),($2,'role-a@example.invalid'),($3,'role-b@example.invalid'),($4,'role-other@example.invalid')",[coach,a,b,other]);
 await admin("insert into public.organizations(id,name,created_by) values($1,'Role team',$2),($3,'Other team',$4)",[org,coach,otherOrg,other]);
 await admin("insert into public.organization_members(organization_id,user_id,role,status) values($1,$2,'archer','active'),($1,$3,'archer','active'),($4,$5,'archer','active')",[org,a,b,otherOrg,coach]);
 for(const [session,athlete] of [[sa,a],[sb,b]])await admin("insert into public.sessions(id,user_id,title,session_date,session_type) values($1,$2,'Private scoring','2026-10-28','training')",[session,athlete]);
 await admin("insert into public.session_rounds(id,session_id,round_number,name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end) values($1,$2,1,'Target boundary','Recurve',70,122,'full_face',1,3)",[id(9),sa]);
 await admin('insert into public.session_ends(id,session_round_id,end_number) values($1,$2,1)',[id(10),id(9)]);
 await user(a,"select public.save_owned_arrow($1,1,9,false,0.1,-0.2,null)",[id(10)]);
 await user(a,"select public.save_owned_arrow($1,2,8,false,null,null,null)",[id(10)]);
 const live=await cmd(coach,'create');
 // Even legacy/inconsistent invitation metadata must not expose a private association.
 await admin('update public.live_coaching_participants set scoring_session_id=$1 where live_id=$2 and athlete_id=$3',[sa,live,a]);
 await denied(()=>read(a,live,org),'Athlete cannot select coach organisation context');
 await denied(()=>read(coach,live),'Coach must explicitly enter the coach context');
 await denied(()=>read(coach,live,otherOrg),'Session must match the active organisation');
 await denied(()=>user(a,'select public.read_live_monitor($1)',[live]),'Athlete cannot invoke the team monitor RPC');
 await denied(()=>user(a,'select public.read_live_athlete_hr($1)',[live]),'Invited athlete cannot read HR monitoring');
 const invited=await read(coach,live,org);
 check(invited.participants.every(p=>p.scoring===null&&p.scoringSessionId===null),'Invitations expose neither scoring data nor association metadata');
 check((await read(a,live)).participants.length===1,'Athlete only receives own invitation');
 check((await read(a,live)).participants[0].scoringSessionId===null,'Invitation does not expose legacy scoring association');
 check((await user(a,'select public.live_coaching_view_access($1,$2) ok',[live,org])).rows[0].ok===false,'Athlete cannot open coach EventSource context');
 check((await user(a,'select public.live_coaching_view_access($1,null) ok',[live])).rows[0].ok===true,'Athlete has own private invitation updates');
 await user(a,"select set_config('realtime.topic',$1,false)",['live-coaching:'+live+':'+coach]);
 check((await user(a,'select private.live_coaching_topic($1) ok',['live-coaching:'+live+':'+coach])).rows[0].ok===false,'Athlete cannot subscribe to the coach private topic');
 await cmd(coach,'waiting',live);
 await cmd(a,'join',live);
 let joined=await read(coach,live,org);
 check(joined.participants.find(p=>p.athleteId===a).state==='joined','Join succeeds independently of scoring');
 check(joined.participants.every(p=>p.scoring===null&&p.scoringSessionId===null),'Joining alone grants no scoring access');
 await denied(()=>cmd(a,'link',live,sb),'Athlete cannot connect another athlete scoring');
 await cmd(a,'link',live,sa);
 check((await read(coach,live,org)).participants.find(p=>p.athleteId===a).scoring.id===sa,'Coach receives scoring only after explicit owned connection');
 check((await read(a,live)).participants[0].scoringSessionId===sa,'Reload restores confirmed connection');
 const plotted=(await read(coach,live,org)).participants.find(p=>p.athleteId===a).scoring.session_rounds[0].session_ends[0].arrows;
 check(plotted.some(v=>v.arrow_number===1&&v.plot_x===0.1&&v.plot_y===-0.2),'Authorised linked coach receives actual saved target coordinates');
 check(plotted.some(v=>v.arrow_number===2&&v.plot_x===null&&v.plot_y===null),'Missing coordinates stay null despite saved score');
 check((await read(a,live)).participants.every(p=>p.athleteId===a),'Target coordinates cannot expose another athlete to own-view readers');
 await user(a,"select public.save_owned_arrow($1,1,10,true,0.02,-0.01,null)",[id(10)]);
 const corrected=(await read(coach,live,org)).participants.find(p=>p.athleteId===a).scoring.session_rounds[0].session_ends[0].arrows.find(v=>v.arrow_number===1);
 check(corrected.is_x&&corrected.score_points===10&&corrected.plot_x===0.02,'Scoring correction returns updated score and recorded placement');

 await denied(()=>cmd(a,'join',live),'Repeated join cannot silently change the connection');
 await cmd(b,'decline',live);
 check((await read(coach,live,org)).participants.find(p=>p.athleteId===b).scoring===null,'Declining cannot expose scoring');
 check((await user(coach,'select public.read_live_monitor($1) v',[live])).rows[0].v.readings.every(r=>r.bpm===null&&!r.consent),'HR is unavailable without athlete consent');
 check((await user(a,'select public.read_live_athlete_hr($1) v',[live])).rows[0].v.readings.every(r=>r.athleteId===a),'Own HR reader never exposes teammates');
 await denied(()=>user(a,'select private.live_hr_snapshot($1,900,true,null)',[live]),'Internal snapshot helper has no client execution grant');
 await cmd(a,'leave',live);
 check((await read(coach,live,org)).participants.find(p=>p.athleteId===a).scoring===null,'Leave revokes live scoring');
 await denied(()=>user(a,'select public.read_live_athlete_hr($1)',[live]),'Leave removes own monitoring access');
 await admin("update public.organization_members set status='left',left_at=clock_timestamp() where organization_id=$1 and user_id=$2",[org,a]);
 await denied(()=>read(a,live),'Membership revocation prevents participation reads');
 check((await read(coach,live,org)).participants.every(p=>p.athleteId!==a),'Removed member excluded from coach response');
 check((await admin('select count(*)::integer n from public.sessions where id in ($1,$2)',[sa,sb])).rows[0].n===2,'Existing historical scored Sessions remain intact');
 // The same account coaches org A and participates as an athlete in org B.
 const dual=(await user(other,"select public.live_coaching_command('create',null,$1,'Dual role training','2026-10-28',$2::uuid[]) v",[otherOrg,[coach]])).rows[0].v;
 check((await read(coach,dual)).coach===false,'Dual-role account enters athlete context in its athlete organisation');
 await denied(()=>read(coach,dual,org),'Own coach role in another organisation cannot authorize this session');
 await denied(()=>user(coach,'select public.read_live_monitor($1)',[dual]),'Dual-role account cannot monitor the other organisation');
 await db.query('set role anon');await denied(()=>db.query('select public.read_live_coaching($1,$2)',[live,org]),'Anonymous target/scoring RPC access denied');await denied(()=>db.query('select public.read_live_athlete_hr($1)',[live]),'Anonymous own-HR RPC access denied');
 await admin('select 1');
 return passed;
}

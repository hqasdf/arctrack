/** Synthetic data ONLY inside the owned, loopback disposable PostgreSQL preview. */
export async function seedMonitorDemo(owner,withActor,{id,coach,org,actors,sessions}){
 await owner.query('reset role');
 const names=['Alex Tan','Beth Lim','Chloe Ng','Daniel Lee','Ethan Wong','Faith Chen','Grace Koh','Hannah Teo'];
 const roster=names.map((_,i)=>i<2?actors[i?'b':'a']:id(100+i));
 for(let i=0;i<roster.length;i++){
  const athlete=roster[i],session=id(200+i),round=id(300+i);sessions[String.fromCharCode(97+i)]=session;actors[String.fromCharCode(97+i)]=athlete;
  await owner.query('insert into auth.users(id,email) values($1,$2) on conflict(id) do nothing',[athlete,`monitor-${i}@example.invalid`]);
  await owner.query('insert into public.profiles(id,display_name) values($1,$2) on conflict(id) do update set display_name=excluded.display_name',[athlete,names[i]]);
  await owner.query("insert into public.organization_members(organization_id,user_id,role,status) values($1,$2,'archer','active') on conflict(organization_id,user_id) do update set status='active',left_at=null",[org,athlete]);
  await owner.query("insert into public.sessions(id,user_id,title,session_date,session_type) values($1,$2,'Synthetic range practice','2026-10-27','training')",[session,athlete]);
  await owner.query("insert into public.session_rounds(id,session_id,round_number,name,division,distance_metres,face_diameter_cm,face_type,planned_ends,arrows_per_end) values($1,$2,1,'70 m round','Recurve',70,122,'full_face',4,3)",[round,session]);
  for(let e=1;e<=4;e++)await owner.query('insert into public.session_ends(id,session_round_id,end_number) values($1,$2,$3)',[id(400+i*10+e),round,e]);
 }
 const command=async(actor,action,live=null,scoring=null)=>withActor(actor,async c=>{
  const version=live?(await c.query('select public.read_live_coaching($1,null) v',[live])).rows[0].v.session.version:null;
  return (await c.query('select public.live_coaching_command($1,$2,$3,$4,$5,$6,$7,$8) id',[action,live,org,'Saturday performance squad','2026-10-27',roster,scoring,version])).rows[0].id;
 });
 const live=await command(coach,'create');await command(coach,'waiting',live);
 for(let i=0;i<roster.length-1;i++)await command(roster[i],'join',live,id(200+i));
 await command(coach,'start',live);
 for(let i=0;i<roster.length-1;i++){
  const athlete=roster[i];
  for(let slot=1;slot<=Math.min(8,2+i);slot++)await withActor(athlete,c=>c.query('select * from public.save_owned_arrow($1,$2,$3,false,null,null,null)',[id(400+i*10+Math.ceil(slot/3)),(slot-1)%3+1,7+(slot+i)%4]));
  if(i===6)continue;
  await withActor(athlete,c=>c.query("select public.live_hr_command('consent',$1,$2) v",[live,athlete]));
  const reading=await withActor(athlete,async c=>(await c.query('select public.read_live_monitor($1) v',[live])).rows[0].v.readings[0]);
  await withActor(athlete,c=>c.query('select public.set_live_hr_history($1,true,$2,0)',[live,reading.generation]));
  const lease=await withActor(coach,async c=>(await c.query("select public.live_hr_command('assign',$1,$2,$3,$4) v",[live,athlete,reading.generation,id(600+i)])).rows[0].v);
  await owner.query('reset role');
  // Explicitly fake, timestamped fixture observations, never used by the real application.
  for(let k=0;k<72;k++)if(k<30||k>37)await owner.query("with t as materialized(select clock_timestamp()-make_interval(secs=>$3) as sample_time) insert into public.live_coaching_hr_samples select $1,$2,floor(extract(epoch from t.sample_time)/10)::bigint,t.sample_time,t.sample_time+interval '24 hours',$4,$5,$6 from t where true on conflict do nothing",[live,athlete,(72-k)*10,68+i*8+Math.round(Math.sin(k/6)*12),lease.generation,lease.sourceId]);
  if(i<4)await withActor(coach,c=>c.query("select public.live_hr_command('sample',$1,$2,$3,$4,$5,1,clock_timestamp())",[live,athlete,lease.generation,lease.sourceId,75+i*9]));
  else await withActor(coach,c=>c.query("select public.live_hr_command('disconnect',$1,$2,$3,$4)",[live,athlete,lease.generation,lease.sourceId]));
  await withActor(athlete,c=>c.query('select public.touch_live_presence($1,null)',[live]));
 }
 return live;
}

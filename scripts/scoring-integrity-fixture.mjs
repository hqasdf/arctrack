/** Synthetic owned-cluster fixture only; invoked by the disposable PG runner. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function testScoringIntegrity(db,pg,configuration){
 const owner=randomUUID(),other=randomUUID();let checks=0;
 const check=(value,label)=>{assert.ok(value,label);checks++;};
 async function as(client,user,sql,args=[]){
  await client.query('begin');
  try{await client.query('set local role authenticated');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
   const result=await client.query(sql,args);await client.query('commit');return result;
  }catch(e){await client.query('rollback');throw e;}
 }
 const call=(sql,args)=>as(db,owner,sql,args);
 async function denied(fn,code){await assert.rejects(fn,e=>e.code===code);checks++;}
 const settings=async round=>(await db.query(`select jsonb_build_object('name',name,'division',division,'distanceMetres',distance_metres,'faceDiameterCm',face_diameter_cm,'faceType',face_type,'ends',planned_ends,'arrowsPerEnd',arrows_per_end) value from public.session_rounds where id=$1`,[round])).rows[0].value;
 const read=end=>call('select public.read_owned_arrow_slot($1,1) value',[end]);
 const write=(end,expected,request,arrow)=>call('select public.write_owned_arrow_slot($1,1,$2,$3,$4::jsonb) value',[end,expected,request,arrow&&JSON.stringify(arrow)]);
 const a=score=>({score_points:score,is_x:false,plot_x:null,plot_y:null,face_index:null});
 const configure=(round,expected,ends=1)=>call("select * from public.configure_empty_round($1,$2::jsonb,'Changed','Recurve',18,40,'full_face',$3,3)",[round,JSON.stringify(expected),ends]);
 try{
  await db.query("insert into auth.users(id,email) values($1,'integrity-owner@example.invalid'),($2,'integrity-other@example.invalid')",[owner,other]);
  const session=(await call("select id from public.create_owned_session('Integrity',current_date,'training')")).rows[0].id;
  const round=(await call("select round_id from public.create_round_with_ends($1,'Original','Recurve',70,122,'full_face',2,6)",[session])).rows[0].round_id;
  const end=(await db.query('select id from public.session_ends where session_round_id=$1 and end_number=1',[round])).rows[0].id;
  const first=(await read(end)).rows[0].value,requestA=randomUUID(),requestB=randomUUID();
  await write(end,first.revision,requestA,a(8)); // Deliberately discard the successful response.
  const recovered=(await read(end)).rows[0].value;
  check(recovered.revision===requestA&&recovered.arrow.score_points===8,'Authoritative read recovers committed save');
  await write(end,recovered.revision,requestB,null);
  check((await read(end)).rows[0].value.arrow===null,'Delete removes unknown-ID Arrow');
  await denied(()=>write(end,first.revision,requestA,a(8)),'40001');
  check((await read(end)).rows[0].value.arrow===null,'Delayed old save cannot resurrect deletion');
  check((await write(end,recovered.revision,requestB,null)).rows[0].value.revision===requestB,'Delete replay is idempotent');
  await denied(()=>write(end,recovered.revision,requestB,a(10)),'22023');
  const requestC=randomUUID();await write(end,requestB,requestC,a(9));
  const requestD=randomUUID();await write(end,(await read(end)).rows[0].value.revision,requestD,a(8));
  await denied(()=>write(end,requestB,requestC,a(9)),'40001');
  check((await read(end)).rows[0].value.arrow.score_points===8,'Revert persists8 rather than falsely confirming9');
  await denied(()=>as(db,other,'select public.read_owned_arrow_slot($1,1)',[end]),'42501');
  await denied(()=>as(db,other,'select public.write_owned_arrow_slot($1,1,$2,$3,null)',[end,requestD,randomUUID()]),'42501');
  check((await db.query("select not has_table_privilege('authenticated','private.arrow_slot_revisions','SELECT') and not has_function_privilege('anon','public.write_owned_arrow_slot(uuid,integer,uuid,uuid,jsonb)','EXECUTE') ok")).rows[0].ok,'Private revision state and anonymous RPC execution denied');
  await call('select * from public.save_owned_arrow($1,1,7,false,null,null,null)',[end]);
  await denied(()=>write(end,requestD,randomUUID(),a(10)),'40001');
  await write(end,(await read(end)).rows[0].value.revision,randomUUID(),null);
  const original=await settings(round);
  const beforeConfigRevision=(await read(end)).rows[0].value.revision;
  await denied(()=>configure(round,original,121),'22023');
  check(JSON.stringify(await settings(round))===JSON.stringify(original),'Rejected configuration preserves Round');
  const configured=await configure(round,original);
  check(configured.rows[0].round_id===round&&configured.rows[0].round_number===1,'Configuration preserves Round identity and number');
  await denied(()=>write(end,beforeConfigRevision,randomUUID(),a(10)),'40001');
  check((await db.query('select id from public.session_ends where session_round_id=$1',[round])).rows[0].id===end,'Retained End identity preserved');
  await denied(()=>configure(round,original),'40001');
  await call("select * from public.configure_empty_round($1,$2,'Full settings','Compound',50,80,'triple_face',2,6)",[round,await settings(round)]);
  const full=await settings(round);
  check(full.name==='Full settings'&&full.division==='Compound'&&full.distanceMetres===50&&full.faceDiameterCm===80&&full.faceType==='triple_face'&&full.ends===2&&full.arrowsPerEnd===6,'All full configuration fields persist together');
  const untouchedEnd=(await db.query('select id from public.session_ends where session_round_id=$1 and end_number=2',[round])).rows[0].id;
  const untouchedRevision=(await read(untouchedEnd)).rows[0].value.revision;
  await configure(round,full,2);
  await denied(()=>write(untouchedEnd,untouchedRevision,randomUUID(),a(10)),'40001');
  await denied(async()=>as(db,other,"select * from public.configure_empty_round($1,$2,'Foreign','Recurve',18,40,'full_face',1,3)",[round,await settings(round)]),'42501');
  await call('select * from public.save_owned_arrow($1,1,6,false,null,null,null)',[end]);
  await denied(async()=>configure(round,await settings(round)),'22023');
  check((await read(end)).rows[0].value.arrow.score_points===6,'Scored Round remains intact after Configure rejection');
  await call("select * from public.update_owned_round_settings($1,'Scored metadata','Recurve',18,40,2)",[round]);
  check((await read(end)).rows[0].value.arrow.score_points===6,'Legacy scored metadata/End expansion remains compatible');
  await write(end,(await read(end)).rows[0].value.revision,randomUUID(),null);
  const before=await settings(round);
  await db.query(`create function private.integrity_end_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic append failure';end$$;
   create trigger integrity_end_failure before insert on public.session_ends for each row execute function private.integrity_end_failure()`);
  try{await assert.rejects(configure(round,before,3),/Synthetic append failure/);checks++;}
  finally{await db.query('drop trigger integrity_end_failure on public.session_ends;drop function private.integrity_end_failure()');}
  check(JSON.stringify(await settings(round))===JSON.stringify(before),'End failure rolls configuration back atomically');
  const blocker=new pg.Client(configuration),contender=new pg.Client(configuration);await blocker.connect();await contender.connect();
  try{
   await blocker.query('begin');await blocker.query('set local role authenticated');await blocker.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
   await blocker.query('select * from public.save_owned_arrow($1,1,10,false,null,null,null)',[end]);
   let completed=false;const pending=as(contender,owner,"select * from public.configure_empty_round($1,$2,'Concurrent','Recurve',18,40,'full_face',2,3)",[round,await settings(round)]).then(()=>({ok:true}),e=>({code:e.code})).finally(()=>completed=true);
   await new Promise(r=>setTimeout(r,40));check(!completed,'First scoring write holds common Round lock');await blocker.query('commit');
   check((await pending).code==='22023','Concurrent Configure rejects after scoring commits');
   check((await read(end)).rows[0].value.arrow.score_points===10,'Concurrent scoring survives');
   await write(end,(await read(end)).rows[0].value.revision,randomUUID(),null);
   await blocker.query('begin');await blocker.query('set local role authenticated');await blocker.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
   await blocker.query("select * from public.configure_empty_round($1,$2,'Configured first','Recurve',18,40,'full_face',1,1)",[round,await settings(round)]);
   let saved=false;const staleSave=as(contender,owner,'select * from public.save_owned_arrow($1,2,10,false,null,null,null)',[end]).then(()=>({ok:true}),e=>({code:e.code})).finally(()=>saved=true);
   await new Promise(r=>setTimeout(r,40));check(!saved,'Scoring waits for in-flight configuration');await blocker.query('commit');
   check((await staleSave).code==='22023','Waiting scoring validates the new slot bounds');
   check((await db.query('select count(*)::int n from public.arrows where session_end_id=$1',[end])).rows[0].n===0,'Configuration-first race cannot insert outside the new Round');
  }finally{await blocker.query('rollback');await blocker.end();await contender.end();}
  return checks;
 }finally{await db.query('delete from auth.users where id=any($1::uuid[])',[[owner,other]]);}
}

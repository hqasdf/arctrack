import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createArrowPersistence } from '@arc-track/core/arrow-persistence';
import { WebArrowQueue } from '../src/features/sessions/web-arrow-queue.ts';
import { scoringJournal, DeviceScoringRecovery } from '../src/features/sessions/device-scoring.ts';

const arrow={id:'saved',end:1,arrow:1,score:'9',plot:{x:.2,y:.1},syncState:'saved'};
const configuration=JSON.stringify([12,6,'Recurve',70,122,'full_face']);
const tick=()=>new Promise(setImmediate);
function fixture(){
  const disk=new Map();let fail=false;
  const storage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>{if(fail)throw Error('quota');disk.set(key,value);},removeItem:key=>{if(fail)throw Error('unavailable');disk.delete(key);}};
  const journal=scoringJournal(storage,'project','owner','round',configuration);
  return {disk,storage,journal,fail:value=>{fail=value;}};
}
function writer(journal,remote,{loseResponse=false,initial=[]}={}){
  let queue,persistence,writes=0;
  const persist=()=>journal.save(queue.recovery(),persistence.recovery());
  const saved=journal.load();
  persistence=createArrowPersistence({initial,requestId:randomUUID,recovery:saved?.persistence,
    beforeWrite:persist,read:async()=>structuredClone(remote),write:async(slot,desired,intent)=>{
      writes++;assert.ok(journal.load().persistence.some(([,state])=>state.ownRequests.includes(intent.requestId)),'request ID is durable before write');
      if(remote.revision!==intent.expectedRevision)throw Error('conflict');
      remote.revision=intent.requestId;remote.arrow=desired?{...desired,id:'saved'}:null;
      if(loseResponse)throw Error('response lost');return structuredClone(remote);
    }});
  queue=new WebArrowQueue(initial,async value=>{try{return{ok:true,data:await persistence.save(value)};}catch(error){return{ok:false,message:error.message};}},async value=>{try{await persistence.remove(value);return{ok:true};}catch(error){return{ok:false,message:error.message};}},()=>{try{persist();}catch{/* UI retains dirty guard when storage fails. */}});
  if(saved){for(const cell of saved.queue)persistence.restoreBaseline(cell.identity,cell.confirmed);queue.restore(saved.queue);}
  return{queue,persistence,writes:()=>writes};
}
test('the latest desired score and plot are stored before the first request and safely restored after lost response',async()=>{
  const f=fixture(),remote={revision:randomUUID(),arrow:null};
  const first=writer(f.journal,remote,{loseResponse:true});
  first.queue.edit(arrow);assert.equal(f.journal.load().queue[0].desired.score,'9');
  assert.equal(await first.queue.flush(),false);assert.equal(remote.arrow.score,'9');
  const second=writer(f.journal,remote,{initial:[remote.arrow]});
  assert.equal(second.queue.hasUnconfirmed(),true);assert.equal(second.queue.desiredArrows()[0].syncState,'failed');
  second.queue.retryAll();assert.equal(await second.queue.flush(),true);
  assert.equal(remote.arrow.id,'saved');assert.deepEqual(remote.arrow.plot,arrow.plot);assert.equal(f.journal.load(),null);
});
test('rapid corrections survive restart with the latest intention and never overwrite another-device revisions',async()=>{
  const f=fixture(),originalRevision=randomUUID(),remote={revision:originalRevision,arrow:null};
  const first=writer(f.journal,remote,{loseResponse:true});first.queue.edit(arrow);await first.queue.flush();
  first.queue.edit({...arrow,score:'X',plot:{x:0,y:0}});await first.queue.flush();
  assert.equal(f.journal.load().queue[0].desired.score,'X');
  remote.revision=randomUUID();remote.arrow={...arrow,score:'7'};
  const recovered=writer(f.journal,remote,{initial:[remote.arrow]});recovered.queue.retryAll();
  assert.equal(await recovered.queue.flush(),false);assert.equal(remote.arrow.score,'7');assert.equal(recovered.writes(),0);
  assert.equal(f.journal.load().queue[0].desired.score,'X');
});
test('pending deletion survives restart and cannot be mistaken for a saved absence',async()=>{
  const f=fixture(),remote={revision:randomUUID(),arrow:structuredClone(arrow)};
  const original=writer(f.journal,remote,{loseResponse:true,initial:[arrow]});original.queue.delete('1-1');await original.queue.flush();
  // A failed deletion remains visibly recoverable; repeat Delete records the latest null intention.
  original.queue.delete('1-1');await tick();await original.queue.flush();
  const recovered=writer(f.journal,remote,{initial:remote.arrow?[remote.arrow]:[]});
  assert.equal(recovered.queue.hasUnconfirmed(),true);recovered.queue.retryAll();
  assert.equal(await recovered.queue.flush(),true);assert.equal(remote.arrow,null);assert.equal(f.journal.load(),null);
});
test('quota failure prevents an unjournaled server mutation and remains retryable',async()=>{
  const f=fixture(),remote={revision:randomUUID(),arrow:null},current=writer(f.journal,remote);
  f.fail(true);current.queue.edit(arrow);assert.equal(await current.queue.flush(),false);
  assert.equal(current.writes(),0);assert.equal(remote.arrow,null);assert.equal(current.queue.hasUnconfirmed(),true);
  f.fail(false);current.queue.retryAll();assert.equal(await current.queue.flush(),true);assert.equal(remote.arrow.score,'9');
});
test('recovery is isolated by project, account, Round and configuration without deleting incompatible data',()=>{
  const f=fixture();f.journal.save([{identity:arrow,confirmed:null,desired:arrow}],[]);
  for(const [project,owner,round] of [['other','owner','round'],['project','other','round'],['project','owner','other']])assert.equal(scoringJournal(f.storage,project,owner,round,configuration).load(),null);
  assert.throws(()=>scoringJournal(f.storage,'project','owner','round','[6,3]').load(),/preserved/);
  assert.equal(f.disk.size,1);const key=[...f.disk.keys()][0];f.disk.set(key,'{');assert.throws(()=>f.journal.load());assert.equal(f.disk.get(key),'{');
});
test('malformed request recovery cannot remove the uncertain-write fence',()=>{
  assert.throws(()=>createArrowPersistence({initial:[],read:async()=>{},write:async()=>{},requestId:randomUUID,recovery:[['1-1',{snapshot:{revision:'invalid',arrow:null},ownRequests:[]}]]}),/invalid/);
});
test('a crash before the first revision read preserves the original baseline instead of rebasing onto another device',async()=>{
  const f=fixture();f.journal.save([{identity:arrow,confirmed:null,desired:arrow}],[]);
  const remote={revision:randomUUID(),arrow:{...arrow,score:'7'}};
  const recovered=writer(f.journal,remote,{initial:[remote.arrow]});recovered.queue.retryAll();
  assert.equal(await recovered.queue.flush(),false);assert.equal(recovered.writes(),0);assert.equal(remote.arrow.score,'7');
  assert.equal(f.journal.load().queue[0].desired.score,'9');
});
test('browsers without Web Locks can use guarded online-only scoring but cannot bypass existing recovery',()=>{
  const f=fixture(),online=new DeviceScoringRecovery();online.onlineOnly(f.storage,'project','owner','round',configuration);
  assert.equal(online.persist([],[]),false);assert.equal(f.disk.size,0);
  f.journal.save([{identity:arrow,confirmed:null,desired:arrow}],[]);
  assert.throws(()=>new DeviceScoringRecovery().onlineOnly(f.storage,'project','owner','round',configuration),/exclusive editor/);
  assert.equal(f.disk.size,1);
});

test('explicit server review fences late requests without changing the chosen score or coordinates',async()=>{
  const f=fixture(),remote={revision:randomUUID(),arrow:{...arrow,score:'7',plot:{x:.3,y:.2}}};
  const current=writer(f.journal,remote,{initial:[]});current.queue.edit(arrow);await current.queue.flush();
  assert.equal(current.writes(),0);
  const snapshot=await current.persistence.inspect(arrow),oldRevision=remote.revision;
  current.persistence.chooseSnapshot(arrow,snapshot);
  current.queue.restore([{identity:arrow,confirmed:snapshot.arrow,desired:snapshot.arrow}]);
  f.journal.save(current.queue.recovery(),current.persistence.recovery());current.queue.retryAll();
  assert.equal(await current.queue.flush(),true);assert.notEqual(remote.revision,oldRevision);
  assert.equal(remote.arrow.score,'7');assert.deepEqual(remote.arrow.plot,{x:.3,y:.2});assert.equal(f.journal.load(),null);
});

test('another-device edit after server review cannot be overwritten by the chosen snapshot',async()=>{
  const f=fixture(),remote={revision:randomUUID(),arrow:{...arrow,score:'7'}};
  const current=writer(f.journal,remote),snapshot=await current.persistence.inspect(arrow);
  current.persistence.chooseSnapshot(arrow,snapshot);
  current.queue.restore([{identity:arrow,confirmed:snapshot.arrow,desired:snapshot.arrow}]);
  remote.revision=randomUUID();remote.arrow={...arrow,score:'6'};
  current.queue.retryAll();assert.equal(await current.queue.flush(),false);
  assert.equal(current.writes(),0);assert.equal(remote.arrow.score,'6');
});

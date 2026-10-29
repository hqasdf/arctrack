import assert from 'node:assert/strict';
import test from 'node:test';
import {createArrowPersistence} from '../src/arrow-persistence.ts';
const zero='00000000-0000-0000-0000-000000000000';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const arrow=(score='8')=>({id:'saved',end:1,arrow:1,score,plot:null,syncState:'saved'});
function fixture(initial=null){
 let state={revision:zero,arrow:initial},sequence=0,lose=false,failRead=false,held;
 const calls=[];
 const persistence=createArrowPersistence({initial:initial?[initial]:[],requestId:()=>id(++sequence),
  read:async()=>{if(failRead)throw Error('Offline');return structuredClone(state);},
  write:async(slot,desired,intent)=>{calls.push({slot,desired,intent});if(held)await held;
   if(state.revision!==intent.expectedRevision)throw Error('Conflict');
   state={revision:intent.requestId,arrow:desired?{...desired,id:'saved'}:null};
   if(lose){lose=false;throw Error('Committed but response lost');}return structuredClone(state);}});
 return {persistence,calls,state:()=>state,lose:()=>lose=true,failRead:v=>failRead=v,other:()=>state={revision:id(999),arrow:arrow('10')}};
}
test('uncertain initial save reconciles then deletes by stable slot without an acknowledged ID',async()=>{
 const f=fixture();f.lose();await assert.rejects(f.persistence.save(arrow()));await f.persistence.remove({end:1,arrow:1});
 assert.equal(f.state().arrow,null);assert.equal(f.calls.length,2);
});
test('uncertain correction reconciles before restoring an earlier score',async()=>{
 const f=fixture(arrow());f.lose();await assert.rejects(f.persistence.save(arrow('9')));await f.persistence.save(arrow('8'));
 assert.equal(f.state().arrow.score,'8');assert.equal(f.calls[1].intent.expectedRevision,f.calls[0].intent.requestId);
});
test('uncertain delete remains retryable, including an already absent slot',async()=>{
 const f=fixture(arrow());f.lose();await assert.rejects(f.persistence.remove({end:1,arrow:1}));await f.persistence.remove({end:1,arrow:1});assert.equal(f.state().arrow,null);
});
test('failed authoritative reads cannot report success or issue a blind mutation',async()=>{
 const f=fixture();f.failRead(true);await assert.rejects(f.persistence.save(arrow()));assert.equal(f.calls.length,0);
});
test('another device revision is a conflict even after our lost response',async()=>{
 const f=fixture();f.lose();await assert.rejects(f.persistence.save(arrow()));f.other();await assert.rejects(f.persistence.remove({end:1,arrow:1}),/another device/);assert.equal(f.state().arrow.score,'10');
});
test('an uncommitted old request is fenced by the newer mutation revision',async()=>{
 let state={revision:zero,arrow:null},sequence=0,late;
 const p=createArrowPersistence({initial:[],requestId:()=>id(++sequence),read:async()=>structuredClone(state),write:async(_,desired,intent)=>{
  const apply=()=>{if(state.revision!==intent.expectedRevision)throw Error('Conflict');state={revision:intent.requestId,arrow:desired};return structuredClone(state);};
  if(sequence===1){late=apply;throw Error('Transport failed before server settled');}return apply();}});
 await assert.rejects(p.save(arrow()));await p.remove({end:1,arrow:1});assert.throws(late,/Conflict/);assert.equal(state.arrow,null);
});
test('request UUID casing is canonicalized before comparing authoritative revisions',async()=>{
 const p=createArrowPersistence({initial:[],requestId:()=>"ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF",read:async()=>({revision:zero,arrow:null}),write:async(_,a,intent)=>({revision:intent.requestId.toLowerCase(),arrow:a})});
 assert.equal((await p.save(arrow())).score,'8');
});

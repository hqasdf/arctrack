import assert from 'node:assert/strict';
import test from 'node:test';
import {loadSessionModule,settle} from './helpers/session-layout-runtime.mjs';
const {HeartRateBatcher}=loadSessionModule('src/features/live-coaching/heart-rate/batch.ts');
const {createReadingStore,historyAuthorityMatches}=loadSessionModule('src/features/live-coaching/heart-rate/measurement.ts');
const frame=(id,sequence=1)=>({athleteId:String(id),generation:'generation',sourceId:'source'+id,bpm:70+Number(id),sequence,receivedAt:new Date(100000).toISOString()});
test('1/2/8/12 sensors share one bounded upload without retries or idle uploads',async()=>{
 for(const n of [1,2,8,12]){const calls=[],b=new HeartRateBatcher(async samples=>{calls.push(samples);return samples.map(s=>({athleteId:s.athleteId,status:'accepted'}));},()=>100000);const pending=Array.from({length:n},(_,i)=>b.enqueue(frame(i)));await b.flush();await Promise.all(pending);assert.equal(calls.length,1);assert.equal(calls[0].length,n);await b.flush();assert.equal(calls.length,1);b.dispose();}
});
test('Upload queue is bounded, rejects duplicate pending athletes and propagates per-athlete rejection',async()=>{
 const b=new HeartRateBatcher(async samples=>samples.map((s,i)=>({athleteId:s.athleteId,status:i?'accepted':'revoked'})),()=>100000);
 const first=b.enqueue(frame(0));const outcome=first.catch(e=>e.status);await assert.rejects(b.enqueue(frame(0)),e=>e.status===429);
 const rest=Array.from({length:11},(_,i)=>b.enqueue(frame(i+1)));await assert.rejects(b.enqueue(frame(13)),e=>e.status===429);await b.flush();assert.equal(await outcome,403);await Promise.all(rest);b.dispose();
});
test('Slow network keeps one request in flight and drops expired frames rather than replaying old readings',async()=>{
 let finish,calls=0,now=100000;const b=new HeartRateBatcher(samples=>{calls++;return new Promise(resolve=>{finish=()=>resolve(samples.map(s=>({athleteId:s.athleteId,status:'accepted'})));});},()=>now);
 const first=b.enqueue(frame(0)),sent=b.flush();const second=b.enqueue(frame(1)).catch(e=>e.status);await b.flush();assert.equal(calls,1);now=106000;finish();await sent;await first;await b.flush();assert.equal(await second,429);assert.equal(calls,1);b.dispose();
});
test('Network failures and disposal reject promises; no automatic retry or synthetic resend',async()=>{
 let calls=0;const b=new HeartRateBatcher(async()=>{calls++;throw Error('offline');},()=>100000);const rejected=b.enqueue(frame(0)).catch(e=>e.message);await b.flush();assert.match(await rejected,/could not be confirmed/);await b.flush();assert.equal(calls,1);
 const pending=b.enqueue(frame(1)).catch(e=>e.message);b.dispose();assert.equal(await pending,'Upload stopped');await b.flush();assert.equal(calls,1);
});
test('1 Hz reading publication notifies only the changed athlete and removes revoked cached values',async()=>{
 const store=createReadingStore();let a=0,b=0;const offA=store.subscribe('a',()=>a++),offB=store.subscribe('b',()=>b++);
 const row={athleteId:'a',bpm:70,consent:true,sourceId:'s',receivedAt:new Date().toISOString()};store.publish([row]);store.publish([{...row}]);assert.equal(a,1);assert.equal(b,0);store.publish([{...row,bpm:71}]);assert.equal(a,2);assert.equal(b,0);store.publish([]);assert.equal(store.get('a'),undefined);assert.equal(a,3);offA();offB();await settle();
});
test('Delayed chart responses cannot restore erased history after revoke and reconsent',()=>{
 const old={athleteId:'a',consent:true,historyConsent:true,generation:'old',historyVersion:1};
 assert.equal(historyAuthorityMatches(old,{...old}),true);
 for(const changed of [{historyVersion:3},{generation:'new'},{consent:false},{historyConsent:false},{athleteId:'other'}])assert.equal(historyAuthorityMatches(old,{...old,...changed}),false);
 assert.equal(historyAuthorityMatches(undefined,old),false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readCompleteSessionHistory,verifySessionHistory,SessionHistoryError} from '../src/session-history.ts';
import {calculateOverview,calculateTrend} from '../src/analytics-model.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(90000);
const row=n=>({id:id(n),user_id:owner,title:'Custom practice',session_date:'2026-10-31',created_at:'2026-10-31T00:00:00Z',session_type:'training',arrow_count:120,session_rounds:[]});
const envelope=items=>({version:1,complete:true,details:true,owners:[owner],counts:{sessions:items.length,rounds:0,ends:0,arrows:0},items});
for(const n of [0,500,999,1000,1001,1501])test(`scalar snapshot retains all ${n} Sessions with tied timestamps`,async()=>{
 const items=Array.from({length:n},(_,i)=>row(n-i)),value=envelope(items);let calls=0;
 const result=await readCompleteSessionHistory({rpc:async(name,args)=>{calls++;assert.equal(name,'read_complete_session_history_v1');assert.equal(args.p_actor,owner);return {data:value,error:null};}},owner);
 assert.equal(result.length,n);assert.equal(new Set(result.map(r=>r.id)).size,n);assert.equal(calls,1);
});
test('original 1501-to-1000 truncation and missing counts are rejected',()=>{
 const value=envelope(Array.from({length:1000},(_,i)=>row(1000-i)));value.counts.sessions=1501;
 assert.throws(()=>verifySessionHistory(value,owner),SessionHistoryError);
 for(const counts of [null,{},undefined,{sessions:null}])assert.throws(()=>verifySessionHistory({...value,counts},owner),SessionHistoryError);
});
test('original duplicate batch boundary is rejected rather than deduplicated',()=>{
 const value=envelope([row(2),row(2)]);assert.throws(()=>verifySessionHistory(value,owner),SessionHistoryError);
});
test('missing Round, End or Arrow rows and missing arrays are rejected',()=>{
 for(const level of ['rounds','ends','arrows']){const value=envelope([row(1)]);value.counts[level]=1;assert.throws(()=>verifySessionHistory(value,owner));}
 assert.throws(()=>verifySessionHistory(envelope([{...row(1),session_rounds:null}]),owner));
});
test('custom and partially completed Rounds preserve recorded volume and scoring values',()=>{
 const value=envelope([row(1)]);const r={id:id(2),round_number:1,name:'9 × 4',division:'Recurve',distance_metres:30,face_diameter_cm:80,face_type:'full_face',planned_ends:4,arrows_per_end:9,session_ends:[{id:id(3),end_number:1,arrows:[{id:id(4),arrow_number:1,score_points:0,is_x:false,plot_x:null,plot_y:null,face_index:null},{id:id(5),arrow_number:2,score_points:10,is_x:true,plot_x:.1,plot_y:.2,face_index:null}]}]};
 value.items[0].session_rounds=[r];value.counts={sessions:1,rounds:1,ends:1,arrows:2};const actual=verifySessionHistory(value,owner)[0];
 assert.equal(actual.arrow_count,120);assert.equal(actual.session_rounds[0].arrows_per_end,9);
 const round={id:r.id,name:r.name,ends:4,arrowsPerEnd:9,arrows:r.session_ends[0].arrows.map(a=>({score:a.is_x?'X':a.score_points===0?'M':String(a.score_points)}))};
 assert.equal(calculateOverview([{round}]).averagePerArrow,5);assert.equal(calculateOverview([{round}]).bestRound,null);assert.equal(calculateTrend([{round,date:'2026-10-31'}])[0].average,5);
 for(const mutate of [v=>{v.items[0].session_rounds[0].session_ends=null;},v=>{v.items[0].session_rounds[0].session_ends[0].arrows=null;},v=>{v.items[0].session_rounds[0].session_ends[0].arrows[1].id=id(4);},v=>{v.counts.arrows=3;}]){const bad=structuredClone(value);mutate(bad);assert.throws(()=>verifySessionHistory(bad,owner));}
});
test('owner, selected Session, type and deterministic ordering are checked',()=>{
 for(const value of [envelope([{...row(1),user_id:id(80000)}]),envelope([row(1),row(2)]),envelope([{...row(1),arrow_count:null}])])assert.throws(()=>verifySessionHistory(value,owner));
 assert.throws(()=>verifySessionHistory(envelope([row(1)]),owner,{session:id(2)}));
 assert.throws(()=>verifySessionHistory(envelope([row(1)]),owner,{sessionType:'competition'}));
});
test('index is an explicit metadata contract and keeps full navigation order',()=>{
 const items=[row(3),row(2),row(1)].map(s=>{const item={...s};delete item.session_rounds;return item;});const result=verifySessionHistory({...envelope(items),details:false},owner,{details:false});
 assert.deepEqual(result.map(s=>s.id),[id(3),id(2),id(1)]);assert.equal('session_rounds' in result[0],false);
});
test('missing migration, authorization loss, budget and transport failures fail closed',async()=>{
 for(const response of [{data:null,error:{code:'PGRST202'}},{data:null,error:{code:'42501'}},{data:null,error:{code:'54000'}},{data:null,error:null}])await assert.rejects(readCompleteSessionHistory({rpc:async()=>response},owner),SessionHistoryError);
});
test('Coach roster changes between identity and history reads fail explicitly',()=>{
 assert.throws(()=>verifySessionHistory(envelope([row(1)]),id(2),{organization:id(3),allowedOwners:[owner,id(4)]}));
 assert.throws(()=>verifySessionHistory({...envelope([row(1)]),owners:null},owner));
});

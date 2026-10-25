import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import * as model from '../src/counter-model.ts';
const {DEFAULT_COUNTER,addArrows,setIncrement,undoLastAddition,resetCounter,readCounter,lastAdditionDisplay}=model;
test('timestamped additions, reload, selection, Undo and Reset retain exactly the active additions',()=>{
 const first=addArrows(DEFAULT_COUNTER,'2026-10-24T23:59:00.000Z');
 const second=addArrows(setIncrement(first,14),'2026-10-25T00:01:00.000Z');
 assert.equal(second.totalArrows,20);assert.deepEqual(second.history,[{amount:6,addedAt:'2026-10-24T23:59:00.000Z'},{amount:14,addedAt:'2026-10-25T00:01:00.000Z'}]);
 assert.deepEqual(readCounter(JSON.parse(JSON.stringify(second))),second);
 assert.deepEqual(setIncrement(second,3).history,second.history);
 assert.deepEqual(undoLastAddition(second).history,first.history);
 assert.deepEqual(resetCounter(second),{...DEFAULT_COUNTER,increment:14});
 assert.equal(lastAdditionDisplay(resetCounter(second)).time,'No additions yet');
});
test('legacy versions preserve totals, increments and undo amounts without invented dates',()=>{
 assert.equal(readCounter({version:1,totalArrows:72}).totalArrows,72);
 const legacy=readCounter({version:2,totalArrows:100,increment:12,history:[6,12]});
 assert.deepEqual(legacy.history,[{amount:6,addedAt:null},{amount:12,addedAt:null}]);
 assert.equal(lastAdditionDisplay(legacy).time,'Time not recorded');
 assert.equal(undoLastAddition(legacy).totalArrows,88);
 const next=addArrows(legacy,'2026-10-25T05:38:00.000Z');
 assert.deepEqual(undoLastAddition(next),legacy);
});
test('invalid times remain unknown; corrupt structures fail without becoming an empty counter',()=>{
 for(const addedAt of ['not-a-date','2026-02-30T00:00:00.000Z',null,42]){
  const state=readCounter({version:3,totalArrows:6,increment:6,history:[{amount:6,addedAt}]});
  assert.equal(state.history[0].addedAt,null);assert.equal(lastAdditionDisplay(state).time,'Time not recorded');
 }
 for(const value of [null,{}, {version:4,totalArrows:6,increment:6,history:[]},{version:2,totalArrows:1,increment:6,history:[6]}])assert.throws(()=>readCounter(value));
});
test('full date and time use the local timezone across midnight, without relabelling legacy data',()=>{
 const source=new URL('../src/counter-model.ts',import.meta.url).href;
 for(const [tz,day]of [['Asia/Singapore','25 Oct 2026'],['America/Los_Angeles','24 Oct 2026']]){
  const r=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',`import * as m from ${JSON.stringify(source)};console.log(JSON.stringify(m.lastAdditionDisplay(m.addArrows(m.DEFAULT_COUNTER,'2026-10-24T23:30:00.000Z'),'en-GB')));`],{env:{...process.env,TZ:tz},encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.ok(JSON.parse(r.stdout).detail.startsWith(day));
 }
});

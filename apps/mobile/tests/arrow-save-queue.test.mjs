import test from 'node:test';
import assert from 'node:assert/strict';
import {enqueueArrowWrite,waitForRoundWrites} from '../src/arrow-save-queue.ts';
test('navigation retains per-slot FIFO and reopening waits for every old edit, while other owners and Rounds proceed',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),events=[];
 const first=enqueueArrowWrite('owner','round','1:1',async()=>{events.push(1);await gate;});
 const second=enqueueArrowWrite('owner','round','1:1',async()=>{events.push(2)});
 let loaded=false;const reload=waitForRoundWrites('owner','round').then(()=>loaded=true);
 await enqueueArrowWrite('other','round','1:1',async()=>events.push('other'));
 await enqueueArrowWrite('owner','another-round','1:1',async()=>events.push('another'));
 assert.equal(loaded,false);assert.deepEqual(events,[1,'other','another']);
 release();await Promise.all([first,second,reload]);assert.equal(loaded,true);assert.equal(events.at(-1),2);
 await enqueueArrowWrite('owner','round','1:1',async()=>events.push(3));assert.equal(events.at(-1),3);
});
test('a failed queued write does not permanently block a later retry or Round read',async()=>{
 await assert.rejects(enqueueArrowWrite('failure','round','1:1',async()=>{throw Error('offline')}));
 let saved=false;await enqueueArrowWrite('failure','round','1:1',async()=>{saved=true});await waitForRoundWrites('failure','round');assert.equal(saved,true);
});

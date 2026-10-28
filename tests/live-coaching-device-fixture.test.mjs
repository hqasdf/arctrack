import assert from 'node:assert/strict';
import test from 'node:test';
import {seedMonitorDemo,startMonitorDemoPulse} from '../scripts/live-coaching-monitor-demo.mjs';

test('Physical acceptance fixture creates no HR, grants no automatic consent, and cannot run synthetic pulses',async()=>{
 const old=process.env.LIVE_COACHING_DEMO_PHYSICAL;process.env.LIVE_COACHING_DEMO_PHYSICAL='true';
 try{
  const calls=[];const db={query:async(sql)=>{calls.push(sql);return {rows:[{v:{session:{version:1}},id:'local-live'}]};}};
  const id=n=>'b6000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const live=await seedMonitorDemo(db,async(_actor,work)=>work(db),{id,coach:id(1),org:id(5),actors:{a:id(2),b:id(3)},sessions:{}});
  assert.equal(live,'local-live');assert.ok(calls.some(sql=>sql.includes('save_owned_arrow')),'Only scoring fixture data is seeded');
  assert.ok(calls.every(sql=>!/live_hr_command|set_live_hr_history|live_coaching_hr_samples|read_live_athlete_hr/.test(sql)),'No fabricated HR or automatic consent');
  const before=calls.length,stop=startMonitorDemoPulse(db,async(_actor,work)=>work(db),live,id(1));await stop();assert.equal(calls.length,before);
 }finally{if(old===undefined)delete process.env.LIVE_COACHING_DEMO_PHYSICAL;else process.env.LIVE_COACHING_DEMO_PHYSICAL=old;}
});

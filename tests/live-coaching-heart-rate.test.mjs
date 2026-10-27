import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadSessionModule,settle} from './helpers/session-layout-runtime.mjs';
const measurement=loadSessionModule('src/features/live-coaching/heart-rate/measurement.ts');
const {HeartRateSensorManager}=loadSessionModule('src/features/live-coaching/heart-rate/sensor-manager.ts',{'./measurement':measurement});
const panel=loadSessionModule('src/features/live-coaching/heart-rate/panel.tsx',{'./measurement':measurement,'./sensor-manager':{HeartRateSensorManager}});
const view=bytes=>new DataView(Uint8Array.from(bytes).buffer);

test('BLE Heart Rate Measurement parses both standard formats and optional fields',()=>{
 assert.deepEqual(measurement.parseHeartRate(view([0,72])),{bpm:72,contact:null});
 assert.deepEqual(measurement.parseHeartRate(view([1,44,1])),{bpm:300,contact:null});
 assert.deepEqual(measurement.parseHeartRate(view([30,80,10,0,0,4])),{bpm:80,contact:true});
 assert.equal(measurement.parseHeartRate(view([32,80])).bpm,80,'Reserved flag bits do not change supported fields');
});
test('Malformed, truncated, missing-contact and unusable HR values remain unavailable',()=>{
 for(const bytes of [[],[0],[1,80],[0,0],[1,45,1],[4,80],[8,80,1],[16,80],[16,80,1],[0,80,7]])assert.equal(measurement.parseHeartRate(view(bytes)),null,JSON.stringify(bytes));
});
test('Freshness requires current consent, assignment, BPM and a recent reception timestamp',()=>{
 const r={consent:true,sourceId:'sensor',bpm:72,receivedAt:new Date(100000).toISOString()};
 assert.equal(measurement.heartRateFresh(r,109999),true);assert.equal(measurement.heartRateFresh(r,110001),false);
 assert.equal(measurement.heartRateFresh({...r,consent:false},100000),false);assert.equal(measurement.heartRateFresh({...r,bpm:null},100000),false);assert.equal(measurement.heartRateFresh(r,90000),false);
});
test('HR card uses actual fresh values and labels absent or revoked readings as unavailable',()=>{
 const reading={athleteId:'a',consent:true,generation:'g',sourceId:'s',bpm:88,receivedAt:new Date().toISOString()};
 assert.match(renderToStaticMarkup(React.createElement(panel.HeartRateStatus,{reading})),/88 BPM/);
 assert.match(renderToStaticMarkup(React.createElement(panel.HeartRateStatus,{reading:{...reading,consent:false}})),/HR unavailable/);
 assert.doesNotMatch(renderToStaticMarkup(React.createElement(panel.HeartRateStatus,{})),/\d+ BPM/);
});
test('Coach and athlete controls remain separate and consent is unconfirmed until the server answers',()=>{
 const data={session:{id:'live',state:'active'},coach:true,viewerId:'coach',participants:[{athleteId:'a',displayName:'Athlete A',state:'joined'}]};
 const coachHtml=renderToStaticMarkup(React.createElement(panel.HeartRatePanel,{data,onReadings(){}}));
 assert.match(coachHtml,/Athlete for sensor/);assert.match(coachHtml,/Connect sensor/);assert.match(coachHtml,/Apple Watch support requires a relay/);
 const athleteHtml=renderToStaticMarkup(React.createElement(panel.HeartRatePanel,{data:{...data,coach:false,viewerId:'a'},onReadings(){}}));
 assert.match(athleteHtml,/Checking HR consent/);assert.match(athleteHtml,/disabled=""[^>]*>Share HR/);assert.doesNotMatch(athleteHtml,/Connect sensor/);
});
class Characteristic extends EventTarget {
 starts=0;stops=0;
 async startNotifications(){this.starts++;return this;}
 async stopNotifications(){this.stops++;return this;}
 emit(bytes){this.value=view(bytes);this.dispatchEvent(new Event('characteristicvaluechanged'));}
}
function device(id){const d=new EventTarget();d.id=id;d.characteristic=new Characteristic();d.gatt={connected:false,async connect(){this.connected=true;return {async getPrimaryService(service){assert.equal(service,0x180d);return {async getCharacteristic(c){assert.equal(c,0x2a37);return d.characteristic;}};}};},disconnect(){this.connected=false;d.dispatchEvent(new Event('gattserverdisconnected'));}};return d;}
function fixture({authorize,publish,requestDevice}={}){
 const devices=[device('one'),device('two')],samples=[],states=[],released=[];let picks=0,now=100000;
 const manager=new HeartRateSensorManager({bluetooth:{requestDevice:requestDevice??(async options=>{assert.deepEqual(options,{filters:[{services:[0x180d]}]});return devices[picks++];})},authorize:authorize??(async(_id,sourceId)=>({sourceId,generation:'generation'})),publish:publish??(async(...args)=>samples.push(args)),release:async(...args)=>released.push(args),state:s=>states.push(s),now:()=>now});
 return {manager,devices,samples,states,released,advance:ms=>{now+=ms;}};
}
test('Notifications publish actual timestamped samples with bounded frequency and no interpolation',async()=>{
 const f=fixture();await f.manager.connect('a');f.devices[0].characteristic.emit([0,72]);await settle();
 f.devices[0].characteristic.emit([0,90]);await settle();assert.equal(f.samples.length,1);
 f.advance(2000);f.devices[0].characteristic.emit([1,4,1]);await settle();assert.equal(f.samples.length,2);assert.equal(f.samples[1][2].bpm,260);assert.equal(f.samples[1][2].sequence,2);assert.equal(f.samples[1][2].receivedAt,new Date(102000).toISOString());f.manager.dispose();
});
test('Two independent devices stay assigned to their own athletes and duplicate assignment is rejected',async()=>{
 const f=fixture();await f.manager.connect('a');await f.manager.connect('b');f.devices[0].characteristic.emit([0,70]);f.devices[1].characteristic.emit([0,90]);await settle();
 assert.deepEqual(f.samples.map(s=>[s[0],s[2].bpm]),[['a',70],['b',90]]);f.manager.dispose();
 const d=device('same'),g=fixture({requestDevice:async()=>d});await g.manager.connect('a');await g.manager.connect('b');assert.equal(g.states.at(-1).state,'error');assert.equal(d.gatt.connected,true);g.manager.dispose();
});
test('Hardware disconnect, revocation and disposal remove notifications and release server assignments',async()=>{
 const f=fixture();await f.manager.connect('a');await f.manager.connect('b');f.devices[0].gatt.disconnect();await settle();f.devices[0].characteristic.emit([0,80]);assert.equal(f.samples.length,0);
 f.manager.retain(new Set());f.devices[1].characteristic.emit([0,90]);await settle();assert.equal(f.samples.length,0);assert.equal(f.released.length,2);f.manager.dispose();
});
test('Interrupted authorization releases the late lease without starting sensor notifications',async()=>{
 let resolve;const pending=new Promise(r=>{resolve=r;});const f=fixture({authorize:()=>pending});const connecting=f.manager.connect('a');await settle();assert.equal(f.states.at(-1).state,'connecting');f.manager.dispose();resolve({generation:'old',sourceId:'old'});await connecting;await settle();assert.equal(f.devices[0].characteristic.starts,0);assert.equal(f.released.length,1);
});
test('Cancelling a pending chooser prevents a late device from connecting and permits a later retry',async()=>{
 let resolve,picks=0;const choice=new Promise(r=>{resolve=r;}),d=device('cancelled');
 const f=fixture({requestDevice:()=>{picks++;return picks===1?choice:Promise.resolve(d);}});
 const first=f.manager.connect('a');f.manager.disconnect('a');assert.equal(f.states.at(-1).state,'disconnected');await f.manager.connect('a');assert.equal(picks,1);
 resolve(d);await first;assert.equal(d.characteristic.starts,0);await f.manager.connect('a');assert.equal(d.characteristic.starts,1);f.manager.dispose();
});
test('Finishing another connection cannot release ownership of the active browser chooser',async()=>{
 let authorizeA,chooseB,picks=0;const aReady=new Promise(r=>{authorizeA=r;}),bChoice=new Promise(r=>{chooseB=r;});const da=device('a'),db=device('b');
 const f=fixture({requestDevice:()=>{picks++;return picks===1?Promise.resolve(da):bChoice;},authorize:async(id,sourceId)=>id==='a'?aReady:{generation:'g',sourceId}});
 const first=f.manager.connect('a');await settle();const second=f.manager.connect('b');await settle();authorizeA({generation:'g',sourceId:'a'});await first;
 await f.manager.connect('c');assert.equal(picks,2);chooseB(db);await second;f.manager.dispose();
});
test('Failed ingestion stops sharing and a cancelled chooser remains retryable',async()=>{
 const f=fixture({publish:async()=>{throw Error('revoked');}});await f.manager.connect('a');f.devices[0].characteristic.emit([0,80]);await settle();assert.equal(f.states.at(-1).state,'error');assert.equal(f.devices[0].gatt.connected,false);
 let first=true;const d=device('retry'),g=fixture({requestDevice:async()=>{if(first){first=false;throw Error('cancelled');}return d;}});await g.manager.connect('a');await g.manager.connect('a');assert.equal(g.states.at(-1).state,'connected');g.manager.dispose();f.manager.dispose();
});
test('A server rate limit drops only that frame; the next real notification can still be accepted',async()=>{
 let calls=0;const f=fixture({publish:async()=>{if(++calls===1)throw Object.assign(Error('rate'),{status:429});}});
 await f.manager.connect('a');f.devices[0].characteristic.emit([0,80]);await settle();assert.equal(f.devices[0].gatt.connected,true);
 f.advance(2000);f.devices[0].characteristic.emit([0,82]);await settle();assert.equal(calls,2);assert.equal(f.states.at(-1).state,'connected');f.manager.dispose();
});

const id='b1000000-0000-4000-8000-000000000001';
function httpFixture({enabled=true,signedIn=true,error=null}={}){
 const calls=[];const client={auth:{getUser:async()=>({error:null,data:{user:signedIn?{id}:null}})},rpc:async(name,args)=>{calls.push({name,args});return {data:[],error};}};
 const {liveHeartRateRequest}=loadSessionModule('src/features/live-coaching/heart-rate/http.server.ts',{'server-only':{},'@/lib/supabase/server':{createAuthClient:async()=>client},'../http.server':{uuid:value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value)}},undefined,{process:{env:{LIVE_COACHING_BLE_ENABLED:enabled?'true':'false'}}});
 return {calls,request:liveHeartRateRequest};
}
const request=(body,headers={})=>new Request('https://arc.example/api/live-coaching/heart-rate',{method:'POST',headers:{Origin:'https://arc.example','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
test('HR HTTP gate fails closed, authenticates and rejects cross-origin/body identity injection',async()=>{
 const body={action:'consent',liveId:id,athleteId:id};
 assert.equal((await httpFixture({enabled:false}).request(request(body))).status,503);
 assert.equal((await httpFixture({signedIn:false}).request(request(body))).status,401);
 const f=httpFixture();for(const input of [request(body,{Origin:'https://evil.example'}),request({...body,ownerId:'victim'}),request({...body,padding:'x'.repeat(3000)})])assert.ok([400,403,413].includes((await f.request(input)).status));assert.equal(f.calls.length,0);
});
test('HR HTTP sends bounded measurements through the checked RPC and preserves permission rejection',async()=>{
 const body={action:'sample',liveId:id,athleteId:id,generation:id,sourceId:id,bpm:80,sequence:1,receivedAt:new Date().toISOString()};
 const f=httpFixture();assert.equal((await f.request(request(body))).status,200);assert.equal(f.calls[0].name,'live_hr_command');assert.equal(f.calls[0].args.p_bpm,80);assert.equal('actor' in f.calls[0].args,false);
 for(const bad of [{bpm:0},{bpm:301},{sequence:0},{receivedAt:'invalid'}])assert.equal((await f.request(request({...body,...bad}))).status,400);
 assert.equal((await httpFixture({error:{code:'42501'}}).request(request(body))).status,403);
});

test('Monitor GET validates bounded intervals and uses only the checked authorised read',async()=>{
 const f=httpFixture();assert.equal((await f.request(new Request('https://arc.example/api/live-coaching/heart-rate?id='+id+'&window=900&history=true'))).status,200);
 assert.equal(f.calls[0].name,'read_live_monitor');assert.deepEqual(f.calls[0].args,{p_live:id,p_window:900,p_history:true});
 assert.equal((await f.request(new Request('https://arc.example/api/live-coaching/heart-rate?id='+id+'&window=999999'))).status,400);assert.equal(f.calls.length,1);
});
test('Timeline opt-in checks owner, current generation and revision independently of live consent',async()=>{
 const f=httpFixture(),body={action:'history_consent',liveId:id,athleteId:id,generation:id,historyVersion:0};
 assert.equal((await f.request(request(body))).status,200);assert.equal(f.calls[0].name,'set_live_hr_history');assert.equal(f.calls[0].args.p_enabled,true);
 for(const bad of [{athleteId:'b1000000-0000-4000-8000-000000000002'},{generation:null},{historyVersion:-1},{historyVersion:1.5}])assert.equal((await f.request(request({...body,...bad}))).status,400);
 assert.equal((await f.request(request({...body,action:'history_revoke'}))).status,200);assert.equal(f.calls.at(-1).args.p_enabled,false);
});

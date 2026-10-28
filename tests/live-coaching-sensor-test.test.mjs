import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {loadSessionModule,settle,treeNodes,treeText} from './helpers/session-layout-runtime.mjs';
const measurement=loadSessionModule('src/features/live-coaching/heart-rate/measurement.ts');
const {HeartRateSensorManager}=loadSessionModule('src/features/live-coaching/heart-rate/sensor-manager.ts',{'./measurement':measurement});
const registry=loadSessionModule('src/features/live-coaching/heart-rate/tested-device.ts');
class Characteristic extends EventTarget{async startNotifications(){return this;}async stopNotifications(){return this;}emit(bpm){this.value=new DataView(Uint8Array.from([0,bpm]).buffer);this.dispatchEvent(new Event('characteristicvaluechanged'));}}
function device(){const d=new EventTarget();d.id='sensor-local';d.characteristic=new Characteristic();d.gatt={connected:false,async connect(){this.connected=true;return {getPrimaryService:async(service)=>{assert.equal(service,0x180d);return {getCharacteristic:async(char)=>{assert.equal(char,0x2a37);return d.characteristic;}};}};},disconnect(){this.connected=false;}};return d;}
function diagnosticFixture(requestDevice){
 const slots=[],effects=[],listeners=new Map(),timers=new Set(),requests=[];let cursor=0,tree;
 const hooks={...React,useState(init){const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(init){const i=cursor++;return slots[i]??={current:init};},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!deps.every((v,n)=>Object.is(v,slots[i].deps[n]))){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
 const document={visibilityState:'visible',addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 const {SensorTest}=loadSessionModule('src/features/live-coaching/heart-rate/sensor-test.tsx',{'./sensor-manager':{HeartRateSensorManager},'./tested-device':registry},hooks,{document,window:{isSecureContext:true,addEventListener:(n,f)=>listeners.set('window:'+n,f),removeEventListener:n=>listeners.delete('window:'+n)},navigator:{bluetooth:{requestDevice}},fetch:async(...args)=>{requests.push(args);throw Error('Diagnostic must not use network');},setTimeout:fn=>{timers.add(fn);return fn;},clearTimeout:fn=>timers.delete(fn)});
 return {requests,document,listeners,render(){cursor=0;tree=SensorTest({scope:'coach:org'});while(effects.length)effects.shift()();return tree;},text:()=>treeText(tree),click(name){const b=treeNodes(tree).find(n=>n.type==='button'&&treeText(n)===name);assert.ok(b,name);b.props.onClick();},dispose(){for(const s of slots)s?.cleanup?.();}};
}

test('Local sensor test displays actual notifications, disconnects on exit, never uploads and scopes reuse',async()=>{
 const d=device();let picks=0;const ui=diagnosticFixture(async options=>{picks++;assert.deepEqual(options,{filters:[{services:[0x180d]}]});return d;});
 ui.render();ui.click('Test Heart Rate Sensor');ui.render();ui.click('Connect & Test');await settle();await settle();ui.render();assert.match(ui.text(),/Connected.*waiting for a fresh reading/);d.characteristic.emit(83);await settle();ui.render();assert.match(ui.text(),/83 BPM/);assert.equal(ui.requests.length,0);assert.equal(registry.testedDevice('coach:org'),d);assert.equal(registry.testedDevice('other:org'),undefined);
 ui.click('Disconnect');ui.render();assert.equal(d.gatt.connected,false);d.characteristic.emit(91);await settle();ui.render();assert.doesNotMatch(ui.text(),/91 BPM/);ui.click('Retry tested sensor');await settle();await settle();ui.render();assert.equal(picks,1);assert.equal(d.gatt.connected,true);ui.click('Close test');ui.render();assert.equal(d.gatt.connected,false);assert.equal(ui.requests.length,0);ui.dispose();assert.equal(ui.listeners.size,0);
});

test('Picker cancellation and blocked permission are retryable and do not expose provider details',async()=>{
 for(const name of ['NotFoundError','NotAllowedError']){const ui=diagnosticFixture(async()=>{throw Object.assign(Error('private provider detail'),{name});});ui.render();ui.click('Test Heart Rate Sensor');ui.render();ui.click('Connect & Test');await settle();ui.render();assert.match(ui.text(),/Connection failed/);assert.doesNotMatch(ui.text(),/private provider detail/);assert.equal(ui.requests.length,0);ui.dispose();}
});

test('Reusing a tested device still authorizes the athlete before connecting and publishing',async()=>{
 const d=device(),events=[];const manager=new HeartRateSensorManager({bluetooth:{requestDevice:async()=>{throw Error('Unexpected picker');}},authorize:async()=>{events.push('authorize');return {generation:'consent',sourceId:'source'};},publish:async()=>events.push('sample'),release:async()=>{},state:()=>{}});
 await manager.connect('athlete',d);assert.deepEqual(events,['authorize']);d.characteristic.emit(72);await settle();assert.deepEqual(events,['authorize','sample']);manager.dispose();
 const denied=new HeartRateSensorManager({bluetooth:{requestDevice:async()=>d},authorize:async()=>{throw Error('Consent required');},publish:async()=>{throw Error('Unexpected publish');},release:async()=>{},state:()=>{}});await denied.connect('athlete',d);assert.equal(d.gatt.connected,false);denied.dispose();
});

test('Backgrounding, page exit and unmount stop diagnostic notifications without an upload',async()=>{
 const d=device(),ui=diagnosticFixture(async()=>d);ui.render();ui.click('Test Heart Rate Sensor');ui.render();ui.click('Connect & Test');await settle();await settle();ui.render();ui.document.visibilityState='hidden';ui.listeners.get('visibilitychange')();ui.render();assert.equal(d.gatt.connected,false);ui.document.visibilityState='visible';ui.click('Retry tested sensor');await settle();await settle();ui.render();assert.equal(d.gatt.connected,true);ui.listeners.get('window:pagehide')();assert.equal(d.gatt.connected,false);ui.dispose();assert.equal(ui.requests.length,0);assert.equal(ui.listeners.size,0);
});

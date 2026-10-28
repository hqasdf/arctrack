import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {loadSessionModule,settle} from './helpers/session-layout-runtime.mjs';
const measurement=loadSessionModule('src/features/live-coaching/heart-rate/measurement.ts');
const batch=loadSessionModule('src/features/live-coaching/heart-rate/batch.ts');

test('Scoreboard HR requests stay lightweight; detail opts into existing bounded history with cleanup',async()=>{
 for(const historyEnabled of [false,true]){
  const effects=[],calls=[],timers=new Set(),listeners=new Map();
  const hooks={...React,useRef:value=>({current:value}),useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useEffect:fn=>effects.push(fn),useImperativeHandle:()=>{},useSyncExternalStore:(_s,_g,server)=>server()};
  const document={visibilityState:'visible',addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
  const window={addEventListener:(n,f)=>listeners.set('window:'+n,f),removeEventListener:n=>listeners.delete('window:'+n)};
  const {HeartRatePanel}=loadSessionModule('src/features/live-coaching/heart-rate/panel.tsx',{'./measurement':measurement,'./batch':batch,'./sensor-manager':{HeartRateSensorManager:class{}},'./tested-device':{testedDevice:()=>undefined}},hooks,{document,window,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({readings:[],history:[],endActivity:[]})};},setInterval:fn=>{timers.add(fn);return fn;},clearInterval:t=>timers.delete(t)});
  HeartRatePanel({data:{session:{id:'live',state:'active'},coach:true,viewerId:'coach',participants:[]},historyEnabled,onReadings:()=>{},onSnapshot:()=>{}});
  const cleanups=effects.map(fn=>fn());await settle();await settle();
  assert.equal(calls.filter(c=>c.url.includes('history=true')).length,historyEnabled?1:0);
  assert.equal(calls.filter(c=>c.url.includes('history=false')).length,1);
  for(const cleanup of cleanups)cleanup?.();assert.equal(timers.size,0);assert.equal(listeners.size,0);
 }
});

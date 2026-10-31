import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const tick=()=>new Promise(setImmediate);
function runtime(wait,ready){
  let callback,cleanup;const actions=[],alerts=[];
  const dependencies={react:{useRef:value=>({current:value}),useEffect:fn=>{cleanup=fn();}},
    'expo-router':{useNavigation:()=>({dispatch:action=>actions.push(action)})},
    'expo-router/react-navigation':{usePreventRemove:(pending,fn)=>{assert.equal(pending,true);callback=fn;}},
    'react-native':{Alert:{alert:(...args)=>alerts.push(args)}}};
  const source=readFileSync(new URL('../src/device-save-navigation-guard.tsx',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};new Function('require','exports',code)(name=>dependencies[name],exports);
  exports.DeviceSaveNavigationGuard({pending:true,wait,ready});
  return{back:()=>callback({data:{action:{type:'GO_BACK'}}}),actions,alerts,dispose:()=>cleanup()};
}
test('Android Back waits for device durability without requiring an online cloud save',async()=>{
  let resolve;const gate=new Promise(done=>{resolve=done;});let stored=false,calls=0;
  const h=runtime(()=>{calls++;return gate;},()=>stored);h.back();h.back();assert.equal(calls,1);assert.equal(h.actions.length,0);
  stored=true;resolve();await tick();assert.deepEqual(h.actions,[{type:'GO_BACK'}]);assert.equal(h.alerts.length,0);h.dispose();
});
test('failed device writes retain the screen and offer recovery rather than reporting Saved',async()=>{
  const h=runtime(async()=>{},()=>false);h.back();await tick();assert.equal(h.actions.length,0);assert.equal(h.alerts.length,1);
  assert.match(h.alerts[0][1],/not yet safely stored/);h.dispose();
});
test('an account change or screen removal cancels late navigation after a pending device save',async()=>{
  let resolve;const h=runtime(()=>new Promise(done=>{resolve=done;}),()=>true);h.back();h.dispose();resolve();await tick();assert.equal(h.actions.length,0);assert.equal(h.alerts.length,0);
});

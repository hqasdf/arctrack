import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import React from 'react';
import ts from 'typescript';

const require=createRequire(import.meta.url);
function load(path,dependencies){
  const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};new Function('require','exports',compiled)(name=>name in dependencies?dependencies[name]:require(name),exports);
  return exports;
}

test('feedback history is absent initially and retains the same child across collapse/reopen',()=>{
  let loaded=false;
  const panel=()=>null;
  const {SessionFeedbackHistory}=load('src/features/sessions/components/session-feedback-history.tsx',{
    react:{...React,useState:()=>[loaded,value=>{loaded=value;}]},
    '@/features/notes-feedback/coach-feedback-panel':{CoachFeedbackPanel:panel},
  });
  const render=()=>SessionFeedbackHistory({viewerId:'owner'});
  const child=tree=>tree.props.children.find(node=>node?.type===panel);
  let tree=render();assert.equal(child(tree),undefined);
  tree.props.onToggle({currentTarget:{open:false}});assert.equal(child(render()),undefined);
  tree.props.onToggle({currentTarget:{open:true}});tree=render();const first=child(tree);
  assert.equal(first.props.context.viewerId,'owner');assert.equal(first.props.history,true);
  tree.props.onToggle({currentTarget:{open:false}});const collapsed=child(render());
  assert.equal(collapsed.type,first.type);assert.equal(collapsed.key,first.key);
  tree.props.onToggle({currentTarget:{open:true}});assert.equal(child(render()).type,first.type);
  // Neither closing nor reopening removes the editor, so its effects/drafts stay mounted.
  const workspace=readFileSync(new URL('../src/features/sessions/components/sessions-workspace.tsx',import.meta.url),'utf8');
  assert.match(workspace,/<SessionFeedbackHistory key=\{viewerId\} viewerId=\{viewerId\}/);
});

// Use React's real server cache implementation with isolated request dispatchers.
// This models RSC request boundaries; it does not claim a hosted browser/auth test.
const serverReact=require(join(dirname(require.resolve('react/package.json')),'react.react-server.js'));
const internals=serverReact.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
async function request(action){
  const previous=internals.A,values=new Map();
  internals.A={getCacheForType(factory){if(!values.has(factory))values.set(factory,factory());return values.get(factory);}};
  try{return await action();}finally{internals.A=previous;}
}
function memberships(){
  let actor='one',active=true,queries=0,identities=0,codes=0,fail=false;
  const reader=load('src/features/organizations/read.server.ts',{
    'server-only':{},react:serverReact,
    '@/lib/auth/session.server':{requireUser:async()=>{identities++;return{id:actor};}},
    '@/lib/supabase/server':{createAuthClient:async()=>({from(){queries++;let owner;const query={select(){return query;},eq(key,value){if(key==='user_id')owner=value;return query;},then(resolve){return Promise.resolve({error:fail?{}:null,data:active?[{organization_id:owner,role:'head_coach',organizations:{id:owner,name:'Org '+owner}}]:[]}).then(resolve);}};return query;},rpc:async()=>{codes++;return{data:'authorized-code',error:null};}})},
  }).readOwnOrganizations;
  return{reader,setActor:value=>{actor=value;},revoke:()=>{active=false;},fail:value=>{fail=value;},counts:()=>({queries,identities,codes})};
}
test('identical organization reads share one authenticated query per request, including omitted/false arguments',async()=>{
  const h=memberships();
  await request(async()=>{
    const first=h.reader();assert.equal(first,h.reader(false));
    const [a,b]=await Promise.all([first,h.reader()]);assert.deepEqual(a,b);
    assert.equal(a[0].joinCode,null);assert.deepEqual(h.counts(),{queries:1,identities:1,codes:0});
    const withCodes=await h.reader(true);assert.equal(withCodes[0].joinCode,'authorized-code');
    await h.reader(true);assert.deepEqual(h.counts(),{queries:2,identities:2,codes:1});
  });
});
test('a later request rechecks membership revocation and never serves another user from cache',async()=>{
  const h=memberships();
  await request(async()=>assert.equal((await h.reader())[0].id,'one'));
  h.setActor('two');await request(async()=>assert.equal((await h.reader())[0].id,'two'));
  h.revoke();await request(async()=>assert.deepEqual(await h.reader(),[]));
  assert.equal(h.counts().queries,3);assert.equal(h.counts().identities,3);
});
test('failed membership queries fail closed and can recover in a new request',async()=>{
  const h=memberships();h.fail(true);
  await request(async()=>{await assert.rejects(h.reader(),/could not be loaded/);await assert.rejects(h.reader(),/could not be loaded/);});
  assert.equal(h.counts().queries,1);
  h.fail(false);await request(async()=>assert.equal((await h.reader()).length,1));assert.equal(h.counts().queries,2);
});

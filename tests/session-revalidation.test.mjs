import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingNavigationRuntime } from './helpers/training-navigation-runtime.mjs';
import { loadSessionModule } from './helpers/session-layout-runtime.mjs';
const tick=()=>new Promise(setImmediate);

test('fresh training navigation avoids reads; stale focus deduplicates a full selected-Session refresh',async()=>{
  let resolve;const h=trainingNavigationRuntime({read:()=>new Promise(done=>{resolve=done;})});h.render();h.render();
  h.advance(59000);assert.equal(h.requests.length,0);h.advance(2000);h.advance(1000);assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].url,'/api/sessions/one');const key=h.scoring().key;
  resolve({ok:true,status:200,json:async()=>({session:h.initialSessions[0]})});await tick();h.render();assert.equal(h.scoring().key,key);h.dispose();
});
test('an edit during revalidation invalidates the old response, including deletes with no visible Arrow',async()=>{
  let resolve;const h=trainingNavigationRuntime({read:()=>new Promise(done=>{resolve=done;})});h.render();h.render();h.advance(61000);
  h.scoring().props.onPendingChange(true);h.scoring().props.onChange(round=>({...round,arrows:round.arrows.slice(1)}));h.render();
  resolve({ok:true,status:200,json:async()=>({session:h.initialSessions[0]})});await tick();h.render();assert.equal(h.scoring().props.round.arrows.length,71);
  h.advance(61000);assert.equal(h.requests.length,1);h.dispose();
});
test('authoritative external changes refresh every Round only when no local intentions are pending',async()=>{
  let h;h=trainingNavigationRuntime({read:async()=>{const session=structuredClone(h.initialSessions[0]);session.rounds[0].arrows[0].score='X';return{ok:true,status:200,json:async()=>({session})};}});
  h.render();h.render();const key=h.scoring().key;h.advance(61000);await tick();h.render();assert.notEqual(h.scoring().key,key);assert.equal(h.scoring().props.round.arrows[0].score,'X');
  h.scoring().props.onBack();h.render();assert.equal(h.nodes().filter(n=>n.type==='button'&&n.props.children==='Open').length,5);h.dispose();
});
test('temporary failures retain loaded data; lost authentication hides protected Sessions without erasing device records',async()=>{
  const h=trainingNavigationRuntime({read:async()=>({ok:false,status:503,json:async()=>({})})});h.render();h.render();h.advance(61000);await tick();h.render();assert.equal(h.scoring().props.round.arrows.length,72);h.dispose();
  const denied=trainingNavigationRuntime({read:async()=>({ok:false,status:401})});denied.render();denied.render();denied.advance(61000);await tick();denied.render();assert.equal(denied.scoring(),undefined);denied.dispose();
});
test('the selected Session read endpoint rejects unauthenticated requests before accessing scoring data',async()=>{
  let reads=0;
  const {GET}=loadSessionModule('src/app/api/sessions/[sessionId]/route.ts',{
    '@/lib/auth/session.server':{readIdentity:async()=>({user:null,unavailable:false})},'@/features/sessions/validation':{isUuid:()=>true},
    '@/features/sessions/read.server':{readOwnedSession:async()=>{reads++;}},
  });
  const response=await GET(new Request('https://arc.example/api/sessions/test'),{params:Promise.resolve({sessionId:'test'})});assert.equal(response.status,401);assert.equal(reads,0);assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('selected Session reads filter by the verified owner and retain the existing complete Round contract',async()=>{
  const filters=[];let select='';
  const query={select(value){select=value;return query;},eq(name,value){filters.push([name,value]);return query;},maybeSingle:async()=>({data:null,error:null})};
  const {readOwnedSession}=loadSessionModule('src/features/sessions/read.server.ts',{
    'server-only':{},'@/lib/auth/session.server':{requireUser:async()=>({id:'verified-owner'})},
    '@/lib/supabase/server':{createAuthClient:async()=>({from:table=>{assert.equal(table,'sessions');return query;}})},
  });
  assert.equal(await readOwnedSession('selected-session'),null);assert.deepEqual(filters,[['user_id','verified-owner'],['id','selected-session']]);
  assert.match(select,/session_rounds/);assert.match(select,/session_ends/);assert.match(select,/plot_x,plot_y,face_index/);
});

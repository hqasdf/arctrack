import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createIngress, GarminIngressLimits } from '../infra/garmin-ingress/worker.mjs';
import hostedTestWorker, { SyntheticUpstream } from '../infra/garmin-ingress/test-worker.mjs';

const require = createRequire(import.meta.url);
async function load(path, dependencies) {
  const code = ts.transpileModule(await readFile(new URL('../'+path, import.meta.url),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports={}; new Function('require','exports',code)(name => {
    if(name==='server-only')return {}; if(name in dependencies)return dependencies[name];
    if(name.startsWith('node:'))return require(name); throw Error('Unexpected isolated import');
  },exports);return exports;
}
function quota() {
  const data=new Map();let tail=Promise.resolve();
  const storage={transaction(work){const next=tail.then(()=>work({get:async key=>structuredClone(data.get(key)),put:async(key,value)=>data.set(key,structuredClone(value))}));tail=next.catch(()=>{});return next;}};
  const object=new GarminIngressLimits({storage});
  return {data,storage,binding:{idFromName:id=>id,get:()=>({fetch:(url,init)=>object.fetch(new Request(url,init))})}};
}
function fixture(fetcher=async()=>new Response(null,{status:200})) {
  const limits=quota(), env={INGRESS_ENABLED:'true',GARMIN_ENDPOINT_SECRET:randomBytes(32).toString('hex'),GARMIN_FORWARD_KEY:randomBytes(32).toString('hex'),LIMITS:limits.binding};
  const send=createIngress({fetcher});
  const request=(body='{"dailies":[]}',path='/garmin/'+env.GARMIN_ENDPOINT_SECRET,headers={})=>new Request('https://ingress.example'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
  return {env,send,request,limits};
}
test('private ingress strips all caller metadata and only forwards to the fixed authenticated path',async()=>{
  let received;const f=fixture(async(url,init)=>{received={url,init};return new Response('must not escape',{status:200});});
  const r=await f.send(f.request('{"dailies":[]}',undefined,{Authorization:'attacker',Cookie:'private','X-Original-URL':'/sensitive','Referer':'https://secret.example','traceparent':'untrusted'}),f.env);
  assert.equal(r.status,200);assert.equal(await r.text(),'');
  assert.equal(received.url,'https://archery-website.vercel.app/api/internal/garmin-health/ingest');
  assert.deepEqual(Object.keys(received.init.headers).sort(),['Authorization','Content-Type']);
  assert.equal(received.init.headers.Authorization,'Bearer '+f.env.GARMIN_FORWARD_KEY);
  assert.equal(received.init.redirect,'manual');assert.ok(!JSON.stringify(received).includes(f.env.GARMIN_ENDPOINT_SECRET));
});
test('wrong, missing, query-string, HTTP and rotated capabilities fail before forwarding',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;return new Response();});
  for(const path of ['/garmin/wrong','/garmin','/garmin/'+f.env.GARMIN_ENDPOINT_SECRET+'?x=1'])assert.equal((await f.send(f.request('{}',path),f.env)).status,401);
  const old=f.request();f.env.GARMIN_ENDPOINT_SECRET=randomBytes(32).toString('hex');assert.equal((await f.send(old,f.env)).status,401);
  assert.equal((await f.send(new Request('http://ingress.example/garmin/'+f.env.GARMIN_ENDPOINT_SECRET,{method:'POST',body:'{}'}),f.env)).status,401);assert.equal(calls,0);
});
test('disabled, missing quota or reused credentials remain fail-closed',async()=>{
  const f=fixture();for(const patch of [{INGRESS_ENABLED:'false'},{LIMITS:null},{GARMIN_FORWARD_KEY:f.env.GARMIN_ENDPOINT_SECRET},{GARMIN_FORWARD_KEY:''}])assert.equal((await f.send(f.request(),{...f.env,...patch})).status,503);
});
test('malformed, oversized and compressed requests are rejected before forwarding',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;return new Response();});
  for(const [body,headers,status] of [['bad',{},400],['{}',{'Content-Encoding':'gzip'},415],['{}',{'Content-Length':'1048577'},413],['x'.repeat(1048577),{},413]])assert.equal((await f.send(f.request(body,undefined,headers),f.env)).status,status);
  assert.equal(calls,0);
});
test('upstream failure, timeout and redirect never become false acknowledgments or leak URLs',async()=>{
  for(const status of [302,500,503]){const f=fixture(async()=>new Response('private body',{status,headers:{Location:'https://untrusted.example'}}));assert.equal((await f.send(f.request(),f.env)).status,503);}
  const f=fixture(async()=>{throw Error('secret-bearing diagnostic must not escape');});const r=await f.send(f.request(),f.env);assert.equal(r.status,503);assert.equal(await r.text(),'');
});

test('admission success and retryable failure propagate through Cloudflare without becoming false 200s',async()=>{
  for(const [downstream,expected] of [[200,200],[503,503],[429,429]]){
    const f=fixture(async()=>new Response('must remain private',{status:downstream}));
    const result=await f.send(f.request(),f.env);
    assert.equal(result.status,expected);assert.equal(await result.text(),'');
  }
});
test('globally shared transactional quota bounds concurrent ingress replicas and minute volume',async()=>{
  const f=fixture();let complete;const gate=new Promise(r=>complete=r);const send=createIngress({fetcher:async()=>{await gate;return new Response(null,{status:200});}});
  const first=Array.from({length:4},()=>send(f.request(),f.env));
  // Each reserve is committed under the same storage transaction across instances.
  while(Object.keys(f.limits.data.get('quota')?.leases??{}).length<4)await new Promise(r=>setImmediate(r));
  assert.equal((await send(f.request(),f.env)).status,429);complete();await Promise.all(first);
  assert.equal(Object.keys(f.limits.data.get('quota').leases).length,0);
  for(let i=0;i<26;i++)assert.equal((await f.send(f.request(),f.env)).status,200);
  assert.equal((await f.send(f.request(),f.env)).status,429);
});
test('quota survives object restart and expired slots recover without a process-local counter',async()=>{
  const f=quota();const original=Date.now;let clock=original();Date.now=()=>clock;
  try{for(let i=0;i<4;i++)assert.equal((await f.binding.get('a').fetch('https://limits/reserve',{method:'POST'})).status,200);
    const restarted=new GarminIngressLimits({storage:f.storage});
    assert.equal((await restarted.fetch(new Request('https://limits/reserve',{method:'POST'}))).status,429);clock+=46000;
    assert.equal((await restarted.fetch(new Request('https://limits/reserve',{method:'POST'}))).status,200);
  }finally{Date.now=original;}
});
test('body deadline releases its slot without forwarding a stalled stream',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});let calls=0;
  const f=fixture(async()=>{calls++;return new Response();});
  const pending=f.send(new Request('https://ingress.example/garmin/'+f.env.GARMIN_ENDPOINT_SECRET,{
    method:'POST',headers:{'Content-Type':'application/json'},body:new ReadableStream({}),duplex:'half'}),f.env);
  while(Object.keys(f.limits.data.get('quota')?.leases??{}).length<1)await new Promise(r=>setImmediate(r));
  // Allow body acquisition to install the timer after the reservation commits.
  await new Promise(r=>setImmediate(r));context.mock.timers.tick(10001);
  assert.equal((await pending).status,408);assert.equal(calls,0);
  assert.equal(Object.keys(f.limits.data.get('quota').leases).length,0);
});
test('the shared unauthenticated attempt budget also applies across instances',async()=>{
  const f=quota();for(let i=0;i<600;i++)assert.equal((await f.binding.get('a').fetch('https://limits/attempt',{method:'POST'})).status,204);
  assert.equal((await f.binding.get('b').fetch('https://limits/attempt',{method:'POST'})).status,429);
});
test('approved production ingress keeps routing and activation explicit without URL-bearing routine observability',async()=>{
  const c=JSON.parse(await readFile(new URL('../infra/garmin-ingress/wrangler.jsonc',import.meta.url),'utf8'));
  assert.equal(c.observability.logs.invocation_logs,false);assert.equal(c.observability.traces.enabled,false);assert.equal(c.observability.enabled,false);
  assert.deepEqual(c.tail_consumers,[]);assert.equal(c.logpush,false);assert.equal(c.vars.INGRESS_ENABLED,'true');assert.equal(c.workers_dev,true);assert.equal(c.preview_urls,false);
  assert.equal(c.name,'arctrack-garmin-ingress');assert.equal(c.main,'worker.mjs');
});
test('application configuration requires independent keys, explicit readiness without a pilot cohort',async()=>{
  const env={};const c=await load('src/features/garmin/health/config.server.ts',{});
  const saved={...process.env};try{
    for(const key of ['GARMIN_HEALTH_ENABLED','GARMIN_HEALTH_INGRESS_READY','GARMIN_HEALTH_PRIVACY_READY','GARMIN_HEALTH_INGRESS_KEY','GARMIN_HEALTH_TEST_USER_IDS','CRON_SECRET'])delete process.env[key];
    assert.equal(c.garminHealthEnabled(),false);
    Object.assign(env,{GARMIN_HEALTH_ENABLED:'true',GARMIN_HEALTH_INGRESS_READY:'true',GARMIN_HEALTH_PRIVACY_READY:'true',GARMIN_HEALTH_INGRESS_KEY:randomBytes(32).toString('hex'),CRON_SECRET:randomBytes(32).toString('hex'),GARMIN_HEALTH_TEST_USER_IDS:'11111111-1111-4111-8111-111111111111'});Object.assign(process.env,env);
    assert.equal(c.garminHealthEnabled(),true);process.env.GARMIN_HEALTH_PRIVACY_READY='false';assert.equal(c.garminHealthEnabled(),false);process.env.GARMIN_HEALTH_PRIVACY_READY='true';process.env.GARMIN_HEALTH_TEST_USER_IDS='*';assert.equal(c.garminHealthEnabled(),true);delete process.env.GARMIN_HEALTH_TEST_USER_IDS;assert.equal(c.garminHealthEnabled(),true);
  }finally{for(const key of Object.keys(env)){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
});

test('invalid capability floods cannot exhaust the valid delivery quota',async()=>{
  const valid=quota(),rejected=quota();const f=fixture();
  f.env.LIMITS={idFromName:id=>id,get:id=>(id==='garmin-global-v1'?valid:rejected).binding.get(id)};
  for(let i=0;i<601;i++)await f.send(f.request('{}','/garmin/wrong'),f.env);
  assert.equal((await f.send(f.request(),f.env)).status,200);
  assert.equal(valid.data.get('quota').accepted,1);
});

test('hosted harness cannot forward to production and requires explicit synthetic mode',async()=>{
  const f=fixture();let target;
  const env={...f.env,TEST_MODE:'synthetic-only',TEST_UPSTREAM:{idFromName:id=>id,get:()=>({fetch:async(url)=>{target=url;return new Response(null,{status:200});}})}};
  assert.equal((await hostedTestWorker.fetch(f.request(),{...env,TEST_MODE:undefined})).status,503);
  assert.equal(target,undefined);
  assert.equal((await hostedTestWorker.fetch(f.request(),env)).status,200);
  assert.equal(target,'https://synthetic-upstream.invalid/api/internal/garmin-health/ingest');
  assert.equal((await hostedTestWorker.fetch(new Request('https://ingress.example/__test/control',{method:'POST',body:'{}'}),env)).status,401);
});

test('hosted synthetic upstream rejects real account payloads before storing receipts',async()=>{
  const data=new Map(),env={GARMIN_FORWARD_KEY:randomBytes(32).toString('hex'),GARMIN_ENDPOINT_SECRET:randomBytes(32).toString('hex')};
  const storage={get:async key=>data.get(key),put:async(key,value)=>data.set(key,value),transaction:async work=>work(storage)};
  const upstream=new SyntheticUpstream({storage},env);
  const request=userId=>new Request('https://synthetic-upstream.invalid/api/internal/garmin-health/ingest',{method:'POST',headers:{Authorization:'Bearer '+env.GARMIN_FORWARD_KEY},body:JSON.stringify({dailies:[{userId}]})});
  assert.equal((await upstream.fetch(request('not-a-synthetic-account'))).status,400);
  assert.equal(data.size,0);
  assert.equal((await upstream.fetch(request('synthetic-cloudflare-test'))).status,200);
  assert.equal(data.get('state').receipts.length,1);
  assert.equal(data.get('state').privateUrlSeen,false);
});

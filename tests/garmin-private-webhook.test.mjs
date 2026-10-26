import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const source=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
async function load(path,deps={},globals={}){
 const code=ts.transpileModule(await source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('require','exports',...Object.keys(globals),code)(name=>{
  if(name in deps)return deps[name];if(name==='server-only')return {};if(name.startsWith('node:'))return require(name);throw new Error('Unexpected private receiver dependency');
 },exports,...Object.values(globals));return exports;
}
const model=await load('src/features/health/model.ts');
const normalize=await load('src/features/garmin/health/normalize.server.ts',{'@/features/health/model':model});
const store={'createGarminHealthInbox':()=>{throw Error('No production database allowed');}};
const config={garminHealthEnabled:()=>false,garminHealthTestUsers:()=>[]};
const http=await load('src/features/garmin/health/http.server.ts',{'next/server':{after:()=>{}},'./config.server':config,'./normalize.server':normalize,'../service.server':{configuredGarminService:()=>null},'./store.server':store});
const privateHttp=await load('src/features/garmin/health/private-push.server.ts',{'next/server':{after:()=>{}},'./config.server':config,'./store.server':store,'./http.server':http});
const payload={dailies:[{userId:'synthetic-provider',summaryId:'synthetic',calendarDate:'2026-10-23',startTimeInSeconds:1792713600,durationInSeconds:86400,steps:450}]};
const request=(body=JSON.stringify(payload),headers={})=>new Request('https://example.invalid/private-synthetic-request',{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
const fixture=(overrides={})=>{
 const secret=randomBytes(32).toString('hex'),calls=[],scheduled=[];
 const handle=privateHttp.createPrivateGarminPushReceiver({enabled:true,secret,inbox:()=>({stage:async(...args)=>{calls.push(args);return {status:'accepted',accepted:args[0].length,duplicate:0,ineligible:0};},process:async()=>1}),schedule:work=>scheduled.push(work),...overrides});
 return {secret,calls,handle,scheduled};
};
test('private capability accepts 256-bit server secret and preserves normalization/stage-before-ack',async()=>{
 const f=fixture();const result=await f.handle(request(),f.secret);
 assert.equal(result.status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0][0].values.steps,450);assert.equal(f.scheduled.length,1);
 assert.equal(await result.text(),'');assert.equal(result.headers.get('referrer-policy'),'no-referrer');
});
test('missing, malformed, wrong and case-changed secrets reject before reading any body',async()=>{
 const f=fixture();for(const candidate of [undefined,'',randomBytes(32).toString('hex'),f.secret.toUpperCase(),f.secret+'x',f.secret+'\n',f.secret+'\r\n']){
  const req=request();const result=await f.handle(req,candidate);assert.equal(result.status,401);assert.equal(req.bodyUsed,false);assert.equal(await result.text(),'');
 }assert.equal(f.calls.length,0);
});
test('private URL preserves media, encoding, payload and byte limits',async()=>{
 // Session HR intentionally raised the shared Cloudflare/Vercel Push bound to 4 MiB.
 const overLimit=4*1024*1024+1;
 const f=fixture();for(const [req,status] of [[request('{'),400],[request('{}'),400],[request(undefined,{'Content-Type':'text/plain'}),415],[request(undefined,{'Content-Encoding':'gzip'}),415],[request(undefined,{'Content-Length':String(overLimit)}),413],[request('x'.repeat(overLimit)),413]])assert.equal((await f.handle(req,f.secret)).status,status);
 assert.equal(f.calls.length,0);
});

test('private receiver accepts a valid bounded payload at the current 4 MiB boundary',async()=>{
 const f=fixture(),body=JSON.stringify(payload).padEnd(4*1024*1024,' ');
 assert.equal((await f.handle(request(body),f.secret)).status,200);
 assert.equal(f.calls.length,1);
});
test('missing server key, disabled master switch always fail closed',async()=>{
 for(const overrides of [{secret:undefined},{secret:'weak'},{enabled:false}]){
  const f=fixture(overrides),req=request();assert.equal((await f.handle(req,f.secret)).status,503);assert.equal(req.bodyUsed,false);assert.equal(f.calls.length,0);
 }
});
test('configured private and original public handlers cannot activate ingestion or bypass provider verification',async()=>{
 const req=request();assert.equal((await privateHttp.privateGarminHealthPush(req,randomBytes(32).toString('hex'))).status,503);
 assert.equal((await http.garminHealthPush(request())).status,503);assert.equal(http.configuredGarminNotificationVerifier(),null);
});
test('production private path remains blocked even with valid key, enabled flag and approved users',async()=>{
 const secret=randomBytes(32).toString('hex');
 const production=await load('src/features/garmin/health/private-push.server.ts',{
  'next/server':{after:()=>{}},'./config.server':{garminHealthEnabled:()=>true,garminHealthTestUsers:()=>['synthetic-owner']},
  './store.server':store,'./http.server':{createGarminPushReceiver:()=>{throw Error('Must not initialize production path ingestion');}},
 },{process:{env:{NODE_ENV:'production',GARMIN_HEALTH_WEBHOOK_SECRET:secret}}});
 const req=request();assert.equal((await production.privateGarminHealthPush(req,secret)).status,503);assert.equal(req.bodyUsed,false);
});
test('rotating the configured secret rejects the old capability without losing the inbox contract',async()=>{
 const first=fixture(),nextSecret=randomBytes(32).toString('hex'),rotated=fixture({secret:nextSecret});
 assert.equal((await rotated.handle(request(),first.secret)).status,401);
 assert.equal((await rotated.handle(request(),nextSecret)).status,200);
 assert.equal(rotated.calls.length,1);
});
test('dynamic route awaits only its secret path param; environment and error bodies remain server-only',async()=>{
 let captured;
 const route=await load('src/app/api/integrations/garmin/health/push/[secret]/route.ts',{'@/features/garmin/health/private-push.server':{privateGarminHealthPush:async(_req,secret)=>{captured=secret;return new Response(null,{status:503});}}});
 const key=randomBytes(32).toString('hex');await route.POST(request(),{params:Promise.resolve({secret:key})});assert.equal(captured,key);
 const code=await source('src/features/garmin/health/private-push.server.ts');assert.match(code,/^import "server-only"/);assert.match(code,/timingSafeEqual/);assert.doesNotMatch(code,/console\.|NEXT_PUBLIC_|request\.url/);
});

/** Explicitly authorized isolated hosted tests. No .env, production data or tokens are read. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const config='infra/garmin-ingress/wrangler.test.jsonc';
const expectedName='arc-track-garmin-ingress-test';
const origin=process.env.GARMIN_TEST_WORKER_ORIGIN;
const cli=process.env.WRANGLER_CLI;
if(!origin||!/^https:\/\/arc-track-garmin-ingress-test\.[a-z0-9-]+\.workers\.dev$/.test(origin)||!cli)throw Error('Explicit isolated Worker origin and Wrangler CLI required');
if(JSON.parse(await readFile(config,'utf8')).name!==expectedName)throw Error('Unexpected test config');
const env={...process.env,CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_SANITIZE:'true',WRANGLER_WRITE_LOGS:'false'};
const secrets={GARMIN_ENDPOINT_SECRET:randomBytes(32).toString('hex'),GARMIN_FORWARD_KEY:randomBytes(32).toString('hex'),TEST_CONTROL_KEY:randomBytes(32).toString('hex')};
const results=[];
function check(pass,name,detail={}){results.push({name,pass,...detail});console.log(`${pass?'PASS':'FAIL'} ${name}`);}
async function wrangler(args,input){
  return new Promise((accept,reject)=>{
    const p=spawn(process.execPath,[cli,...args],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';
    p.stdout.on('data',b=>output+=b.toString());p.stderr.on('data',b=>output+=b.toString());
    p.stdin.end(input);p.on('exit',code=>{
      if(code===0)return accept(output);
      const safe=output.replace(/\x1b\[[0-9;]*m/g,'').replace(/[a-f0-9]{64}/g,'[redacted]').split('\n').filter(line=>!/token|secret|https?:\/\//i.test(line)).slice(-18).join('\n');
      console.log('Sanitized Wrangler diagnostic: '+safe);reject(Error('Wrangler test operation failed'));
    });
  });
}
async function request(path,init={}){try{return await fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(40000),...init});}catch{throw Error('Isolated hosted request failed; URL withheld');}}
const payload={dailies:[{userId:'synthetic-cloudflare-test',summaryId:'hosted-synthetic',calendarDate:'2026-10-24',steps:450}]};
const send=(secret=secrets.GARMIN_ENDPOINT_SECRET,body=JSON.stringify(payload),headers={})=>request('/garmin/'+secret,{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
async function control(action,extra={}){
  const r=await request('/__test/control',{method:'POST',headers:{Authorization:'Bearer '+secrets.TEST_CONTROL_KEY,'Content-Type':'application/json'},body:JSON.stringify({action,...extra})});
  if(!r.ok)throw Error(`Isolated control failed: ${r.status} ${r.headers.get('x-arc-test-stage')??'no-stage'}`);return action==='status'?r.json():null;
}
async function reset(){await control('reset');await control('resetQuota');}
try{
  await wrangler(['secret','bulk','--config',config],JSON.stringify(secrets));
  console.log('Test-only credentials uploaded through Cloudflare secret storage; values withheld.');
  await wrangler(['deploy','--config',config,'--durable-objects-code-update-mode','immediate']);
  let ready=false;
  for(let i=0;i<30;i++){try{await reset();ready=true;break;}catch(error){
    if(i===0)console.log(/^Isolated control failed: \d{3} [a-z-]+$/.test(error.message)?error.message:'Isolated control not ready');
    await new Promise(r=>setTimeout(r,1000));
  }}
  if(!ready)throw Error('Isolated deployment did not become ready');
  await reset();
  check((await request('/garmin',{method:'POST',body:'{}'})).status===401,'missing capability rejected');
  check((await send('0'.repeat(64))).status===401,'incorrect capability rejected');
  check((await send()).status===200,'correct capability and durable synthetic receipt acknowledged');
  check((await send()).status===200,'duplicate delivery acknowledged safely');
  let state=await control('status');check(state.receipts.length===1,'hosted durable synthetic deduplication');
  check(state.fixedPath===true&&state.privateUrlSeen===false,'private URL never reaches the upstream');
  await send(undefined,undefined,{Cookie:'harmless-canary','X-Original-URL':'harmless-canary',traceparent:'harmless-canary',Referer:'https://canary.invalid'});
  state=await control('status');check(!state.unexpectedHeaders.some(x=>['cookie','x-original-url','traceparent','referer'].includes(x)),'untrusted metadata stripped');
  check((await send(undefined,'not-json')).status===400,'invalid JSON rejected');
  check((await send(undefined,'x'.repeat(1048577))).status===413,'oversized streamed request rejected');
  check((await send(undefined,JSON.stringify({dailies:[{userId:'not-a-synthetic-account'}]}))).status===400,'test upstream refuses non-synthetic account data');
  await reset();await control('mode',{mode:'unavailable'});check((await send()).status===503,'upstream unavailable never becomes success');
  await control('mode',{mode:'redirect'});check((await send()).status===503,'upstream redirects are not followed');
  await reset();await control('mode',{mode:'slow'});
  const concurrent=await Promise.all(Array.from({length:6},()=>send().then(r=>r.status)));
  check(concurrent.filter(x=>x===200).length<=4&&concurrent.includes(429),'hosted shared concurrency limit',{statuses:concurrent});
  await reset();
  const burst=[];for(let i=0;i<31;i++)burst.push((await send()).status);
  check(burst.slice(0,30).every(x=>x===200)&&burst[30]===429,'hosted durable per-minute delivery limit',{accepted:burst.filter(x=>x===200).length,lastStatus:burst.at(-1)});
  await reset();await control('mode',{mode:'timeout'});const started=Date.now();const timed=await send();
  check(timed.status===503&&Date.now()-started>=19000,'upstream timeout never becomes a false acknowledgment',{status:timed.status,elapsedMs:Date.now()-started});
  await reset();
  await wrangler(['deploy','--config',config,'--var','INGRESS_ENABLED:false','--durable-objects-code-update-mode','immediate']);
  let disabled=false;
  for(let i=0;i<15;i++){if((await send()).status===503){disabled=true;break;}await new Promise(r=>setTimeout(r,1000));}
  check(disabled,'ingress disabled before test-secret rotation');
  if(!disabled)throw Error('Rotation stopped because ingress is not disabled');
  const old=secrets.GARMIN_ENDPOINT_SECRET;secrets.GARMIN_ENDPOINT_SECRET=randomBytes(32).toString('hex');
  await wrangler(['secret','bulk','--config',config],JSON.stringify(secrets));
  await wrangler(['deploy','--config',config,'--var','INGRESS_ENABLED:true','--durable-objects-code-update-mode','immediate']);
  let oldStatus,newStatus;const rotationStarted=Date.now();
  for(let i=0;i<20;i++){
    oldStatus=(await send(old)).status;newStatus=(await send()).status;
    if(oldStatus===401&&newStatus===200)break;await new Promise(r=>setTimeout(r,1000));
  }
  check(oldStatus===401,'rotated old capability rejected after cutover',{status:oldStatus,verificationMs:Date.now()-rotationStarted});
  check(newStatus===200,'rotated current capability accepted after cutover',{status:newStatus});
  const versions=await wrangler(['deployments','list','--config',config,'--json']);
  await writeFile('.verification/cloudflare-release-b/deployments.json',versions);
}catch(error){
  const detail=/^Isolated control failed: \d{3} [a-z-]+$/.test(error.message)?error.message:'credential and request details withheld';
  check(false,'hosted runner stopped at a verified failure',{diagnostic:detail});
}finally{
  const summary={worker:expectedName,origin,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,results,
    isolation:'Synthetic-only Cloudflare upstream; no production Vercel or Supabase target; not genuine Garmin delivery',
    credentialStorage:'Cloudflare secret bindings; generated only in runner memory; no values written to files or stdout'};
  await writeFile(resolve('.verification/cloudflare-release-b/hosted-results.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({passed:summary.passed,failed:summary.failed}));if(summary.failed)process.exitCode=1;
}

// ISOLATED HOSTED TEST HARNESS. Never imports the website, Supabase or OAuth.
import { timingSafeEqual, createHash } from 'node:crypto';
import { createIngress, GarminIngressLimits } from './worker.mjs';

const TARGET = 'https://synthetic-upstream.invalid/api/internal/garmin-health/ingest';
const key = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const deny = status => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
function authorized(request, expected) {
  const candidate = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  return key(expected) && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(candidate ?? '0'.repeat(64), 'hex')) && !!candidate;
}
const worker = {
  async fetch(request, env) {
    try {
      if (env.TEST_MODE !== 'synthetic-only' || env.INGRESS_ENABLED !== 'true') return deny(503);
      const path = new URL(request.url).pathname;
      const fixture = env.TEST_UPSTREAM.get(env.TEST_UPSTREAM.idFromName('synthetic-upstream'));
      if (path === '/__test/control') {
        if (request.method !== 'POST' || !authorized(request, env.TEST_CONTROL_KEY)) return new Response(null,{status:401,headers:{'X-Arc-Test-Stage':'control-auth'}});
        const text = await request.text(); if (text.length > 256) return deny(413);
        const command = JSON.parse(text);
        if (command.action === 'resetQuota') {
          for (const name of ['garmin-global-v1','garmin-rejected-v1']) await env.LIMITS.get(env.LIMITS.idFromName(name)).fetch('https://limits/__test/reset');
          return deny(204);
        }
        return fixture.fetch('https://synthetic-upstream.invalid/control', { method: 'POST', headers: { Authorization: `Bearer ${env.TEST_CONTROL_KEY}` }, body: text });
      }
      // No network fetch fallback exists. Even a future flag change cannot send to production.
      const receive = createIngress({ target: TARGET, fetcher: (_url, init) => {
        if (_url !== TARGET) throw Error('Unexpected isolated target');
        const pending = fixture.fetch(TARGET, init);
        // Service bindings can have different AbortSignal behavior than network fetch.
        return new Promise((resolve,reject) => {
          const aborted = () => reject(new DOMException('Synthetic upstream timed out','AbortError'));
          init.signal.addEventListener('abort',aborted,{once:true});
          pending.then(resolve,reject).finally(()=>init.signal.removeEventListener('abort',aborted));
        });
      }});
      return await receive(request,env);
    } catch { return deny(503); }
  }
};
export default worker;

export class HostedTestLimits extends GarminIngressLimits {
  async fetch(request) {
    if (new URL(request.url).pathname === '/__test/reset') { await this.storage.deleteAll(); return deny(204); }
    return super.fetch(request);
  }
}

export class SyntheticUpstream {
  constructor(state,env) { this.storage=state.storage; this.env=env; }
  async fetch(request) {
    const control = new URL(request.url).pathname === '/control';
    if (!authorized(request,control ? this.env.TEST_CONTROL_KEY : this.env.GARMIN_FORWARD_KEY)) return new Response(null,{status:401,headers:{'X-Arc-Test-Stage':control?'upstream-control-auth':'upstream-forward-auth'}});
    if (control) {
      const command=await request.json();
      if (command.action === 'reset') {
        await this.storage.put('state',{epoch:crypto.randomUUID(),mode:'success',receipts:[],calls:0});return deny(204);
      }
      if (command.action === 'mode' && ['success','unavailable','timeout','redirect','slow'].includes(command.mode)) {
        const state=await this.storage.get('state')??{epoch:crypto.randomUUID(),receipts:[],calls:0};state.mode=command.mode;await this.storage.put('state',state);return deny(204);
      }
      if (command.action === 'status') return Response.json(await this.storage.get('state')??{});
      return deny(400);
    }
    const before=await this.storage.get('state')??{epoch:'initial',mode:'success',receipts:[],calls:0};
    if(before.mode==='unavailable')return deny(503);
    if(before.mode==='redirect')return new Response(null,{status:302,headers:{Location:'https://never-follow.invalid'}});
    if(before.mode==='timeout')await new Promise(resolve=>setTimeout(resolve,25000));
    if(before.mode==='slow')await new Promise(resolve=>setTimeout(resolve,2500));
    const body=await request.text();let payload;
    try{payload=JSON.parse(body);}catch{return deny(400);}
    if(Object.keys(payload).join(',')!=='dailies'||!Array.isArray(payload.dailies)||payload.dailies.length!==1
      ||payload.dailies[0]?.userId!=='synthetic-cloudflare-test')return deny(400);
    // Store only test receipt digests and sanitized metadata, not measurements or URLs.
    return this.storage.transaction(async txn=>{
      const current=await txn.get('state')??before;if(current.epoch!==before.epoch)return deny(503);
      const digest=createHash('sha256').update(body).digest('hex');
      if(!current.receipts.includes(digest))current.receipts.push(digest);
      current.receipts=current.receipts.slice(-100);current.calls++;
      current.privateUrlSeen=request.url.includes(this.env.GARMIN_ENDPOINT_SECRET);
      current.fixedPath=new URL(request.url).pathname==='/api/internal/garmin-health/ingest';
      current.unexpectedHeaders=[...request.headers.keys()].filter(name=>!['authorization','content-type','content-length','host'].includes(name));
      await txn.put('state',current);return deny(200);
    });
  }
}

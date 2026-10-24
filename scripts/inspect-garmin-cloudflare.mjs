/** Read-only Cloudflare metadata; use official keychain-backed auth only in memory. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,cli=process.env.WRANGLER_CLI;
if(!/^[a-f0-9]{32}$/.test(account??'')||!cli)throw Error('Explicit Cloudflare account and CLI required');
const execute=promisify(execFile),base=`https://api.cloudflare.com/client/v4/accounts/${account}`;
try{
  const auth=JSON.parse((await execute(process.execPath,[cli,'auth','token','--json'],{env:{...process.env,CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'},windowsHide:true})).stdout);
  if(auth.type!=='oauth'||typeof auth.token!=='string')throw Error('Unexpected credential type');
  const query=async path=>{const r=await fetch(base+path,{headers:{Authorization:`Bearer ${auth.token}`},signal:AbortSignal.timeout(20000)});return{status:r.status,data:await r.json()};};
  const settings=await query('/workers/scripts/arc-track-garmin-ingress-test/settings');
  const scriptSettings=await query('/workers/scripts/arc-track-garmin-ingress-test/script-settings');
  const accountSettings=await query('/workers/account-settings');
  const subscriptions=await query('/subscriptions');
  const versions=await query('/workers/scripts/arc-track-garmin-ingress-test/versions');
  const scripts=await query('/workers/scripts');
  const script=Array.isArray(scripts.data.result)?scripts.data.result.find(s=>s.id==='arc-track-garmin-ingress-test'):null;
  const current=versions.data.result?.items?.slice().sort((a,b)=>Date.parse(b.metadata?.created_on??0)-Date.parse(a.metadata?.created_on??0))[0]?.id;
  const version=current?await query('/workers/scripts/arc-track-garmin-ingress-test/versions/'+current):null;
  const resources=version?.data.result?.resources??{};
  const metricsQuery=`query { viewer { accounts(filter: {accountTag: "${account}"}) {
    workersInvocationsAdaptive(limit: 10,filter:{scriptName:"arc-track-garmin-ingress-test",datetime_geq:"2026-10-24T00:00:00Z"}) {
      sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 wallTimeP50 wallTimeP99 }
    }
  } } }`;
  const mr=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:JSON.stringify({query:metricsQuery}),signal:AbortSignal.timeout(20000)});
  const metrics=await mr.json();const d=settings.data.result??{};
  const safe={worker:'arc-track-garmin-ingress-test',settingsStatus:settings.status,version:current,
    bindings:d.bindings?.map(b=>({name:b.name,type:b.type,...(b.type==='plain_text'?{value:b.text}:{}),...(b.type==='durable_object_namespace'?{class:b.class_name,namespace:b.namespace_id}:{})})),
    observability:scriptSettings.data.result?.observability??d.observability??resources.script?.observability??resources.script?.settings?.observability??null,
    scriptSettingsStatus:scriptSettings.status,
    scriptSettingsKeys:Object.keys(scriptSettings.data.result??{}),
    listedObservability:script?.observability??null,
    versionResourceKeys:Object.keys(resources),scriptMetadataKeys:Object.keys(resources.script??{}),settingsKeys:Object.keys(d),
    versionScriptSettings:resources.script?.settings??null,
    logpush:d.logpush,tailConsumers:d.tail_consumers,
    accountSettingsStatus:accountSettings.status,accountSettings:accountSettings.data.result,
    subscriptionsStatus:subscriptions.status,subscriptions:Array.isArray(subscriptions.data.result)?subscriptions.data.result.map(s=>({plan:s.rate_plan?.public_name??s.rate_plan?.id,price:s.price})):null,
    metricsStatus:mr.status,metrics:metrics.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive??null,metricsErrors:metrics.errors?.map(e=>e.message.slice(0,180))??[]};
  await writeFile('.verification/cloudflare-release-b/metadata.json',JSON.stringify(safe,null,2));console.log(JSON.stringify(safe,null,2));
}catch{console.log('Cloudflare read-only metadata inspection failed; credential and response details withheld.');process.exitCode=1;}

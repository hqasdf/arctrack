/** Hosted canary-only Tail check. Never use valid callback capabilities here. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const cli=process.env.WRANGLER_CLI,account=process.env.CLOUDFLARE_ACCOUNT_ID,origin=process.env.GARMIN_TEST_WORKER_ORIGIN;
if(!cli||!/^[a-f0-9]{32}$/.test(account??'')||!/^https:\/\/arc-track-garmin-ingress-test\.[a-z0-9-]+\.workers\.dev$/.test(origin??''))throw Error('Explicit isolated test targets required');
const execute=promisify(execFile);let socket,tailId,token;
const base=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/arc-track-garmin-ingress-test/tails`;
const result={tailCreated:false,canaryObserved:false,canaryInPrivilegedRequestMetadata:false,consoleMessages:0,tailDeleted:false};
try{
  const auth=JSON.parse((await execute(process.execPath,[cli,'auth','token','--json'],{env:{...process.env,CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'},windowsHide:true})).stdout);
  token=auth.token;if(auth.type!=='oauth'||typeof token!=='string')throw Error('Unexpected credential type');
  const r=await fetch(base,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({filters:[]})});
  const d=await r.json();if(!r.ok||!d.result?.url)throw Error('Tail creation failed');
  tailId=d.result.id;result.tailCreated=true;
  const require=createRequire(cli);const WebSocket=require('ws');
  socket=new WebSocket(d.result.url,'trace-v1');
  const canary=randomBytes(32).toString('hex');
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',()=>reject(Error('Tail transport failed')));});
  socket.send(JSON.stringify({debug:false}));
  const seen=new Promise(resolve=>{
    const timer=setTimeout(()=>resolve(false),20000);
    socket.on('message',bytes=>{try{
      const event=JSON.parse(bytes.toString());
      if(JSON.stringify(event).includes(canary)){
        result.canaryObserved=true;result.canaryInPrivilegedRequestMetadata=event.event?.request?.url?.includes(canary)??false;
        result.consoleMessages=(event.logs??[]).length;result.outcome=event.outcome;
        clearTimeout(timer);resolve(true);
      }
    }catch{}});
  });
  // This random marker was never installed as a secret and cannot authorize delivery.
  const request=await fetch(origin+'/garmin/'+canary,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  result.canaryHttpStatus=request.status;await seen;
}catch{result.diagnostic='Canary inspection could not complete; credentials and URLs withheld';}
finally{
  socket?.close();
  if(tailId&&token){try{const deleted=await fetch(base+'/'+tailId,{method:'DELETE',headers:{Authorization:'Bearer '+token}});result.tailDeleted=deleted.ok;}catch{}}
  result.interpretation=result.canaryInPrivilegedRequestMetadata
    ? 'Privileged live Tail can expose a callback path despite disabled routine observability. This is a real residual bearer-URL risk, not a secrecy pass.'
    : 'No metadata exposure was observed by this bounded check; this does not prove infrastructure secrecy.';
  await writeFile('.verification/cloudflare-release-b/logging-canary.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}

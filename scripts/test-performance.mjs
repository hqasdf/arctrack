/** Public loopback pages only. No login, provider calls, production URL or persistent browser profile. */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, appendFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import config from '../performance.config.mjs';
import { metrics, summarize, warnings, buildSize } from './performance-report.mjs';

const require = createRequire(import.meta.url), execute = promisify(execFile);
const root = process.cwd();
if (Object.keys(process.env).some(key => /^(?:NEXT_PUBLIC_SUPABASE_|SUPABASE_|GARMIN_)/.test(key) && process.env[key])) {
  throw Error('Performance checks require a credential-free process environment');
}
// Next loads dotenv itself. Refuse local secret files rather than claiming env redaction isolates them.
if ((await readdir(root)).some(name => /^\.env(?:\.|$)/.test(name) && name !== '.env.example')) {
  throw Error('Run performance checks from a clean source export without .env files. See docs/performance.md.');
}
const output = join(root,config.output);
await mkdir(output,{recursive:true});
const origin = `http://127.0.0.1:${config.port}`;
// Do not accidentally benchmark an existing server on this port.
try { await fetch(origin,{signal:AbortSignal.timeout(1000)}); throw Error('Performance port already in use'); }
catch (error) { if (error.message === 'Performance port already in use') throw error; }
const server = spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(config.port)],{
  cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},
});
let serverLog = '', spawnError;
server.on('error',error => { spawnError = error; });
server.stdout.on('data',chunk => { serverLog += chunk; });
server.stderr.on('data',chunk => { serverLog += chunk; });
try {
  let ready = false;
  for (let attempt=0;attempt<60;attempt++) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw Error('Production server exited before readiness');
    try { const response=await fetch(origin,{signal:AbortSignal.timeout(1000)}); if(response.ok){ ready=true;break; } } catch {}
    await new Promise(accept => setTimeout(accept,500));
  }
  if (!ready) throw Error('Production server did not become ready');
  const results = {};
  const measurement = { platform:process.platform, builder:process.env.PERFORMANCE_BUILD_ENGINE ?? 'turbopack', lighthouse:require('lighthouse/package.json').version };
  const runs = Number(process.env.PERFORMANCE_RUNS ?? config.runs);
  if (!Number.isInteger(runs) || runs<1 || runs>5) throw Error('Performance runs must be between 1 and 5');
  for (const route of config.routes) {
    const samples=[];
    for(let run=0;run<runs;run++) {
      const name=`${route === '/' ? 'home' : route.slice(1)}-${run+1}`;
      await execute(process.execPath,[require.resolve('lighthouse/cli/index.js'),origin+route,
        '--only-categories=performance','--output=json','--output=html',`--output-path=${join(output,name)}`,
        '--chrome-flags=--headless=new --no-sandbox','--quiet'],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
      const report=JSON.parse(await readFile(join(output,`${name}.report.json`),'utf8'));
      if (report.finalDisplayedUrl !== origin+route) throw Error('Public route redirected unexpectedly');
      samples.push(metrics(report));
    }
    results[route]=summarize(samples);
  }
  let baseline={};
  try { baseline=JSON.parse(await readFile(join(root,config.baseline),'utf8')); } catch(error) { if(error.code !== 'ENOENT') throw error; }
  const comparable = JSON.stringify(measurement) === JSON.stringify(baseline.measurement);
  const report={measuredAt:new Date().toISOString(),node:process.version,platform:process.platform,measurement,runs,
    conditions:'Lighthouse default mobile emulation and simulated throttling; fresh browser profiles; headless Chrome; loopback production server; no app credentials. TBT is not field INP. WebGL capability varies by runner.',
    routes:results,build:await buildSize(root),warnings:Object.entries(results).flatMap(([route,summary]) => warnings(summary,comparable ? baseline.routes?.[route] : undefined,config.warningMultiplier).map(message => `${route}: ${message}`))};
  await writeFile(join(output,'summary.json'),JSON.stringify(report,null,2)+'\n');
  const summary=`### Mobile lab performance (report only)\n\n| Route | LCP ms | CLS | TBT ms | JS bytes | Page bytes |\n|---|---:|---:|---:|---:|---:|\n${Object.entries(results).map(([route,data])=>`| ${route} | ${Object.values(data).map(item=>Math.round(item.median*100)/100).join(' | ')} |`).join('\n')}\n\n${comparable ? (report.warnings.join('\n') || 'No warning-budget exceedances.') : 'Baseline is not comparable to this platform, builder or Lighthouse version; collect a matching baseline before interpreting regressions.'}\n\nTBT is a laboratory metric, not field INP. See attached reports and min/max spread.\n`;
  await writeFile(join(output,'summary.md'),summary);
  console.log(summary);
  if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
} finally {
  server.kill();
  await new Promise(accept => { if(server.exitCode !== null || spawnError) accept(); else { server.once('exit',accept); setTimeout(accept,5000).unref(); } });
  await writeFile(join(output,'server.log'),serverLog);
}

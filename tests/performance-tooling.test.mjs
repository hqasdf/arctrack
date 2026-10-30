import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { metrics, summarize, warnings, buildSize } from '../scripts/performance-report.mjs';
import { validateWorkflow } from '../scripts/check-workflow.mjs';
import { ciScope } from '../scripts/ci-scope.mjs';

test('Lighthouse lab measurements retain zero CLS and distinguish script transfer from page weight', () => {
  const report = {audits:{'largest-contentful-paint':{numericValue:1200},'cumulative-layout-shift':{numericValue:0},'total-blocking-time':{numericValue:80},'resource-summary':{details:{items:[{resourceType:'script',transferSize:100},{resourceType:'total',transferSize:500}]}}}};
  assert.deepEqual(metrics(report),{lcpMs:1200,cls:0,tbtMs:80,javascriptBytes:100,pageBytes:500});
  assert.throws(()=>metrics({...report,runtimeError:{code:'FAILED_DOCUMENT_REQUEST'}}));
  assert.throws(()=>metrics({audits:{}}));
});
test('median reporting preserves noisy-run spread and warns only beyond baseline and noise floor', () => {
  const baseline=summarize([{lcpMs:1000,cls:0},{lcpMs:1100,cls:0},{lcpMs:5000,cls:0.1}]);
  assert.deepEqual(baseline.lcpMs,{median:1100,min:1000,max:5000});
  assert.deepEqual(warnings({lcpMs:{median:1400},cls:{median:0.01}},baseline),[]);
  assert.equal(warnings({lcpMs:{median:1800}},baseline).length,1);
  assert.deepEqual(warnings(baseline,undefined),[]);
});
test('CI requires a production build, keeps performance advisory, and covers tooling paths', async () => {
  const source=await readFile(new URL('../.github/workflows/validate.yml',import.meta.url),'utf8');
  validateWorkflow(source);
  assert.throws(()=>validateWorkflow(source.replace('run: npm run build','run: echo skipped build')));
  assert.throws(()=>validateWorkflow(source.replace('name: Required production build','name: Required production build\n        continue-on-error: true')));
  for(const path of ['performance.config.mjs','performance-baseline.json','scripts/test-performance.mjs','.github/workflows/validate.yml']) {
    assert.equal(ciScope([path]).web,true);
    assert.equal(ciScope([path]).maintenance,true);
  }
});
test('asset reporting measures production static JavaScript and CSS without reading server secrets or cache files', async () => {
  const root=await mkdtemp(join(tmpdir(),'arctrack-build-report-test-'));
  try {
    await mkdir(join(root,'.next/static/chunks'),{recursive:true});
    await mkdir(join(root,'.next/server'),{recursive:true});
    await writeFile(join(root,'.next/static/chunks/a.js'),'12345');
    await writeFile(join(root,'.next/static/chunks/b.css'),'123');
    await writeFile(join(root,'.next/server/private.js'),'do not report');
    const report=await buildSize(root);
    assert.equal(report.javascriptBytes,5);
    assert.equal(report.cssBytes,3);
    assert.deepEqual(report.largest.map(file=>file.file),['.next/static/chunks/a.js','.next/static/chunks/b.css']);
  } finally { await rm(root,{recursive:true,force:true}); }
});

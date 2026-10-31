import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {verifyReleaseGate,validationJobs} from '../scripts/release-gate.mjs';
import {ciScope} from '../scripts/ci-scope.mjs';
import {validateWorkflow} from '../scripts/check-workflow.mjs';
import {stringify,parse} from 'yaml';

function results(paths=['package.json']){
 const scope=ciScope(paths);
 return {changes:{result:'success',outputs:Object.fromEntries(Object.entries(scope).map(([k,v])=>[k,String(v)]))},...Object.fromEntries(validationJobs.map(job=>[job,{result:scope[job]?'success':'skipped'}]))};
}
for(const [label,paths] of [['all',['package-lock.json']],['web',['src/a.ts']],['mobile',['apps/mobile/src/a.ts']],['core',['packages/core/src/a.ts']],['documentation-only',['docs/guide.md','README.md']]])test(`${label}: applicable jobs must pass; only unaffected jobs may skip`,()=>{
 const needs=results(paths);assert.equal(verifyReleaseGate(needs),true);
 assert.equal(needs.maintenance.result,'success');
 for(const job of validationJobs){
  const copy=structuredClone(needs);copy[job].result='skipped';
  if(needs.changes.outputs[job]==='true')assert.throws(()=>verifyReleaseGate(copy));else assert.equal(verifyReleaseGate(copy),true);
 }
});
for(const job of ['changes',...validationJobs])for(const status of ['failure','cancelled','skipped','neutral','timed_out',''])test(`${job} ${status||'missing result'} cannot pass a required gate`,()=>{
 const needs=results();needs[job].result=status;assert.throws(()=>verifyReleaseGate(needs));
});
for(const value of [undefined,null,{}, {changes:{result:'success',outputs:{}}}])test(`incomplete job graph rejected: ${JSON.stringify(value)}`,()=>assert.throws(()=>verifyReleaseGate(value)));
for(const job of validationJobs)test(`malformed or missing scope ${job} is rejected`,()=>{
 for(const value of [undefined,'',true,'TRUE','false ']){const needs=results();needs.changes.outputs[job]=value;assert.throws(()=>verifyReleaseGate(needs));}
 const needs=results();delete needs[job];assert.throws(()=>verifyReleaseGate(needs));
});
test('unaffected jobs may additionally pass, but cannot fail or cancel',()=>{
 const needs=results(['README.md']);needs.web.result='success';assert.equal(verifyReleaseGate(needs),true);
 for(const status of ['failure','cancelled']){needs.web.result=status;assert.throws(()=>verifyReleaseGate(needs));}
});
test('maintenance cannot be disabled even on a docs-only commit',()=>{
 const needs=results(['README.md']);needs.changes.outputs.maintenance='false';needs.maintenance.result='skipped';assert.throws(()=>verifyReleaseGate(needs));
});
test('unknown configuration and renamed executable files fail closed to platform checks',()=>{
 for(const path of ['.npmrc','new-tool/config.yml','docs/execute.mjs','.gitignore'])assert.deepEqual(ciScope([path]),{web:true,mobile:true,core:true,maintenance:true});
 assert.equal(ciScope(['src/deleted.ts','docs/renamed.md']).web,true);
});
test('actual Git scope includes both deleted source and renamed documentation paths',()=>{
 const root=mkdtempSync(join(tmpdir(),'arctrack-gate-'));
 try{
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  git('init','--quiet');git('config','user.name','Synthetic CI Test');git('config','user.email','ci-test@example.invalid');
  writeFileSync(join(root,'run.mjs'),'export const value=1;');git('add','run.mjs');git('commit','--quiet','-m','fixture');const base=git('rev-parse','HEAD');
  renameSync(join(root,'run.mjs'),join(root,'README.md'));git('add','-A');git('commit','--quiet','-m','rename fixture');const head=git('rev-parse','HEAD');
  const output=execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/ci-scope.mjs',import.meta.url))],{encoding:'utf8',env:{...process.env,BASE_SHA:base,HEAD_SHA:head,GITHUB_OUTPUT:'',FORCE_ALL:'false'},cwd:root});
  assert.match(output,/web=true/);assert.match(output,/mobile=true/);assert.match(output,/maintenance=true/);
 }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));rmSync(root,{recursive:true,force:true});}
});
test('CLI returns nonzero for failed/malformed results and zero only for verified validation',()=>{
 for(const [input,status] of [[JSON.stringify(results()),0],['{invalid',1],['null',1],[JSON.stringify({...results(),web:{result:'failure'}}),1]]){
  const run=spawnSync(process.execPath,['scripts/release-gate.mjs'],{encoding:'utf8',env:{...process.env,VALIDATION_NEEDS:input}});assert.equal(run.status,status);
 }
});
const source=readFileSync(new URL('../.github/workflows/validate.yml',import.meta.url),'utf8');
test('workflow accepts only an always-running exact-name gate with all prerequisites',()=>{
 validateWorkflow(source);
 for(const mutate of [w=>w.on.push.paths=['src/**'],w=>w.on.pull_request.branches=['main'],w=>w.jobs['release-gate'].if='success()',w=>w.jobs['release-gate'].needs.pop(),w=>w.jobs['release-gate'].name='other',w=>w.jobs.web['continue-on-error']=true,w=>w.jobs['release-gate'].steps.at(-1).if='success()',w=>w.jobs.extra={...w.jobs.core},w=>w.jobs.web.name='release-gate']){
  const w=parse(source);mutate(w);assert.throws(()=>validateWorkflow(stringify(w)));
 }
});

test('manual dispatch forces all validation; invalid comparison cannot silently skip tests',()=>{
 const script=fileURLToPath(new URL('../scripts/ci-scope.mjs',import.meta.url));
 const forced=spawnSync(process.execPath,[script],{encoding:'utf8',env:{...process.env,FORCE_ALL:'true',BASE_SHA:'invalid',HEAD_SHA:'invalid',GITHUB_OUTPUT:''}});
 assert.equal(forced.status,0);for(const job of validationJobs)assert.match(forced.stdout,new RegExp(job+'=true'));
 const invalid=spawnSync(process.execPath,[script],{encoding:'utf8',env:{...process.env,FORCE_ALL:'false',BASE_SHA:'invalid',HEAD_SHA:'invalid',GITHUB_OUTPUT:''}});
 assert.notEqual(invalid.status,0);
});

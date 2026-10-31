import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { trainingNavigationRuntime as runtime } from './helpers/training-navigation-runtime.mjs';

test('Counter and scoring retain the same loaded Round through rapid switching and browser traversal',()=>{
  const h=runtime();h.render();h.render();const original=h.scoring();assert.equal(original.props.round.arrows.length,72);
  const start=performance.now();
  for(let i=0;i<100;i++){
    h.scoring().props.onCounter();h.render();assert.equal(h.scoring().key,original.key);assert.equal(h.scoring().props.round,original.props.round);
    const resume=h.nodes().find(n=>n.type==='button'&&n.props.children==='Continue Scoring');assert.ok(resume);resume.props.onClick();h.render();
  }
  assert.equal(h.metrics().refreshes,0);h.back();h.render();assert.match(h.location.search,/tool=counter/);h.forward();h.render();assert.doesNotMatch(h.location.search,/tool=counter/);
  console.log(JSON.stringify({fixture:'100 local Counter/Round cycles',elapsedMs:Number((performance.now()-start).toFixed(2)),fullRouterRefreshes:h.metrics().refreshes,roundArrowsRetained:h.scoring().props.round.arrows.length,limitation:'Component-handler harness, not browser/native latency'}));
  h.dispose();assert.equal(h.listeners.size,0);
});
test('Round Back retains confirmed edits, refreshes only plan progress, and exposes every Round',()=>{
  const h=runtime();h.render();h.render();
  h.scoring().props.onChange(round=>({...round,arrows:round.arrows.map((a,i)=>i? a:{...a,score:'X',plot:{x:0,y:0}})}));h.render();
  h.scoring().props.onBack();h.render();assert.equal(h.metrics().refreshes,0);assert.equal(h.metrics().progress,1);
  assert.equal(h.nodes().filter(n=>n.type==='button'&&n.props.children==='Open').length,5);
  h.nodes().find(n=>n.type==='button'&&n.props.children==='Open').props.onClick();h.render();assert.equal(h.scoring().props.round.arrows[0].score,'X');h.dispose();
});
test('stored Session views and native code preserve safeguards rather than introducing pagination or per-Round loading',()=>{
  const web=readFileSync(new URL('../src/features/sessions/components/sessions-workspace.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(web,/router.refresh|readSessions\(/);assert.match(web,/hidden=\{view!=="scoring"\}/);assert.match(web,/useDraftGuard/);
  const native=readFileSync(new URL('../apps/mobile/app/rounds/[roundId]/score.tsx',import.meta.url),'utf8');
  assert.match(native,/DeviceSaveNavigationGuard/);assert.match(native,/openOfflineScoring/);assert.match(native,/shownOwner.current!==/);
});
test('Session switching and deep links select complete existing Rounds without carrying edits to another Session',()=>{
  const h=runtime();h.render();h.render();h.scoring().props.onChange(round=>({...round,arrows:round.arrows.map((a,i)=>i?a:{...a,score:'X'})}));h.render();
  h.navigate('/sessions?session=two&round=s2r1');h.render();assert.equal(h.scoring().props.sessionId,'two');assert.equal(h.scoring().props.round.arrows.length,72);assert.equal(h.scoring().props.round.arrows[0].score,'9');
  h.navigate('/sessions?session=one&round=r1');h.render();assert.equal(h.scoring().props.round.arrows[0].score,'X');assert.equal(h.metrics().refreshes,0);h.dispose();
});

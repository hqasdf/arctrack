/** Handler measurements only: mock transport cannot establish browser/server latency. */
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { trainingNavigationRuntime } from '../tests/helpers/training-navigation-runtime.mjs';

const ref=process.argv[2]??'HEAD';
if(!/^(?:HEAD|[a-f\d]{7,40})$/i.test(ref))throw Error('Use HEAD or an immutable commit SHA');
const source=execFileSync('git',['show',`${ref}:src/features/sessions/components/sessions-workspace.tsx`],{encoding:'utf8'});
for(const [label,code] of [['baseline',source],['working-tree',undefined]]){
  const h=trainingNavigationRuntime({source:code,initialRound:false});
  h.render();h.render();
  const open=()=>h.nodes().find(n=>n.type==='button'&&n.props.children==='Open').props.onClick();
  open();h.render();global.gc?.();const before=process.memoryUsage().heapUsed;const start=performance.now();
  for(let i=0;i<100;i++){h.scoring().props.onBack();h.render();open();h.render();}
  const elapsed=performance.now()-start;global.gc?.();
  console.log(JSON.stringify({label,baselineRef:ref,fixture:'100 Round Back / reopen cycles; 2 Sessions; selected Session has 5 Rounds and 360 Arrows',
    handlerElapsedMs:Number(elapsed.toFixed(2)),routerRefreshInvocations:h.metrics().refreshes,targetedProgressNotifications:h.metrics().progress,
    retainedHarnessHeapDeltaBytes:process.memoryUsage().heapUsed-before,roundArrows:h.scoring().props.round.arrows.length,
    limitation:'No network, database, React DOM, browser or Android timing. Handler timings and Node heap are diagnostic only; refresh calls are counted, not HTTP requests.'}));
  h.dispose();
}

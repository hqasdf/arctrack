import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chartHarness,elements} from './helpers/analytics-render-runtime.mjs';

const cases=[
 ['CoachLineChart',{points:[{label:'Today',value:9,tooltip:'Recorded 9'}],yLabel:'Avg / Arrow'}],
 ['VerticalBarChart',{points:[{label:'Today',value:120,tooltip:'120 Arrows'}],yLabel:'Arrows'}],
 ['TrendChart',{points:[{id:'r',date:'2026-10-31',roundName:'Custom 9 × 4',average:9,arrowCount:36}]}],
 ['VolumeChart',{points:[{key:'2026-10-31',startDate:'2026-10-31',endDate:'2026-10-31',arrowCount:120}],interval:'daily'}],
];
for(const [component,props] of cases){
 test(`${component}: focus changes detail without rebuilding chart or axis`,()=>{
  const h=chartHarness(component);const first=h.render(props),items=elements(first);
  const plot=items.find(e=>e.type==='svg')??items.find(e=>e.props?.className==='chartFrame');
  const point=items.find(e=>e.props?.tabIndex===0);assert.ok(point);assert.ok(plot);
  const calls=h.axisCalls;point.props.onFocus();const next=h.render(props);
  assert.ok(elements(next).includes(plot));assert.equal(h.axisCalls,calls);
  assert.ok(elements(next).some(e=>e.props?.role==='status'&&e.props.children===point.props['aria-label']));
  point.props.onBlur();assert.equal(elements(h.render(props)).some(e=>e.props?.role==='status'),false);
 });
 test(`${component}: immutable data replacement invalidates memoized geometry`,()=>{
  const h=chartHarness(component),before=h.render(props),calls=h.axisCalls;
  const after=h.render({...props,points:props.points.map(p=>({...p,average:8,value:8,arrowCount:1,tooltip:'Corrected'}))});
  assert.equal(h.axisCalls,calls+1);assert.notDeepEqual(after,before);
 });
 test(`${component}: empty-to-populated-to-empty preserves hook ordering`,()=>{
  const h=chartHarness(component);h.render({...props,points:[]});h.render(props);h.render({...props,points:[]});
  assert.equal(elements(h.render({...props,points:[]})).filter(e=>e.props?.tabIndex===0).length,0);
 });
}

test('Coach secondary series and axis labels invalidate cached plot',()=>{
 const h=chartHarness('CoachLineChart');const points=[{label:'Today',value:8,secondary:4,tooltip:'Primary'}];
 const a=h.render({points,yLabel:'Avg',secondaryLabel:'X'});
 const b=h.render({points,yLabel:'Percent',secondaryLabel:'Other'});
 assert.notDeepEqual(a,b);assert.equal(h.axisCalls,2);
 const secondary=elements(b).find(e=>e.props?.['aria-label']==='Today: Other 4.0');assert.ok(secondary);
});

test('Volume interval change refreshes axis and full list labels',()=>{
 const h=chartHarness('VolumeChart'),props=cases[3][1];
 const a=h.render(props),b=h.render({...props,interval:'weekly'});assert.notDeepEqual(a,b);assert.equal(h.axisCalls,2);
});

test('grouping memo boundary keeps all original Arrow circles and coordinate expressions',()=>{
 const text=readFileSync(new URL('../src/features/analytics/components/analytics-target-grouping.tsx',import.meta.url),'utf8');
 assert.match(text,/AnalyticsTargetGrouping = memo\(function AnalyticsTargetGrouping/);
 assert.match(text,/active\.arrows\.map\(/);assert.match(text,/arrow\.x \* 100/);assert.match(text,/cy \+ arrow\.y \* 100/);
 assert.doesNotMatch(text,/\.slice\(|downsample|MAX_POINTS/);
});

test('Coach all-null series retains its early return without building an axis',()=>{
 const h=chartHarness('CoachLineChart');
 assert.equal(h.render({points:[{label:'Missing',value:null,tooltip:'Unavailable'}],yLabel:'Avg'}),null);
 assert.equal(h.axisCalls,0);
 assert.ok(h.render({points:[{label:'Recorded',value:0,tooltip:'Genuine zero'}],yLabel:'Avg'}));
 assert.equal(h.axisCalls,1);
});

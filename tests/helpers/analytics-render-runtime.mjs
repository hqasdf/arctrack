import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as React from 'react';
import * as axis from '../../packages/core/src/chart-axis.ts';
const require=createRequire(import.meta.url);

/** Deterministic hook lifecycle for element-identity tests; browser tests cover DOM commits. */
export function chartHarness(component){
 const slots=[];let index=0,axisCalls=0;
 const hooks={...React,memo:fn=>fn,
  useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},
  useMemo(fn,deps){const i=index++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){slots[i]={deps,value:fn()};}return slots[i].value;},
  useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useEffect(){index++;},
 };
 const source=component==='TrendChart'||component==='VolumeChart'?'../../src/features/analytics/components/analytics-workspace.tsx':'../../src/features/organizations/components/coach-charts.tsx';
 let text=readFileSync(new URL(source,import.meta.url),'utf8');
 if(source.includes('analytics-workspace'))text+='\nexport {TrendChart,VolumeChart};';
 const compiled=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const loaded={exports:{}};
 const load=name=>{
  if(name==='react')return hooks;
  if(name==='@arc-track/core/chart-axis')return {...axis,chartAxis(...args){axisCalls++;return axis.chartAxis(...args);}};
  if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,name)=>name})};
  if(name==='next/link')return {__esModule:true,default:'a'};
  if(name==='../analytics-model')return require('@arc-track/core/analytics');
  if(name==='./analytics-target-grouping')return {AnalyticsTargetGrouping:()=>null};
  if(name==='./advanced-insights')return {AdvancedInsights:()=>null};
  return require(name);
 };
 new Function('module','exports','require',compiled)(loaded,loaded.exports,load);
 return {render(props){index=0;return loaded.exports[component](props);},get axisCalls(){return axisCalls;}};
}
export function elements(node){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(elements);return [node,...elements(node.props?.children)];}

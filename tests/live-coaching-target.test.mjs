import {readFileSync} from 'node:fs';
﻿import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadSessionModule,treeNodes} from './helpers/session-layout-runtime.mjs';
const insights=await import('@arc-track/core/insights');
const targets=loadSessionModule('src/features/sessions/components/session-insights.tsx',{'../session-insights-model':insights});
const deps={'../sessions/components/session-insights':targets,'../sessions/session-insights-model':insights};
const {default:Target}=loadSessionModule('src/features/live-coaching/athlete-target.tsx',deps);
const round={id:'r1',roundNumber:1,name:'70 m',distanceMetres:70,faceDiameterCm:122,faceType:'full_face',division:'Recurve',ends:2,arrowsPerEnd:3,arrows:[{id:'a',end:1,arrow:1,score:'9',syncState:'saved',plot:{x:.1,y:-.2}},{id:'b',end:2,arrow:1,score:'X',syncState:'saved',plot:null},{id:'c',end:2,arrow:2,score:'8',syncState:'saving',plot:{x:.2,y:.2}}]};

test('Target uses real Session coordinates, excludes unsaved plots and reports missing placements',()=>{
 const html=renderToStaticMarkup(React.createElement(Target,{rounds:[round]}));
 assert.match(html,/cx="10" cy="-20"/);assert.match(html,/1 recorded placements/);assert.match(html,/1 arrows without coordinates/);assert.match(html,/Scores alone never create a placement/);assert.doesNotMatch(html,/cx="20" cy="20"/);
 const empty=renderToStaticMarkup(React.createElement(Target,{rounds:[{...round,arrows:[{...round.arrows[0],plot:null}]}]}));assert.match(empty,/No plotted Arrows yet/);
});

test('End and Round selection restore actual filtered arrows without mixing target faces',()=>{
 let slot=0;const states=[];const hooks={...React,useMemo:fn=>fn(),useState(initial){const i=slot++;if(!(i in states))states[i]=initial;return [states[i],v=>{states[i]=v;}];}};
 const Comp=loadSessionModule('src/features/live-coaching/athlete-target.tsx',deps,hooks).default;
 const rounds=[round,{...round,id:'r2',name:'Indoor',faceType:'triple_face',arrows:[{...round.arrows[0],plot:{x:.1,y:.1,faceIndex:2}}]}];
 const render=()=>{slot=0;return Comp({rounds});};let tree=render();let selects=treeNodes(tree).filter(n=>n.type==='select');selects[1].props.onChange({target:{value:'2'}});tree=render();let target=treeNodes(tree).find(n=>n.type===targets.GroupingTarget);assert.equal(target.props.round.arrows.length,1);assert.equal(target.props.grouping.arrows.length,0);
 selects=treeNodes(tree).filter(n=>n.type==='select');selects[0].props.onChange({target:{value:'r2'}});tree=render();target=treeNodes(tree).find(n=>n.type===targets.GroupingTarget);assert.equal(target.props.round.faceType,'triple_face');assert.equal(target.props.grouping.arrows.length,1);assert.equal(treeNodes(tree).filter(n=>n.type==='select')[1].props.value,'all');
});


test('Target migration changes only coordinate projection; all existing authorisation and ACL boundaries remain',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replaceAll('\r\n','\n');
 const old=read('supabase/migrations/20261027233437_live_coaching_role_views.sql');
 const start=old.indexOf('create or replace function private.read_live_coaching('),end=old.indexOf('end;$$;',start)+8;
 const expected=old.slice(start,end).replace("'plot_x',null,'plot_y',null,'face_index',null","'plot_x',a.plot_x,'plot_y',a.plot_y,'face_index',a.face_index");
 const current=read('supabase/migrations/20261028015918_live_coaching_target_coordinates.sql').split('\n').filter(l=>!l.startsWith('--')).join('\n').trim();
 assert.equal(current,expected.trim());assert.doesNotMatch(current,/grant|create table|alter table|insert into|delete from/i);
});

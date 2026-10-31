import React from 'react';
import * as scoring from '@arc-track/core/scoring';
import * as presets from '@arc-track/core/presets';
import { newestRoundsFirst } from '@arc-track/core/round-order';
import { loadSessionModule,treeNodes } from './session-layout-runtime.mjs';
import { sessionSnapshot } from '../../src/features/sessions/session-snapshot.ts';
export function trainingNavigationRuntime({source,initialRound=true,read}={}){
  const listeners=new Map(),stack=[initialRound?'/sessions?session=one&round=r1':'/sessions?session=one'];let position=0,refreshes=0,progress=0;
  const location={pathname:'/sessions',search:initialRound?'?session=one&round=r1':'?session=one'};
  const apply=href=>{const url=new URL(href,'https://arc.example');location.pathname=url.pathname;location.search=url.search;};
  const window={location,history:{pushState:(_state,_title,href)=>{stack.splice(++position);stack.push(href);apply(href);}},
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),dispatchEvent:event=>listeners.get(event.type)?.(event)};
  const document={visibilityState:'visible',addEventListener:(n,fn)=>listeners.set('document:'+n,fn),removeEventListener:n=>listeners.delete('document:'+n)};
  let clock=0;const requests=[];class FixtureDate extends Date{static now(){return clock;}}
  const slots=[],effects=[];let cursor=0,tree;
  const hooks={...React,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){return slots[cursor++]??={current:initial};},useCallback(fn){cursor++;return fn;},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!deps.every((v,n)=>v===slots[i].deps[n])){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
  const nav=loadSessionModule('src/features/sessions/training-navigation.ts',{},hooks,{window});
  const mocks={react:hooks,'next/navigation':{useRouter:()=>({refresh:()=>{refreshes++;}})},'../actions':{},'../scoring-model':scoring,'../round-presets':presets,'@arc-track/core/round-order':{newestRoundsFirst},'../training-navigation':nav,
    '../session-snapshot':{sessionSnapshot},
    '@/features/notes-feedback/draft-guard':{confirmDraftNavigation:()=>true,useDraftGuard:()=>{}},
    '@/features/organizations/training-plan-events':{notifyTrainingPlanProgress:()=>{progress++;}},
    '@/features/arrow-counter/components/arrow-counter':{ArrowCounter:'Counter'},'./scoring-workspace':{ScoringWorkspace:'Scoring'},'./session-feedback-history':{SessionFeedbackHistory:'History'},
    './recent-round-configs':{RecentRoundConfigs:'Recent'},'./round-presets-panel':{RoundPresetsPanel:'Presets'},'./session-category-tabs':{SessionCategoryTabs:'Tabs'},
    '@/features/notes-feedback/session-notes-panel':{SessionNotesPanel:'Notes'},'@/features/notes-feedback/coach-feedback-panel':{CoachFeedbackPanel:'Feedback'},
    '@/features/live-coaching/presence':{LivePresence:'Presence'},'@/features/session-health/garmin-session-health':{GarminSessionHealth:'Health'},'@/features/weather/components/session-weather':{SessionWeatherHistory:'Weather'}};
  const {SessionsWorkspace}=loadSessionModule('src/features/sessions/components/sessions-workspace.tsx',mocks,hooks,{window,document,Date:FixtureDate,fetch:async(url,options)=>{requests.push({url,options});return read?read(url,options):{ok:true,status:200,json:async()=>({session:sessions[0]})};}},source);
  const rounds=Array.from({length:5},(_,i)=>({id:'r'+(i+1),roundNumber:i+1,name:'Round '+(i+1),division:'Recurve',distanceMetres:70,faceDiameterCm:122,faceType:'full_face',ends:12,arrowsPerEnd:6,arrows:Array.from({length:72},(_,a)=>({id:`${i}-${a}`,end:Math.floor(a/6)+1,arrow:a%6+1,score:'9',plot:{x:.1,y:.2},syncState:'saved'}))}));
  const sessions=[{id:'one',title:'Training',date:'2026-10-30',sessionType:'training',arrowCount:360,rounds},
    {id:'two',title:'Second Session',date:'2026-10-29',sessionType:'training',arrowCount:72,rounds:[{...rounds[0],id:'s2r1',name:'Second Session Round'}]}];
  const render=()=>{cursor=0;tree=SessionsWorkspace({initialSessions:sessions,viewerId:'owner',initialSessionId:'one'});while(effects.length)effects.shift()();return tree;};
  return{render,scoring:()=>treeNodes(tree).find(n=>n.type==='Scoring'),nodes:()=>treeNodes(tree),location,listeners,
    requests,initialSessions:sessions,advance(ms){clock+=ms;listeners.get('focus')?.();},
    navigate(href){window.history.pushState(null,'',href);listeners.get('popstate')?.(new Event('popstate'));},
    back(){if(position>0){apply(stack[--position]);listeners.get('popstate')?.(new Event('popstate'));}},
    forward(){if(position+1<stack.length){apply(stack[++position]);listeners.get('popstate')?.(new Event('popstate'));}},
    metrics:()=>({refreshes,progress,historyEntries:stack.length}),dispose:()=>slots.forEach(s=>s?.cleanup?.())};
}

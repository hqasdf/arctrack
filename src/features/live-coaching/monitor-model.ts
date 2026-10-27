import {scoringProgress,type Participant} from './model';
import type {HeartRateReading} from './heart-rate/measurement';
export type HrPoint={at:string;bpm:number;segment:number};
export type HrHistory={athleteId:string;count:number;minimum:number;maximum:number;average:number;points:HrPoint[]};
export type EndActivity={athleteId:string;roundId:string;end:number;changedAt:string;confirmedAt:string|null};
export type MonitorSnapshot={readings:HeartRateReading[];history:HrHistory[]|null;endActivity:EndActivity[]};
export const EMPTY_MONITOR:MonitorSnapshot={readings:[],history:[],endActivity:[]};
export type AthleteSort='name'|'score'|'progress'|'ends';
export function monitorAthletes(participants:Participant[],search:string,participation:string,sensor:string,sort:AthleteSort,readings:HeartRateReading[],now:number,connected:ReadonlySet<string>=new Set()){
 const present=(id:string)=>{const r=readings.find(r=>r.athleteId===id);return Boolean(r?.consent&&r.sourceId&&r.bpm&&r.receivedAt&&now-Date.parse(r.receivedAt)<=10000&&now-Date.parse(r.receivedAt)>=-5000);};
 const matchesSensor=(id:string)=>sensor==='all'||(sensor==='connected'?connected.has(id):sensor==='not_connected'?!connected.has(id):present(id)===(sensor==='receiving'));
 return participants.filter(p=>p.displayName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())&&(participation==='all'||p.state===participation)&&matchesSensor(p.athleteId)).map(p=>({participant:p,progress:scoringProgress(p.scoring)})).sort((a,b)=>{
  const x=a.progress,y=b.progress;
  const diff=sort==='score'?y.confirmedTotal-x.confirmedTotal:sort==='ends'?y.completedEnds-x.completedEnds:sort==='progress'?(y.plannedEnds?y.completedEnds/y.plannedEnds:0)-(x.plannedEnds?x.completedEnds/x.plannedEnds:0):0;
  return diff||a.participant.displayName.localeCompare(b.participant.displayName)||a.participant.athleteId.localeCompare(b.participant.athleteId);
 });
}
export function elapsedTraining(start:string|null|undefined,end:string|null|undefined,now:number){
 if(!start||!Number.isFinite(Date.parse(start)))return 'Not recorded';
 const seconds=Math.max(0,Math.floor(((end?Date.parse(end):now)-Date.parse(start))/1000));
 return `${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}
/** Use provider/server timestamps and segments, never bridge a missing-data interval. */
export function hrGeometry(points:HrPoint[]){
 const valid=points.filter(p=>Number.isFinite(Date.parse(p.at))&&p.bpm>=1&&p.bpm<=300).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 if(!valid.length)return {paths:[] as string[],dots:[] as {x:number;y:number;point:HrPoint}[],min:0,max:0,start:0,end:0};
 const start=Date.parse(valid[0].at),end=Date.parse(valid.at(-1)!.at),min=Math.max(0,Math.min(...valid.map(p=>p.bpm))-10),max=Math.max(...valid.map(p=>p.bpm))+10;
 const dots=valid.map(point=>({point,x:20+(Date.parse(point.at)-start)/Math.max(1000,end-start)*560,y:105-(point.bpm-min)/(max-min)*85}));
 const paths:string[]=[];let previous:typeof dots[number]|undefined;
 for(const dot of dots){const gap=!previous||dot.point.segment!==previous.point.segment;if(gap)paths.push(`M${dot.x.toFixed(2)},${dot.y.toFixed(2)}`);else paths[paths.length-1]+=` L${dot.x.toFixed(2)},${dot.y.toFixed(2)}`;previous=dot;}
 return {paths,dots,min,max,start,end};
}

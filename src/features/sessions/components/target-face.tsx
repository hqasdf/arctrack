"use client";

import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { ArrowEntry, Plot, TargetFaceType } from "../scoring-model";
import { calculateGroupingForArrows, calculateRobustMainGroup, calculateSightCheck, convexHull, type GroupingMetrics, type GroupingPoint } from "../session-insights-model";
import { calculatePinchTransform, clientToSvg, distanceBetween, IDENTITY_TARGET_TRANSFORM, inverseTargetTransform, midpoint, plotFromSvg, shouldPlotTargetSurface, type TargetPoint, type TargetTransform } from "../target-gesture";
import styles from "./sessions.module.css";

const ringColours: Record<number,string> = {1:"#f4f1e9",.9:"#f4f1e9",.8:"#202020",.7:"#202020",.6:"#49a4cf",.5:"#49a4cf",.4:"#e65a55",.3:"#e65a55",.2:"#f5cf3d",.1:"#f5cf3d"};
const fullRings=[1,.9,.8,.7,.6,.5,.4,.3,.2,.1];
const sixRings=[.6,.5,.4,.3,.2,.1];
const tripleRings=[.5,.4,.3,.2,.1];
const tripleCentres=[-110,0,110] as const;
const views={full_face:{x:-105,y:-105,width:210,height:210},six_ring:{x:-65,y:-65,width:130,height:130},triple_face:{x:-58,y:-168,width:116,height:336}} as const;

export function TargetFace({ arrows, selectedId, currentEnd, faceType, faceDiameterCm, onPlot }: { arrows: ArrowEntry[]; selectedId: string|null; currentEnd: number; faceType: TargetFaceType; faceDiameterCm: number; onPlot: (plot: Plot) => void }) {
  const view=views[faceType];
  const [transform,setTransform]=useState<TargetTransform>(IDENTITY_TARGET_TRANSFORM);
  const transformRef=useRef(transform);
  const pointers=useRef(new Map<number,TargetPoint>());
  const tap=useRef<{id:number;start:TargetPoint;moved:boolean}|null>(null);
  const pinch=useRef<{transform:TargetTransform;midpoint:TargetPoint;distance:number}|null>(null);
  const hadMultiTouch=useRef(false);
  const suppressUntil=useRef(0);

  function updateTransform(next:TargetTransform) { transformRef.current=next; setTransform(next); }
  function eventSvgPoint(event:PointerEvent<SVGSVGElement>) { return clientToSvg({x:event.clientX,y:event.clientY},event.currentTarget.getBoundingClientRect(),view); }
  function beginPinch(event:PointerEvent<SVGSVGElement>) {
    const pair=[...pointers.current.values()].slice(0,2);
    hadMultiTouch.current=true; tap.current=null;
    pinch.current={transform:transformRef.current,midpoint:clientPointToSvg(midpoint(pair[0],pair[1]),event.currentTarget),distance:distanceBetween(pair[0],pair[1])};
  }
  function handlePointerDown(event:PointerEvent<SVGSVGElement>) {
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    const point={x:event.clientX,y:event.clientY};
    pointers.current.set(event.pointerId,point);
    if (pointers.current.size===1 && performance.now()>=suppressUntil.current) {
      hadMultiTouch.current=false; tap.current={id:event.pointerId,start:point,moved:false}; pinch.current=null;
    } else if (pointers.current.size>=2) beginPinch(event);
  }
  function handlePointerMove(event:PointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const point={x:event.clientX,y:event.clientY}; pointers.current.set(event.pointerId,point);
    if (pointers.current.size>=2) {
      if (!pinch.current) beginPinch(event);
      const pair=[...pointers.current.values()].slice(0,2);
      const current=pinch.current!;
      updateTransform(calculatePinchTransform(current.transform,current.midpoint,current.distance,clientPointToSvg(midpoint(pair[0],pair[1]),event.currentTarget),distanceBetween(pair[0],pair[1])));
    } else if (tap.current?.id===event.pointerId && distanceBetween(tap.current.start,point)>8) tap.current.moved=true;
  }
  function handlePointerUp(event:PointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const candidate=tap.current;
    const shouldPlot=candidate?.id===event.pointerId && shouldPlotTargetSurface({hasSelectedArrow:Boolean(selectedId),moved:candidate.moved,hadMultiTouch:hadMultiTouch.current,suppressed:performance.now()<suppressUntil.current,pointerCount:pointers.current.size});
    if (shouldPlot) {
      onPlot(plotFromSvg(inverseTargetTransform(eventSvgPoint(event),transformRef.current),faceType,tripleCentres));
    }
    pointers.current.delete(event.pointerId);
    if (hadMultiTouch.current) suppressUntil.current=performance.now()+350;
    if (pointers.current.size<2) pinch.current=null;
    if (pointers.current.size===0) { tap.current=null; hadMultiTouch.current=false; }
  }
  function handlePointerCancel(event:PointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId); tap.current=null; pinch.current=null; suppressUntil.current=performance.now()+350;
    if (pointers.current.size===0) hadMultiTouch.current=false;
  }
  const viewBox=`${view.x} ${view.y} ${view.width} ${view.height}`;
  const label=faceType==="triple_face"?"Three-face target":faceType==="six_ring"?"Six-ring target":"Full ten-ring target";
  const {grouping,mainGroup}=useMemo(()=>{
    const nextGrouping=calculateGroupingForArrows(arrows,faceType,faceDiameterCm);
    return {grouping:nextGrouping,mainGroup:calculateRobustMainGroup(nextGrouping.arrows,faceDiameterCm)};
  },[arrows,faceType,faceDiameterCm]);
  const sightCheck=calculateSightCheck(mainGroup.metrics,faceDiameterCm);
  const flyerIds=new Set(mainGroup.flyers.map((arrow)=>arrow.id));
  const groups=faceType==="triple_face"
    ? tripleCentres.map((centre,faceIndex)=>({centre,allArrows:grouping.arrows.filter((arrow)=>arrow.faceIndex===faceIndex),mainArrows:mainGroup.mainArrows.filter((arrow)=>arrow.faceIndex===faceIndex)})).filter(({allArrows})=>allArrows.length>0)
    : [{centre:0,allArrows:grouping.arrows,mainArrows:mainGroup.mainArrows}];
  const plottedArrows=arrows.filter((item)=>item.plot);
  const orderedArrows=[...plottedArrows.filter((item)=>item.end!==currentEnd&&item.id!==selectedId),...plottedArrows.filter((item)=>item.end===currentEnd&&item.id!==selectedId),...plottedArrows.filter((item)=>item.id===selectedId)];
  return <div className={`${styles.targetWrap} ${faceType==="triple_face"?styles.tripleTargetWrap:""}`}>
    <svg className={`${styles.target} ${faceType==="triple_face"?styles.tripleTarget:""}`} viewBox={viewBox} role="img" aria-label={`${label} scoring surface`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel}>
      <defs><marker id="live-group-centre-arrow" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="4" markerHeight="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" className={styles.groupCentreArrowHead}/></marker></defs>
      <g transform={`translate(${transform.panX} ${transform.panY}) scale(${transform.scale})`}>
        {faceType==="triple_face"
          ? tripleCentres.map((cy,index)=><Face key={index} cy={cy} radii={tripleRings}/>)
          : <Face cy={0} radii={faceType==="six_ring"?sixRings:fullRings}/>
        }
        {mainGroup.metrics&&groups.map(({centre,allArrows,mainArrows})=><LiveGroupingOverlay key={centre} allArrows={allArrows} mainArrows={mainArrows} hasFlyers={mainGroup.flyers.length>0} centreX={mainGroup.metrics!.centreX} centreY={mainGroup.metrics!.centreY} faceCentreY={centre}/>)}
        {orderedArrows.map((item)=>{ const cy=faceType==="triple_face"?tripleCentres[item.plot!.faceIndex??1]:0; const selected=item.id===selectedId,current=item.end===currentEnd,flyer=flyerIds.has(item.id); return <g key={item.id} transform={`translate(${item.plot!.x*100} ${cy+item.plot!.y*100})`}><circle r={selected?2.2:current?1.8:1.15} className={selected?styles.markerSelected:current?styles.markerCurrent:styles.markerPrevious}/>{flyer&&<circle r="3.4" className={styles.markerFlyer}/>} {selected&&<circle r="4.5" className={styles.markerSelectedHalo}/>}</g>; })}
      </g>
    </svg>
    {mainGroup.metrics&&grouping.metrics&&<GroupPositionSummary metrics={mainGroup.metrics} spreadMetrics={grouping.metrics} faceDiameterCm={faceDiameterCm} sightCheck={sightCheck}/>}
  </div>;
}

function LiveGroupingOverlay({allArrows,mainArrows,hasFlyers,centreX,centreY,faceCentreY}:{allArrows:GroupingPoint[];mainArrows:GroupingPoint[];hasFlyers:boolean;centreX:number;centreY:number;faceCentreY:number}) {
  const mainHull=mainArrows.length>=3?convexHull(mainArrows):[];
  const fullHull=hasFlyers&&allArrows.length>=3?convexHull(allArrows):[];
  const points=(hull:GroupingPoint[])=>hull.map((arrow)=>`${arrow.x*100},${faceCentreY+arrow.y*100}`).join(" ");
  return <g className={styles.liveGroupingOverlay}>{fullHull.length>=3?<polygon points={points(fullHull)} className={styles.fullGroupHull}/>:null}{mainHull.length>=3?<polygon points={points(mainHull)} className={styles.mainGroupHull}/>:null}<line x1="0" y1={faceCentreY} x2={centreX*100} y2={faceCentreY+centreY*100} className={styles.groupCentreLine} markerEnd="url(#live-group-centre-arrow)"/><g transform={`translate(${centreX*100} ${faceCentreY+centreY*100})`} className={styles.mainGroupCentre}><circle r="3.6"/><line x1="-5" y1="0" x2="5" y2="0"/><line x1="0" y1="-5" x2="0" y2="5"/></g></g>;
}

function GroupPositionSummary({metrics,spreadMetrics,faceDiameterCm,sightCheck}:{metrics:GroupingMetrics;spreadMetrics:GroupingMetrics;faceDiameterCm:number;sightCheck:string|null}) {
  return <div className={styles.liveGroupSummary}><span>Group position</span><strong>{formatGroupPosition(metrics,faceDiameterCm)}</strong><div className={styles.liveSpreadMetrics}><div><span>Horizontal Spread</span><strong>{formatSpread(spreadMetrics.horizontalSpreadCm)}</strong></div><div><span>Vertical Spread</span><strong>{formatSpread(spreadMetrics.verticalSpreadCm)}</strong></div></div>{sightCheck&&<div className={styles.sightCheck}><span>Sight check</span><p>{sightCheck}</p></div>}</div>;
}

function clientPointToSvg(point:TargetPoint,svg:SVGSVGElement) { const box=svg.viewBox.baseVal; return clientToSvg(point,svg.getBoundingClientRect(),{x:box.x,y:box.y,width:box.width,height:box.height}); }
function Face({cy,radii}:{cy:number;radii:number[]}) { return <g>{radii.map((radius)=><circle key={radius} cx="0" cy={cy} r={radius*100} fill={ringColours[radius]} stroke="#4b443e" strokeWidth=".7"/>)}<circle cx="0" cy={cy} r="5" fill="none" stroke="#4b443e" strokeWidth=".7"/><circle cx="0" cy={cy} r="1.5" fill="none" stroke="#4b443e" strokeWidth=".6"/></g>; }
function formatGroupPosition(metrics:GroupingMetrics,faceDiameterCm:number) { const radius=faceDiameterCm/2,x=metrics.centreX*radius,y=metrics.centreY*radius; if(Math.abs(x)<.05&&Math.abs(y)<.05) return "Centred"; return `${Math.abs(x).toFixed(1)} cm ${x>=0?"right":"left"} \u00b7 ${Math.abs(y).toFixed(1)} cm ${y>=0?"low":"high"}`; }
function formatSpread(value:number|null) { return value===null?"—":`${value.toFixed(1)} cm`; }

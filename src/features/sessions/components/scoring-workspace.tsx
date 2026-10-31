"use client";
import { useEffect, useRef, useState } from "react";
import { createArrowPersistence, type ArrowSnapshot } from "@arc-track/core/arrow-persistence";
import { SCORE_LABELS, arrowKey, endTotal, formatArrowAverage, latestPlottedArrow, nextPlottedArrowSlot, roundTotal, scoreFromPlot, xCount, type ArrowEntry, type Plot, type RoundDraft, type ScoreLabel } from "../scoring-model";
import { WebArrowQueue, type ArrowSaveResult } from "../web-arrow-queue";
import { TargetFace } from "./target-face";
import { RoundInsights } from "./session-insights";
import { GroupingExportButton } from "./grouping-export";
import styles from "./sessions.module.css";
import { ScoringWeather } from "@/features/weather/components/session-weather";
import { DeviceScoringRecovery } from "../device-scoring";
import { useDraftGuard } from "@/features/notes-feedback/draft-guard";

export function ScoringWorkspace({sessionId,sessionTitle,sessionDate,round,onChange,onBack,onConfigure,viewerId,onCounter,active=true,onPendingChange}:{sessionId:string;sessionTitle:string;sessionDate:string;round:RoundDraft;onChange:(update:(round:RoundDraft)=>RoundDraft)=>void;onBack:()=>void;onConfigure:()=>void;viewerId?:string;onCounter?:()=>void;active?:boolean;onPendingChange?:(pending:boolean)=>void}) {
  function findFirstOpen(arrows:ArrowEntry[]=round.arrows) { for (let end=1;end<=round.ends;end++) for (let arrow=1;arrow<=round.arrowsPerEnd;arrow++) if (!arrows.some((item)=>item.end===end&&item.arrow===arrow)) return {end,arrow}; return {end:round.ends,arrow:round.arrowsPerEnd}; }
  const [slot,setSlot]=useState(findFirstOpen);
  const slotRef=useRef(slot);
  const [editingKey,setEditingKey]=useState<string|null>(null);
  const editingKeyRef=useRef<string|null>(null);
  const [correctionOpen,setCorrectionOpen]=useState(false);
  const [saveMessage,setSaveMessage]=useState<string|null>(null);
  const [latestPlotKey,setLatestPlotKey]=useState<string|null>(null);
  const [leaving,setLeaving]=useState(false);
  const [ready,setReady]=useState(!viewerId);
  const [device]=useState(()=>new DeviceScoringRecovery());
  const [devicePreserved,setDevicePreserved]=useState(false);
  const [onlineOnly,setOnlineOnly]=useState(false);
  const [reviewing,setReviewing]=useState(false);
  const reviewGate=useRef(false);
  const [{queue,persistence,configuration,initialChanged,initialRoundId,initialPendingChanged}]=useState(()=>{
    async function confirmation(response:Response):Promise<ArrowSnapshot> {
      const result=await response.json() as {ok?:boolean;snapshot?:ArrowSnapshot;message?:string};
      if(!response.ok||!result.ok||!result.snapshot)throw Error(result.message??"Arrow confirmation unavailable.");
      return result.snapshot;
    }
    const persistence:ReturnType<typeof createArrowPersistence>=createArrowPersistence({initial:round.arrows,requestId:()=>crypto.randomUUID(),
      beforeWrite:()=>{if(viewerId){const preserved=device.persist(queue.recovery(),persistence.recovery());if(device.canNavigate())setDevicePreserved(preserved);}},
      read:async slot=>confirmation(await fetch(`/api/session-arrows?${new URLSearchParams({roundId:round.id,end:String(slot.end),arrow:String(slot.arrow)})}`,
        {credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(15000)})),
      write:async(slot,desired,intent)=>confirmation(await fetch("/api/session-arrows",{method:"POST",credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(15000),
        headers:{"Content-Type":"application/json"},body:JSON.stringify({roundId:round.id,endNumber:slot.end,arrowNumber:slot.arrow,score:desired?.score,plot:desired?.plot,deleted:desired===null,intent})}))});
    const queue:WebArrowQueue=new WebArrowQueue(round.arrows,async(entry):Promise<ArrowSaveResult>=>{
      try {
        return {ok:true,data:await persistence.save(entry)};
      } catch { return {ok:false,message:"The Arrow could not be saved. Check your connection and retry."}; }
    },async(entry)=>{
      try {await persistence.remove(entry);return {ok:true as const};}
      catch {return {ok:false as const,message:"The Arrow deletion could not be confirmed. Use Delete again to reconcile and retry."};}
    },()=>{
      onPendingChange?.(queue.hasUnconfirmed());
      let storageError:string|null=null;
      if(viewerId){try{const preserved=device.persist(queue.recovery(),persistence.recovery());if(device.canNavigate())setDevicePreserved(preserved);}
        catch{if(device.canNavigate())setDevicePreserved(false);storageError="Device recovery could not be saved. Keep this Round open and retry; leaving may lose unconfirmed changes.";}}
      onChange((current)=>({...current,arrows:queue.desiredArrows()}));
      if(device.canNavigate())setSaveMessage(storageError??queue.firstError());
    });
    return {queue,persistence,configuration:JSON.stringify([round.ends,round.arrowsPerEnd,round.division,round.distanceMetres,round.faceDiameterCm,round.faceType]),initialChanged:onChange,initialRoundId:round.id,initialPendingChanged:onPendingChange};
  });
  useEffect(()=>{device.attach();return()=>device.detach();},[device]);
  useEffect(()=>{
    if(!viewerId)return;
    let alive=true,release:(()=>void)|undefined;
    const waiting=new AbortController();
    const project=window.location.origin+":"+(process.env.NEXT_PUBLIC_SUPABASE_URL??"");
    const open=()=>{try{
      const recovery=device.open(window.localStorage,project,viewerId,initialRoundId,configuration);
      if(recovery){persistence.restore(recovery.persistence);
        for(const cell of recovery.queue)persistence.restoreBaseline(cell.identity,cell.confirmed);
        queue.restore(recovery.queue);setDevicePreserved(true);
        initialPendingChanged?.(queue.hasUnconfirmed());
        initialChanged(current=>({...current,arrows:queue.desiredArrows()}));setSaveMessage(queue.firstError());}
      setReady(true);
      if(!recovery)setSaveMessage(null);
    }catch{setSaveMessage("Device recovery could not be read. Stored changes were preserved. Restore storage access and reopen this Round before editing.");}};
    if(!navigator.locks){queueMicrotask(()=>{if(!alive)return;try{
      device.onlineOnly(window.localStorage,project,viewerId,initialRoundId,configuration);setOnlineOnly(true);setReady(true);
    }catch{setSaveMessage("Pending device recovery could not be safely opened. Reopen in a browser supporting Web Locks; stored changes were preserved.");}});return()=>{alive=false;};}
    queueMicrotask(()=>{if(alive)setSaveMessage("Opening device recovery; waiting for any previous editor to finish.");});
    void navigator.locks.request(`arctrack:scoring:${project}:${viewerId}:${initialRoundId}`,{signal:waiting.signal},async lock=>{
      if(!alive)return;
      if(!lock){setSaveMessage("This Round is open for editing in another tab. Close it there and reopen this Round to protect pending changes.");return;}
      await new Promise<void>(resolve=>{release=resolve;open();});
    }).catch(()=>{if(alive)setSaveMessage("Device scoring recovery could not be locked. Reopen this Round to retry.");});
    // The parent keys this component by Round and account; do not reload over local intentions.
    return()=>{alive=false;waiting.abort();void queue.flush().finally(()=>release?.());};
  },[queue,persistence,viewerId,configuration,initialChanged,initialRoundId,device,initialPendingChanged]);
  useDraftGuard(queue.hasUnconfirmed()&&!devicePreserved,"Arrow changes are not safely preserved on this device. Leave and risk losing them?");
  const selected=editingKey===arrowKey(slot.end,slot.arrow)?round.arrows.find((item)=>item.end===slot.end&&item.arrow===slot.arrow)??null:null;
  const latestScore=latestPlottedArrow(round.arrows,latestPlotKey)?.score??null;
  const endHistory=Map.groupBy([...round.arrows].sort((a,b)=>a.end-b.end||a.arrow-b.arrow),(item)=>item.end);
  const newestEnd=Math.max(0,...endHistory.keys());

  function chooseSlot(next:{end:number;arrow:number},explicit=false) { slotRef.current=next; editingKeyRef.current=explicit?arrowKey(next.end,next.arrow):null; setEditingKey(editingKeyRef.current); setCorrectionOpen(false); setSlot(next); }
  function selectNext(arrows:ArrowEntry[]) {
    const currentSlot=slotRef.current;
    const total=round.ends*round.arrowsPerEnd,current=(currentSlot.end-1)*round.arrowsPerEnd+(currentSlot.arrow-1);
    for (let offset=1;offset<=total;offset++) { const index=(current+offset)%total,end=Math.floor(index/round.arrowsPerEnd)+1,arrow=index%round.arrowsPerEnd+1; if (!arrows.some((item)=>item.end===end&&item.arrow===arrow)) { chooseSlot({end,arrow}); return; } }
  }
  async function leave(destination:()=>void) {
    if (leaving||reviewGate.current) return;
    setLeaving(true);
    const route=viewerId?window.location.href:null;
    const settled=await queue.flush();
    if(!device.canNavigate())return;
    if(route&&window.location.href!==route){setLeaving(false);return;}
    if (settled) {
      onChange((current)=>({...current,arrows:queue.confirmedArrows()}));
      destination();
    } else {
      setSaveMessage(queue.firstError()??"Some Arrows have not been saved. Select each failed Arrow and retry.");
      setLeaving(false);
    }
  }
  function handleTarget(plot:Plot) {
    if(!ready||reviewGate.current)return;
    const currentSlot=slotRef.current;
    const key=arrowKey(currentSlot.end,currentSlot.arrow);
    const current=queue.desiredAt(key);
    if (current&&editingKeyRef.current!==key) return;
    chooseSlot(currentSlot);
    const score=scoreFromPlot(plot,round.faceType);
    setLatestPlotKey(key);
    if (current) { queue.edit({...current,score,plot}); return; }
    const entry:ArrowEntry={id:arrowKey(currentSlot.end,currentSlot.arrow),...currentSlot,score,plot,syncState:"saving"};
    queue.edit(entry); selectNext(queue.desiredArrows());
  }
  function correctScore(score:ScoreLabel) { if(!ready||reviewGate.current)return;const currentSlot=slotRef.current; const current=queue.desiredAt(arrowKey(currentSlot.end,currentSlot.arrow)); if (current) queue.edit({...current,score}); setCorrectionOpen(false); }
  function clearPlot() { if(!ready||reviewGate.current)return;const currentSlot=slotRef.current; const current=queue.desiredAt(arrowKey(currentSlot.end,currentSlot.arrow)); if (current?.plot) queue.edit({...current,plot:null}); }
  function removeArrow(removed:ArrowEntry) {
    if(!ready||reviewGate.current)return;
    const remaining=queue.desiredArrows().filter((item)=>item.end!==removed.end||item.arrow!==removed.arrow);
    const nextSelection=nextPlottedArrowSlot(remaining,removed)??findFirstOpen(remaining);
    setSaveMessage(null); chooseSlot(nextSelection);
    queue.delete(arrowKey(removed.end,removed.arrow));
  }
  async function reviewServer() {
    if(reviewGate.current||!ready||leaving)return;
    reviewGate.current=true;setReviewing(true);const route=window.location.href;
    try{
      await queue.flush();const pending=queue.recovery(),selected=pending.slice(0,20);
      if(!selected.length)return;
      const snapshots=new Map<string,ArrowSnapshot>();
      for(const cell of selected)snapshots.set(arrowKey(cell.identity.end,cell.identity.arrow),await persistence.inspect(cell.identity));
      if(!device.canNavigate()||window.location.href!==route)return;
      const describe=(entry:ArrowEntry|null)=>entry?`${entry.score}${entry.plot?` (${entry.plot.x.toFixed(3)}, ${entry.plot.y.toFixed(3)}, face ${entry.plot.faceIndex??1})`:" (no plot)"}`:"deleted";
      const details=selected.map(cell=>{const saved=snapshots.get(arrowKey(cell.identity.end,cell.identity.arrow))!.arrow;
        return `End ${cell.identity.end}, Arrow ${cell.identity.arrow}: device ${describe(cell.desired)} → server ${describe(saved)}`;}).join("\n");
      if(!window.confirm(`Use the freshly read server versions for these ${selected.length} pending slots? This discards their device edits, including plotted positions. Other pending slots remain unchanged. Confirmation uses the existing revision-checked writer to fence older requests.\n\n${details}`))return;
      const reviewed=pending.map(cell=>{const snapshot=snapshots.get(arrowKey(cell.identity.end,cell.identity.arrow));if(!snapshot)return cell;
        persistence.chooseSnapshot(cell.identity,snapshot);return {...cell,confirmed:snapshot.arrow,desired:snapshot.arrow};});
      queue.restore(reviewed);onPendingChange?.(true);
      setDevicePreserved(false);
      if(viewerId)setDevicePreserved(device.persist(queue.recovery(),persistence.recovery()));
      onChange(current=>({...current,arrows:queue.desiredArrows()}));
      for(const cell of selected)queue.retry(arrowKey(cell.identity.end,cell.identity.arrow));
      await queue.flush();
      if(device.canNavigate())setSaveMessage(queue.hasUnconfirmed()?"Some changes still need attention. Server revisions that changed during review were not overwritten.":null);
    }catch{if(device.canNavigate())setSaveMessage("Server review could not be completed. Device recovery was preserved; restore connectivity and retry.");}
    finally{reviewGate.current=false;if(device.canNavigate())setReviewing(false);}
  }

  return <section className={styles.scoringView} aria-labelledby="scoring-title">
    <div className={styles.viewTop}><button type="button" className={styles.backIcon} aria-label="Back to Session" title="Back to Session" disabled={leaving||reviewing} onClick={()=>void leave(onBack)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7"/></svg></button><p>{sessionTitle} · {sessionDate}</p></div>
    <div className={styles.scoreHeading}><div><p className={styles.kicker}>{round.division} · {round.distanceMetres} m · {faceLabel(round.faceType,round.faceDiameterCm)}</p><h2 id="scoring-title">{round.name}</h2><button type="button" className={styles.configureButton} disabled={round.arrows.length>0||leaving} title={round.arrows.length>0?"Round settings cannot change after arrows are recorded":"Configure this empty Round"} onClick={()=>void leave(onConfigure)}>Configure</button></div><div className={styles.current}><span>Current</span><strong>End {slot.end} · Arrow {slot.arrow}</strong></div></div>
    {onCounter&&<button type="button" disabled={reviewing} onClick={onCounter}>Arrow Counter</button>}
    {saveMessage&&<p className={styles.saveError} role="alert">{saveMessage}</p>}
    {onlineOnly&&<p role="status">Device recovery is unavailable in this browser. Wait for server confirmation before leaving; pending edits are protected by a navigation warning.</p>}
    {queue.hasUnconfirmed()&&<p role="status">{queue.firstError()?"Needs attention":devicePreserved?"Locally preserved · synchronizing":"Synchronizing · keep this Round open"} <button type="button" disabled={!ready||reviewing} onClick={()=>queue.retryAll()}>Retry pending changes</button>{viewerId&&<button type="button" disabled={!ready||reviewing} onClick={()=>void reviewServer()}>Review server versions</button>}</p>}
    {queue.hasUnconfirmed()&&<p className={styles.entryHint} role="status">Unsaved edits are shown on the target and included in totals.</p>}
    <div className={styles.totals}><div><span>End {slot.end}</span><strong>{endTotal(round.arrows,slot.end)}</strong></div><div><span>Round</span><strong>{roundTotal(round.arrows)}</strong></div><div><span>Arrow avg.</span><strong>{formatArrowAverage(round.arrows)}</strong></div><div><span>X count</span><strong>{xCount(round.arrows)}</strong></div><div><span>Entered</span><strong>{round.arrows.length}/{round.ends*round.arrowsPerEnd}</strong></div></div>
    <div className={styles.scoringGrid}>
      <div className={styles.targetColumn}>
        <TargetFace arrows={round.arrows} selectedId={selected?.id??null} currentEnd={slot.end} faceType={round.faceType} faceDiameterCm={round.faceDiameterCm} onPlot={handleTarget}/>
        <GroupingExportButton round={round} context={`${sessionTitle} · ${sessionDate}`}/>
      </div>
      <div className={styles.entryPanel}>
        <div className={styles.entryHeading}><div><p className={styles.kicker}>{selected?"Selected arrow":"Ready to score"}</p><h3>End {slot.end} · Arrow {slot.arrow}</h3></div><div className={styles.latestScoreDisplay}><strong className={styles.selectedScore} aria-live="polite">{latestScore===null?"—":latestScore==="X"?"10X":latestScore}</strong><span>Latest score</span></div></div>
        {selected&&<p className={styles.entryHint}>Move its marker on the target, or correct only its recorded score.</p>}
        <div className={styles.arrowStrip} aria-label={`Arrows in end ${slot.end}`}>{Array.from({length:round.arrowsPerEnd},(_,index)=>{const arrow=round.arrows.find((item)=>item.end===slot.end&&item.arrow===index+1);const active=slot.arrow===index+1&&(!arrow||selected!==null);const scoreClass=arrow?styles[`score${arrow.score==="M"?"Miss":arrow.score}`]:"";return <button type="button" key={index} aria-label={`Select Arrow ${index+1}${arrow?`, score ${arrow.score}`:", empty"}${arrow?.syncState==="failed"?", save failed":""}`} aria-pressed={active} className={`${active?styles.arrowChipActive:styles.arrowChip} ${scoreClass}`} onClick={()=>chooseSlot({end:slot.end,arrow:index+1},true)}><strong>{arrow?.score==="X"?"10X":arrow?.score??"—"}</strong>{arrow?.syncState==="failed"&&<span aria-hidden="true">!</span>}</button>;})}</div>
        <div className={styles.endNav}><button type="button" disabled={slot.end===1} onClick={()=>chooseSlot({end:slot.end-1,arrow:1})}>Previous</button><span>End {slot.end} of {round.ends}</span><button type="button" disabled={slot.end===round.ends} onClick={()=>chooseSlot({end:slot.end+1,arrow:1})}>Next</button></div>
        {selected&&<div className={styles.editArea}><div className={styles.editActions}><button type="button" aria-expanded={correctionOpen} onClick={()=>setCorrectionOpen((open)=>!open)}>Correct score</button><button type="button" onClick={clearPlot} disabled={!selected.plot}>Clear marker</button>{selected.syncState==="failed"&&<button type="button" className={styles.retryButton} disabled={reviewing} onClick={()=>{if(!reviewGate.current)queue.retry(arrowKey(selected.end,selected.arrow));}}>Retry save</button>}<button type="button" className={styles.arrowDelete} aria-label={`Delete End ${selected.end}, Arrow ${selected.arrow}`} title="Delete arrow" onClick={()=>removeArrow(selected)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></div>{correctionOpen&&<div className={styles.correctionPanel} aria-label="Correct recorded score">{SCORE_LABELS.map((score)=><button key={score} type="button" aria-pressed={selected.score===score} className={`${styles.correctionOption} ${styles[`score${score==="M"?"Miss":score}`]}`} onClick={()=>correctScore(score)}>{score}</button>)}</div>}</div>}
      </div>
    </div>
    <div className={styles.roundLog}><h3>End history</h3>{endHistory.size===0?<p>No arrows yet. Tap the target to score the first arrow.</p>:<div className={styles.endHistory}>{[...endHistory].map(([end,arrows])=><div key={end} className={`${styles.endHistoryRow} ${slot.end===end||slot.end>newestEnd&&end===newestEnd?styles.endHistoryCurrent:""}`}><strong className={styles.endHistoryNumber}>END {end}</strong><strong className={styles.endHistoryTotal}>{endTotal(round.arrows,end)} pts</strong>{xCount(round.arrows.filter((item)=>item.end===end))>0&&<strong className={styles.endHistoryX}>{xCount(round.arrows.filter((item)=>item.end===end))}X</strong>}<div className={styles.endHistoryScores}>{arrows.map((item)=><button type="button" key={item.arrow} className={`${styles.endHistoryScore} ${selected?.end===item.end&&selected.arrow===item.arrow?styles.endHistoryScoreSelected:""} ${item.syncState==="failed"?styles.endHistoryScoreFailed:""}`} aria-label={`End ${item.end}, Arrow ${item.arrow}: ${item.score}${item.syncState==="failed"?", not saved; select to retry":item.syncState==="saving"?", saving":""}`} aria-pressed={selected?.end===item.end&&selected.arrow===item.arrow} title={item.syncState==="failed"?"Not saved · select to retry":item.syncState==="saving"?"Saving…":`End ${item.end} · Arrow ${item.arrow}`} onClick={()=>chooseSlot({end:item.end,arrow:item.arrow},true)}>{item.score==="X"?"10X":item.score}</button>)}</div></div>)}</div>}</div>
    <ScoringWeather sessionId={sessionId} sessionDate={sessionDate} round={round} collecting={active&&!leaving}/>
    <RoundInsights round={round}/>
  </section>;
}
function faceLabel(faceType:RoundDraft["faceType"],diameter:number) { return faceType==="triple_face"?`${diameter} cm triple face`:faceType==="six_ring"?`${diameter} cm 6-ring face`:`${diameter} cm full face`; }

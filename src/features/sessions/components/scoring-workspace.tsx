"use client";
import { useRef, useState } from "react";
import { removeArrow as removeArrowAction } from "../actions";
import { SCORE_LABELS, arrowKey, endTotal, formatArrowAverage, latestPlottedArrow, nextPlottedArrowSlot, roundTotal, scoreFromPlot, summarizeRoundScores, xCount, type ArrowEntry, type Plot, type RoundDraft, type ScoreLabel } from "../scoring-model";
import { WebArrowQueue, type ArrowSaveResult } from "../web-arrow-queue";
import { TargetFace } from "./target-face";
import { RoundInsights } from "./session-insights";
import styles from "./sessions.module.css";

export function ScoringWorkspace({sessionTitle,sessionDate,round,onChange,onBack,onConfigure}:{sessionTitle:string;sessionDate:string;round:RoundDraft;onChange:(update:(round:RoundDraft)=>RoundDraft)=>void;onBack:()=>void;onConfigure:()=>void}) {
  function findFirstOpen(arrows:ArrowEntry[]=round.arrows) { for (let end=1;end<=round.ends;end++) for (let arrow=1;arrow<=round.arrowsPerEnd;arrow++) if (!arrows.some((item)=>item.end===end&&item.arrow===arrow)) return {end,arrow}; return {end:round.ends,arrow:round.arrowsPerEnd}; }
  const [slot,setSlot]=useState(findFirstOpen);
  const slotRef=useRef(slot);
  const [correctionOpen,setCorrectionOpen]=useState(false);
  const [saveMessage,setSaveMessage]=useState<string|null>(null);
  const [latestPlotKey,setLatestPlotKey]=useState<string|null>(null);
  const [leaving,setLeaving]=useState(false);
  const [queue]=useState(()=>{
    const queue=new WebArrowQueue(round.arrows,async(entry):Promise<ArrowSaveResult>=>{
      try {
        const response=await fetch("/api/session-arrows",{
          method:"POST",credentials:"same-origin",cache:"no-store",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({roundId:round.id,endNumber:entry.end,arrowNumber:entry.arrow,score:entry.score,plot:entry.plot}),
        });
        const result=await response.json() as ArrowSaveResult;
        if (response.ok && result.ok && result.data) return result;
        return {ok:false,message:!result.ok&&result.message?result.message:"The Arrow could not be saved. Check your connection and retry."};
      } catch { return {ok:false,message:"The Arrow could not be saved. Check your connection and retry."}; }
    },async(entry)=>{
      const result=await removeArrowAction({roundId:round.id,endNumber:entry.end,arrowNumber:entry.arrow});
      return result.ok?{ok:true as const}:{ok:false as const,message:`${result.message} Use Delete again to retry.`};
    },()=>{
      onChange((current)=>({...current,arrows:queue.desiredArrows()}));
      setSaveMessage(queue.firstError());
    });
    return queue;
  });
  const selected=round.arrows.find((item)=>item.end===slot.end&&item.arrow===slot.arrow)??null;
  const latestScore=latestPlottedArrow(round.arrows,latestPlotKey)?.score??null;
  const endHistory=Map.groupBy([...round.arrows].sort((a,b)=>a.end-b.end||a.arrow-b.arrow),(item)=>item.end);
  const newestEnd=Math.max(0,...endHistory.keys());
  const scoreSummary=summarizeRoundScores(round.arrows,round.ends);

  function chooseSlot(next:{end:number;arrow:number}) { slotRef.current=next; setCorrectionOpen(false); setSlot(next); }
  function selectNext(arrows:ArrowEntry[]) {
    const currentSlot=slotRef.current;
    const total=round.ends*round.arrowsPerEnd,current=(currentSlot.end-1)*round.arrowsPerEnd+(currentSlot.arrow-1);
    for (let offset=1;offset<=total;offset++) { const index=(current+offset)%total,end=Math.floor(index/round.arrowsPerEnd)+1,arrow=index%round.arrowsPerEnd+1; if (!arrows.some((item)=>item.end===end&&item.arrow===arrow)) { chooseSlot({end,arrow}); return; } }
  }
  async function leave(destination:()=>void) {
    if (leaving) return;
    setLeaving(true);
    const settled=await queue.flush();
    if (settled) {
      onChange((current)=>({...current,arrows:queue.confirmedArrows()}));
      destination();
    } else {
      setSaveMessage(queue.firstError()??"Some Arrows have not been saved. Select each failed Arrow and retry.");
      setLeaving(false);
    }
  }
  function handleTarget(plot:Plot) {
    const currentSlot=slotRef.current;
    const key=arrowKey(currentSlot.end,currentSlot.arrow);
    const score=scoreFromPlot(plot,round.faceType);
    setLatestPlotKey(key);
    const current=queue.desiredAt(key);
    if (current) { queue.edit({...current,score,plot}); return; }
    const entry:ArrowEntry={id:arrowKey(currentSlot.end,currentSlot.arrow),...currentSlot,score,plot,syncState:"saving"};
    queue.edit(entry); selectNext(queue.desiredArrows());
  }
  function correctScore(score:ScoreLabel) { const currentSlot=slotRef.current; const current=queue.desiredAt(arrowKey(currentSlot.end,currentSlot.arrow)); if (current) queue.edit({...current,score}); setCorrectionOpen(false); }
  function clearPlot() { const currentSlot=slotRef.current; const current=queue.desiredAt(arrowKey(currentSlot.end,currentSlot.arrow)); if (current?.plot) queue.edit({...current,plot:null}); }
  function removeArrow(removed:ArrowEntry) {
    const remaining=queue.desiredArrows().filter((item)=>item.end!==removed.end||item.arrow!==removed.arrow);
    const nextSelection=nextPlottedArrowSlot(remaining,removed)??findFirstOpen(remaining);
    setSaveMessage(null); chooseSlot(nextSelection);
    queue.delete(arrowKey(removed.end,removed.arrow));
  }

  return <section className={styles.scoringView} aria-labelledby="scoring-title">
    <div className={styles.viewTop}><button type="button" className={styles.backIcon} aria-label="Back to Session" title="Back to Session" disabled={leaving} onClick={()=>void leave(onBack)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7"/></svg></button><p>{sessionTitle} · {sessionDate}</p></div>
    <div className={styles.scoreHeading}><div><p className={styles.kicker}>{round.division} · {round.distanceMetres} m · {faceLabel(round.faceType,round.faceDiameterCm)}</p><h2 id="scoring-title">{round.name}</h2><button type="button" className={styles.configureButton} disabled={round.arrows.length>0||leaving} title={round.arrows.length>0?"Round settings cannot change after arrows are recorded":"Configure this empty Round"} onClick={()=>void leave(onConfigure)}>Configure</button></div><div className={styles.current}><span>Current</span><strong>End {slot.end} · Arrow {slot.arrow}</strong></div></div>
    {saveMessage&&<p className={styles.saveError} role="alert">{saveMessage}</p>}
    {queue.hasUnconfirmed()&&<p className={styles.entryHint} role="status">Unsaved edits are shown on the target and included in totals.</p>}
    <div className={styles.totals}><div><span>End {slot.end}</span><strong>{endTotal(round.arrows,slot.end)}</strong></div><div><span>Round</span><strong>{roundTotal(round.arrows)}</strong></div><div><span>Arrow avg.</span><strong>{formatArrowAverage(round.arrows)}</strong></div><div><span>X count</span><strong>{xCount(round.arrows)}</strong></div><div><span>Entered</span><strong>{round.arrows.length}/{round.ends*round.arrowsPerEnd}</strong></div></div>
    <div className={styles.scoringGrid}>
      <TargetFace arrows={round.arrows} selectedId={selected?.id??null} currentEnd={slot.end} faceType={round.faceType} faceDiameterCm={round.faceDiameterCm} onPlot={handleTarget}>
        <RoundScoreCard summary={scoreSummary}/>
      </TargetFace>
      <div className={styles.entryPanel}>
        <div className={styles.entryHeading}><div><p className={styles.kicker}>{selected?"Selected arrow":"Ready to score"}</p><h3>End {slot.end} · Arrow {slot.arrow}</h3></div><div className={styles.latestScoreDisplay}><strong className={styles.selectedScore} aria-live="polite">{latestScore===null?"—":latestScore==="X"?"10X":latestScore}</strong><span>Latest score</span></div></div>
        {selected&&<p className={styles.entryHint}>Move its marker on the target, or correct only its recorded score.</p>}
        <div className={styles.arrowStrip} aria-label={`Arrows in end ${slot.end}`}>{Array.from({length:round.arrowsPerEnd},(_,index)=>{const arrow=round.arrows.find((item)=>item.end===slot.end&&item.arrow===index+1);const scoreClass=arrow?styles[`score${arrow.score==="M"?"Miss":arrow.score}`]:"";return <button type="button" key={index} aria-label={`Select Arrow ${index+1}${arrow?`, score ${arrow.score}`:", empty"}${arrow?.syncState==="failed"?", save failed":""}`} aria-pressed={slot.arrow===index+1} className={`${slot.arrow===index+1?styles.arrowChipActive:styles.arrowChip} ${scoreClass}`} onClick={()=>chooseSlot({end:slot.end,arrow:index+1})}><strong>{arrow?.score==="X"?"10X":arrow?.score??"—"}</strong>{arrow?.syncState==="failed"&&<span aria-hidden="true">!</span>}</button>;})}</div>
        <div className={styles.endNav}><button type="button" disabled={slot.end===1} onClick={()=>chooseSlot({end:slot.end-1,arrow:1})}>Previous</button><span>End {slot.end} of {round.ends}</span><button type="button" disabled={slot.end===round.ends} onClick={()=>chooseSlot({end:slot.end+1,arrow:1})}>Next</button></div>
        {selected&&<div className={styles.editArea}><div className={styles.editActions}><button type="button" aria-expanded={correctionOpen} onClick={()=>setCorrectionOpen((open)=>!open)}>Correct score</button><button type="button" onClick={clearPlot} disabled={!selected.plot}>Clear marker</button>{selected.syncState==="failed"&&<button type="button" className={styles.retryButton} onClick={()=>queue.retry(arrowKey(selected.end,selected.arrow))}>Retry save</button>}<button type="button" className={styles.arrowDelete} aria-label={`Delete End ${selected.end}, Arrow ${selected.arrow}`} title="Delete arrow" onClick={()=>removeArrow(selected)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></div>{correctionOpen&&<div className={styles.correctionPanel} aria-label="Correct recorded score">{SCORE_LABELS.map((score)=><button key={score} type="button" aria-pressed={selected.score===score} className={`${styles.correctionOption} ${styles[`score${score==="M"?"Miss":score}`]}`} onClick={()=>correctScore(score)}>{score}</button>)}</div>}</div>}
      </div>
    </div>
    <div className={styles.roundLog}><h3>End history</h3>{endHistory.size===0?<p>No arrows yet. Tap the target to score the first arrow.</p>:<div className={styles.endHistory}>{[...endHistory].map(([end,arrows])=><div key={end} className={`${styles.endHistoryRow} ${slot.end===end||slot.end>newestEnd&&end===newestEnd?styles.endHistoryCurrent:""}`}><strong className={styles.endHistoryNumber}>END {end}</strong><strong className={styles.endHistoryTotal}>{endTotal(round.arrows,end)} pts</strong>{xCount(round.arrows.filter((item)=>item.end===end))>0&&<strong className={styles.endHistoryX}>{xCount(round.arrows.filter((item)=>item.end===end))}X</strong>}<div className={styles.endHistoryScores}>{arrows.map((item)=><button type="button" key={item.arrow} className={`${styles.endHistoryScore} ${selected?.end===item.end&&selected.arrow===item.arrow?styles.endHistoryScoreSelected:""} ${item.syncState==="failed"?styles.endHistoryScoreFailed:""}`} aria-label={`End ${item.end}, Arrow ${item.arrow}: ${item.score}${item.syncState==="failed"?", not saved; select to retry":item.syncState==="saving"?", saving":""}`} aria-pressed={selected?.end===item.end&&selected.arrow===item.arrow} title={item.syncState==="failed"?"Not saved · select to retry":item.syncState==="saving"?"Saving…":`End ${item.end} · Arrow ${item.arrow}`} onClick={()=>chooseSlot({end:item.end,arrow:item.arrow})}>{item.score==="X"?"10X":item.score}</button>)}</div></div>)}</div>}</div>
    <RoundInsights round={round}/>
  </section>;
}
function RoundScoreCard({summary}:{summary:ReturnType<typeof summarizeRoundScores>}) {
  return <section className={styles.scoreSummary} aria-label="Round score summary">
    <h3 className={styles.scoreSummaryTitle}>End scores</h3>
    <div className={styles.scoreSummaryEnds}>{summary.ends.map(({end,score})=><div className={styles.scoreSummaryRow} key={end}><span>End {end}</span><strong>{score===null?"—":score}</strong></div>)}</div>
    <div className={styles.scoreSummaryTotal}><span>Total</span><strong>{summary.total}</strong></div>
  </section>;
}
function faceLabel(faceType:RoundDraft["faceType"],diameter:number) { return faceType==="triple_face"?`${diameter} cm triple face`:faceType==="six_ring"?`${diameter} cm 6-ring face`:`${diameter} cm full face`; }

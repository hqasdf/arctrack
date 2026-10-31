"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { newestRoundsFirst } from "@arc-track/core/round-order";
import { configureEmptyRound, createRoundWithEnds, createSession, deleteRound, deleteSession, updateSessionArrowCount } from "../actions";
import { DIVISIONS, ROUND_PRESETS, TARGET_FACE_OPTIONS, type Division, type RoundPreset } from "../round-presets";
import { formatArrowAverage, roundTotal, type RoundDraft, type SessionDraft, type SessionType, type TargetFaceType } from "../scoring-model";
import { RecentRoundConfigs } from "./recent-round-configs";
import { RoundPresetsPanel } from "./round-presets-panel";
import { SessionCategoryTabs } from "./session-category-tabs";
import { ScoringWorkspace } from "./scoring-workspace";
import { SessionNotesPanel } from "@/features/notes-feedback/session-notes-panel";
import { CoachFeedbackPanel } from "@/features/notes-feedback/coach-feedback-panel";
import { SessionFeedbackHistory } from "./session-feedback-history";
import { confirmDraftNavigation, useDraftGuard } from "@/features/notes-feedback/draft-guard";
import { ArrowCounter } from "@/features/arrow-counter/components/arrow-counter";
import { navigateTraining, TRAINING_NAVIGATION, TRAINING_LOCATION_CHANGED } from "../training-navigation";
import { notifyTrainingPlanProgress } from "@/features/organizations/training-plan-events";
import { sessionSnapshot } from "../session-snapshot";
import styles from "./sessions.module.css";
import {LivePresence} from '@/features/live-coaching/presence';
import { GarminSessionHealth } from '@/features/session-health/garmin-session-health';
import { SessionWeatherHistory } from "@/features/weather/components/session-weather";

type View="sessions"|"new-session"|"session"|"setup"|"scoring"|"counter";
type RoundForm=Omit<RoundDraft,"id"|"roundNumber"|"arrows">;
const today=new Date().toISOString().slice(0,10);
const base=ROUND_PRESETS[3];

export function SessionsWorkspace({initialSessions,trainingPlanContent,viewerId,initialSessionId}:{initialSessions:SessionDraft[];trainingPlanContent?:ReactNode;viewerId?:string;initialSessionId?:string}) {
  const notesDirty=useRef(false);
  const onNotesDirtyChange=useCallback((dirty:boolean)=>{notesDirty.current=dirty;},[]);
  const mayLeaveNotes=()=>confirmDraftNavigation(notesDirty.current);
  const [view,setView]=useState<View>(initialSessions.some(s=>s.id===initialSessionId)?"session":"sessions");
  const [category,setCategory]=useState<SessionType>("training");
  const [sessions,setSessions]=useState(initialSessions);
  const [arrowCountDrafts,setArrowCountDrafts]=useState<Record<string,string>>(()=>Object.fromEntries(initialSessions.map((item)=>[item.id,String(item.arrowCount)])));
  const [activeSessionId,setActiveSessionId]=useState<string|null>(initialSessions.find(s=>s.id===initialSessionId)?.id??null);
  const [activeRoundId,setActiveRoundId]=useState<string|null>(null);
  const [configuringRoundId,setConfiguringRoundId]=useState<string|null>(null);
  const [sessionForm,setSessionForm]=useState<{title:string;date:string;sessionType:SessionType}>({title:"",date:today,sessionType:"training"});
  const [selectedPreset,setSelectedPreset]=useState<string|null>(base.id);
  const [roundForm,setRoundForm]=useState<RoundForm>({name:base.name,division:"Recurve",distanceMetres:base.distanceMetres,ends:base.defaultEnds,arrowsPerEnd:base.defaultArrowsPerEnd,faceDiameterCm:base.faceDiameterCm,faceType:base.faceType});
  const [distanceText,setDistanceText]=useState(String(base.distanceMetres));
  const [pending,setPending]=useState(false);
  const [arrowCountSaving,setArrowCountSaving]=useState(false);
  const [message,setMessage]=useState<string|null>(null);
  const [counterVisited,setCounterVisited]=useState(false),[counterSafe,setCounterSafe]=useState(true);
  const [sessionRevision,setSessionRevision]=useState(0);
  const pendingRounds=useRef(new Set<string>()),editGeneration=useRef(0);
  const counterStorageChange=useCallback((safe:boolean)=>{
    setCounterSafe(safe);if(safe)pendingRounds.current.delete("counter");else pendingRounds.current.add("counter");
  },[]);
  const session=sessions.find((item)=>item.id===activeSessionId)??null;
  const activeRound=session?.rounds.find((round)=>round.id===activeRoundId)??null;
  const latestSessions=useRef(sessions);
  useEffect(()=>{latestSessions.current=sessions;},[sessions]);
  useDraftGuard(view==="new-session"&&(sessionForm.title!==""||sessionForm.sessionType!=="training"||sessionForm.date!==today)||view==="setup",
    "This form has not been submitted. Leave and discard its current configuration?");
  useEffect(()=>{
    if(typeof window==="undefined"||!window.location)return;
    const restore=()=>{
      if(window.location.pathname!=="/sessions")return;
      const query=new URLSearchParams(window.location.search),selected=latestSessions.current.find(item=>item.id===query.get("session"));
      const round=selected?.rounds.find(item=>item.id===query.get("round"));
      if(round&&query.get("tool")==="counter")setCounterVisited(true);
      if(!selected){setActiveSessionId(null);setActiveRoundId(null);setView("sessions");return;}
      setActiveSessionId(selected.id);setActiveRoundId(round?.id??null);setView(round?(query.get("tool")==="counter"?"counter":"scoring"):"session");
    };
    restore();window.addEventListener("popstate",restore);window.addEventListener(TRAINING_NAVIGATION,restore);
    return()=>{window.removeEventListener("popstate",restore);window.removeEventListener(TRAINING_NAVIGATION,restore);};
  },[]);
  useEffect(()=>{
    if(!viewerId||typeof window==="undefined"||!window.location)return;
    let alive=true,last=Date.now(),request:AbortController|null=null;
    const refresh=async()=>{
      if(document.visibilityState!=="visible"||request||pendingRounds.current.size||Date.now()-last<60000)return;
      const query=new URLSearchParams(window.location.search),id=query.get("session");
      if(!id||!query.get("round"))return;
      const cached=latestSessions.current.find(item=>item.id===id);if(!cached)return;
      const generation=editGeneration.current,abort=new AbortController();request=abort;
      try{
        const response=await fetch(`/api/sessions/${encodeURIComponent(id)}`,{cache:"no-store",credentials:"same-origin",signal:abort.signal});
        if(!alive||abort.signal.aborted||generation!==editGeneration.current||pendingRounds.current.size||new URLSearchParams(window.location.search).get("session")!==id)return;
        if(response.status===401){setSessions([]);setActiveSessionId(null);setActiveRoundId(null);setView("sessions");setMessage("Sign-in must be verified before Session data can be shown. Device changes were preserved.");return;}
        if(response.status===404){setSessions(current=>current.filter(item=>item.id!==id));setView("sessions");setActiveSessionId(null);setActiveRoundId(null);navigateTraining();setMessage("This Session is no longer available. Device recovery was preserved.");return;}
        const result=await response.json() as {session?:SessionDraft};
        if(!response.ok||!result.session||result.session.id!==id||!Array.isArray(result.session.rounds))throw Error();
        if(!alive||generation!==editGeneration.current||pendingRounds.current.size||new URLSearchParams(window.location.search).get("session")!==id)return;
        last=Date.now();setMessage(null);
        if(sessionSnapshot(cached)!==sessionSnapshot(result.session)){
          const updated=result.session;setSessions(current=>current.map(item=>item.id===id?updated:item));setSessionRevision(value=>value+1);
        }
      }catch{if(alive&&!abort.signal.aborted)setMessage("Session refresh is unavailable. Loaded scores and device recovery remain visible; saving still verifies server revisions.");}
      finally{if(request===abort)request=null;}
    };
    const run=()=>{void refresh();};
    window.addEventListener("focus",run);window.addEventListener("online",run);window.addEventListener(TRAINING_LOCATION_CHANGED,run);document.addEventListener("visibilitychange",run);
    return()=>{alive=false;request?.abort();window.removeEventListener("focus",run);window.removeEventListener("online",run);window.removeEventListener(TRAINING_LOCATION_CHANGED,run);document.removeEventListener("visibilitychange",run);};
  },[viewerId]);

  function choosePreset(preset:RoundPreset) {
    const target=defaultTarget(preset.distanceMetres,roundForm.division,{faceDiameterCm:preset.faceDiameterCm,faceType:preset.faceType});
    setSelectedPreset(preset.id==="custom"?null:preset.id);
    setDistanceText(String(preset.distanceMetres));
    setRoundForm((current)=>({...current,name:preset.name,distanceMetres:preset.distanceMetres,ends:preset.defaultEnds,arrowsPerEnd:preset.defaultArrowsPerEnd,...target}));
  }
  function changeDistance(distanceMetres:number) { setRoundForm((current)=>({...current,distanceMetres,...defaultTarget(distanceMetres,current.division,{faceDiameterCm:current.faceDiameterCm,faceType:current.faceType})})); }
  function editDistance(value:string) {
    setDistanceText(value);
    if (!/^\d+$/.test(value)) return;
    const distanceMetres=Number(value);
    if (Number.isSafeInteger(distanceMetres)&&distanceMetres>0&&distanceMetres<=32767) changeDistance(distanceMetres);
  }
  function changeDivision(division:Division) { setRoundForm((current)=>current.distanceMetres===50&&division==="Compound"?{...current,division,faceDiameterCm:80,faceType:"six_ring"}:{...current,division}); }
  function chooseTargetOption(id:string) { const option=TARGET_FACE_OPTIONS.find((item)=>item.id===id); if (option) setRoundForm((current)=>({...current,faceDiameterCm:option.diameterCm,faceType:option.faceType})); }

  async function submitSession(event:React.FormEvent) {
    editGeneration.current++;
    event.preventDefault(); setPending(true); setMessage(null);
    const result=await createSession(sessionForm); setPending(false);
    if (!result.ok) { setMessage(result.message); return; }
    setSessions((current)=>[result.data,...current]); setArrowCountDrafts((current)=>({...current,[result.data.id]:String(result.data.arrowCount)})); setActiveSessionId(result.data.id); setView("session"); setSessionForm({title:"",date:today,sessionType:"training"});
    navigateTraining(result.data.id);
  }
  async function submitRound(event:React.FormEvent) {
    event.preventDefault();
    await createRound(configuringRoundId);
  }
  async function createRound(replaceRoundId:string|null=null) {
    editGeneration.current++;
    if (!session) return; setMessage(null);
    if (!/^\d+$/.test(distanceText)||!Number.isSafeInteger(Number(distanceText))||Number(distanceText)<1||Number(distanceText)>32767) { setMessage("Enter a valid positive distance before continuing."); return; }
    const oldRound=replaceRoundId?session.rounds.find((round)=>round.id===replaceRoundId):null;
    if (replaceRoundId&&!oldRound) { setMessage("This Round is no longer available."); setView("session"); return; }
    if (oldRound&&oldRound.arrows.length>0) { setMessage("Round settings cannot be changed after arrows are recorded."); return; }
    setPending(true);
    const input={sessionId:session.id,...roundForm,distanceMetres:Number(distanceText)};
    const result=oldRound?await configureEmptyRound(oldRound.id,{name:oldRound.name,division:oldRound.division,distanceMetres:oldRound.distanceMetres,
      faceDiameterCm:oldRound.faceDiameterCm,faceType:oldRound.faceType,ends:oldRound.ends,arrowsPerEnd:oldRound.arrowsPerEnd},input):await createRoundWithEnds(input);
    setPending(false);
    if (!result.ok) {
      if (oldRound) {
        setMessage(result.message);
        return;
      }
      setMessage(result.message); return;
    }
    setSessions((current)=>current.map((item)=>item.id===session.id?{...item,rounds:newestRoundsFirst(oldRound?item.rounds.map((round)=>round.id===oldRound.id?result.data:round):[...item.rounds,result.data])}:item));
    setActiveRoundId(result.data.id); setConfiguringRoundId(null); setView("scoring");navigateTraining(session.id,result.data.id);
  }
  async function startRound() { if (!mayLeaveNotes()) return; setConfiguringRoundId(null); await createRound(); }
  function configureRound(round:RoundDraft) {
    if (round.arrows.length>0) return;
    setConfiguringRoundId(round.id); setRoundForm({name:round.name,division:round.division,distanceMetres:round.distanceMetres,ends:round.ends,arrowsPerEnd:round.arrowsPerEnd,faceDiameterCm:round.faceDiameterCm,faceType:round.faceType}); setDistanceText(String(round.distanceMetres));
    setSelectedPreset(ROUND_PRESETS.find((preset)=>preset.name===round.name&&preset.distanceMetres===round.distanceMetres)?.id??null); setMessage(null); setView("setup");
  }
  function updateRound(roundId:string,update:(round:RoundDraft)=>RoundDraft) {
    editGeneration.current++;
    setSessions((current)=>current.map((item)=>item.id===activeSessionId?{...item,rounds:item.rounds.map((round)=>round.id===roundId?update(round):round)}:item));
  }
  async function removeRound(roundId:string) {
    editGeneration.current++;
    setMessage(null); const result=await deleteRound(roundId); if (!result.ok) { setMessage(result.message); return; }
    setSessions((current)=>current.map((item)=>item.id===activeSessionId?{...item,rounds:item.rounds.filter((round)=>round.id!==roundId)}:item));
  }
  async function removeSession(sessionId:string) {
    editGeneration.current++;
    if (!mayLeaveNotes()) return;
    setMessage(null); const result=await deleteSession(sessionId); if (!result.ok) { setMessage(result.message); return; }
    setSessions((current)=>current.filter((item)=>item.id!==sessionId)); setActiveSessionId(null); setView("sessions");
  }
  async function saveSessionArrowCount() {
    editGeneration.current++;
    if (!session) return;
    const value=arrowCountDrafts[session.id]??String(session.arrowCount);
    if (!/^\d+$/.test(value)) { setMessage("Arrow count must be a non-negative whole number."); return; }
    setArrowCountSaving(true); setMessage(null);
    const result=await updateSessionArrowCount({sessionId:session.id,arrowCount:Number(value)}); setArrowCountSaving(false);
    if (!result.ok) { setMessage(result.message); return; }
    setSessions((current)=>current.map((item)=>item.id===session.id?{...item,arrowCount:result.data}:item));
    setArrowCountDrafts((current)=>({...current,[session.id]:String(result.data)}));
  }
  function openSession(item:SessionDraft) { if (!mayLeaveNotes()) return; setActiveSessionId(item.id); setActiveRoundId(null); setMessage(null); setView("session");navigateTraining(item.id); }
  const trainingSessions=sessions.filter((item)=>item.sessionType==="training");
  const competitionSessions=sessions.filter((item)=>item.sessionType==="competition");

  if ((view==="scoring"||view==="counter")&&session&&activeRound) return <>{viewerId&&<LivePresence scoringSessionId={session.id}/>}{message&&<p role="status">{message}</p>}<div hidden={view!=="scoring"}><ScoringWorkspace key={`${activeRound.id}:${sessionRevision}`} onPendingChange={pending=>{if(pending)pendingRounds.current.add(activeRound.id);else pendingRounds.current.delete(activeRound.id);}} active={view==="scoring"} viewerId={viewerId} sessionId={session.id} sessionTitle={session.title} sessionDate={session.date} round={activeRound} onChange={(update)=>updateRound(activeRound.id,update)} onBack={()=>{setView("session");navigateTraining(session.id);notifyTrainingPlanProgress();}} onCounter={()=>{setCounterVisited(true);setView("counter");navigateTraining(session.id,activeRound.id,true);}} onConfigure={()=>configureRound(activeRound)}/></div>{counterVisited&&<div hidden={view!=="counter"}><button type="button" disabled={!counterSafe} onClick={()=>{setView("scoring");navigateTraining(session.id,activeRound.id);}}>Continue Scoring</button><ArrowCounter onStorageChange={counterStorageChange}/></div>}</>;
  const sessionDetails = session ? <>
      <div className={styles.sessionArrowCount}><label htmlFor={`session-arrow-count-${session.id}`}><span>Arrow count</span><input id={`session-arrow-count-${session.id}`} required type="text" inputMode="numeric" pattern="[0-9]*" value={arrowCountDrafts[session.id]??String(session.arrowCount)} onChange={(event)=>{if (/^\d*$/.test(event.target.value)) setArrowCountDrafts((current)=>({...current,[session.id]:event.target.value}));}}/></label><button type="button" disabled={arrowCountSaving} onClick={saveSessionArrowCount}>{arrowCountSaving?"Saving…":"Save"}</button></div>
      <SessionWeatherHistory sessionId={session.id}/>
  </> : null;
  const roundCards = session ? (session.rounds.length===0?<div className={styles.emptyRounds}><h3>Ready to shoot?</h3><p>Start a Round with the current settings. You can configure an empty Round from the scoring screen.</p></div>:<div className={styles.roundCards}>{session.rounds.map((round)=><article key={round.id} className={styles.roundCard}><div><p className={styles.kicker}>{round.division}</p><h3>{round.name}</h3><p>{round.distanceMetres} m · {round.ends} ends × {round.arrowsPerEnd} arrows</p><p className={styles.roundScore}>Score: <strong>{roundTotal(round.arrows)}</strong> <span>· Arrow avg. <strong>{formatArrowAverage(round.arrows)}</strong></span></p></div><div className={styles.cardActions}><button type="button" onClick={()=>{if(!mayLeaveNotes())return;setActiveRoundId(round.id);setView("scoring");navigateTraining(session.id,round.id);}}>Open</button><button type="button" className={styles.dangerText} onClick={()=>removeRound(round.id)}>Delete</button></div></article>)}</div>) : null;
  return <>{view!=="sessions"&&trainingPlanContent}<section className={styles.workspace}>
    {message&&<p className={styles.saveError} role="alert">{message}</p>}
    {view==="sessions"&&viewerId&&<SessionFeedbackHistory key={viewerId} viewerId={viewerId}/>}
    {view==="sessions"&&<SessionCategoryTabs category={category} onCategoryChange={setCategory} toolbar={<div className={styles.sessionHeading}><div><h2>{sessions.length?"Your saved Sessions":"Start today’s scorecard"}</h2><p>{sessions.length?"Open a Session or start another scorecard.":"Create a Session, then add as many Rounds as you need."}</p></div><button className={styles.primary} type="button" onClick={()=>setView("new-session")}>New Session</button></div>} training={<>{trainingPlanContent}<SessionSection heading="Training" emptyMessage="No Training Sessions yet." sessions={trainingSessions} onOpen={openSession} onDelete={removeSession}/></>} competition={<SessionSection heading="Competition" emptyMessage="No Competitions yet." sessions={competitionSessions} onOpen={openSession} onDelete={removeSession}/>}/>}
    {view==="new-session"&&<form className={styles.formCard} onSubmit={submitSession}>
      <div className={styles.viewTop}><button type="button" className={styles.textButton} onClick={()=>{if(mayLeaveNotes()){setView("sessions");navigateTraining();}}}>← Sessions</button><p>New Session</p></div><h2>Create a Session</h2><p className={styles.formIntro}>Choose how this Session should appear in your journal.</p>
      <fieldset className={styles.sessionTypeChoice}><legend>Session type</legend><label><input type="radio" name="session-type" value="training" checked={sessionForm.sessionType==="training"} onChange={()=>setSessionForm({...sessionForm,sessionType:"training"})}/><span>Training Session</span></label><label><input type="radio" name="session-type" value="competition" checked={sessionForm.sessionType==="competition"} onChange={()=>setSessionForm({...sessionForm,sessionType:"competition"})}/><span>Competition</span></label></fieldset>
      <div className={styles.formGrid}><label><span>Session date</span><input required type="date" value={sessionForm.date} onChange={(e)=>setSessionForm({...sessionForm,date:e.target.value})}/></label><label><span>{sessionForm.sessionType==="competition"?"Competition name":"Title"} <small>optional</small></span><input type="text" maxLength={80} placeholder={sessionForm.sessionType==="competition"?"National Championships":"Evening practice"} value={sessionForm.title} onChange={(e)=>setSessionForm({...sessionForm,title:e.target.value})}/></label></div>
      <button className={styles.primary} disabled={pending} type="submit">{pending?"Saving…":"Create Session"}</button>
    </form>}
    {view==="session"&&session&&<div>
      <header className={styles.sessionHeader}>
      <div className={styles.viewTop}><button type="button" className={styles.textButton} onClick={()=>{if(mayLeaveNotes()){setView("sessions");navigateTraining();}}}>← Sessions</button><p>{session.date}</p></div>
      <div className={styles.sessionHeading}><div><p className={styles.kicker}>{session.sessionType==="competition"?"Competition":"Training Session"}</p><h2>{session.title}</h2></div><button className={styles.primary} type="button" disabled={pending} onClick={()=>void startRound()}>{pending?"Starting…":"Start Round"}</button></div>
      </header>
      <div className={styles.sessionLayout}>
      <section className={styles.detailsPanel}><h3>Session Details</h3>{sessionDetails}</section>
<section className={styles.scoringRounds} aria-labelledby={`scoring-rounds-${session.id}`}><div className={styles.roundsHeading}><h3 id={`scoring-rounds-${session.id}`}>Scoring Rounds</h3><span>{session.rounds.length} {session.rounds.length===1?"Round":"Rounds"}</span></div>
      {roundCards}
      </section>
      {viewerId&&<SessionNotesPanel key={`notes:${viewerId}:${session.id}`} context={{viewerId,sessionId:session.id}} onDirtyChange={onNotesDirtyChange}/>}
      {viewerId&&<GarminSessionHealth key={`health:${viewerId}:${session.id}`} sessionId={session.id}/>}
      {viewerId&&<CoachFeedbackPanel key={`feedback:${viewerId}:${session.id}`} context={{viewerId,sessionId:session.id}} activeMembershipOnly/>}
      </div>
    </div>}
    {view==="setup"&&session&&<form className={styles.formCard} onSubmit={submitRound}>
      <div className={styles.viewTop}><button type="button" className={styles.textButton} onClick={()=>{setConfiguringRoundId(null);setView(activeRoundId?"scoring":"session");}}>← {activeRoundId?"Scoring":"Session"}</button><p>Round setup</p></div><h2>Configure Round</h2><p className={styles.formIntro}>Presets are starting points. Adjust anything to match what you are shooting.</p><RoundPresetsPanel selectedId={selectedPreset} onSelect={choosePreset}/>
      {viewerId&&<RecentRoundConfigs key={viewerId} userId={viewerId} disabled={pending} onSelect={(config)=>{setRoundForm(config);setDistanceText(String(config.distanceMetres));setSelectedPreset(null);setMessage(null);}}/>}
      <div className={styles.formGrid}><label className={styles.fullField}><span>Round name</span><input required value={roundForm.name} onChange={(e)=>setRoundForm({...roundForm,name:e.target.value})}/></label><label><span>Division</span><select value={roundForm.division} onChange={(e)=>changeDivision(e.target.value as Division)}>{DIVISIONS.map((item)=><option key={item}>{item}</option>)}</select></label><DistanceField value={distanceText} onChange={editDistance}/><DirectNumberField label="Number of Ends" value={roundForm.ends} onChange={(value)=>setRoundForm({...roundForm,ends:value})}/><DirectNumberField label="Arrows per End" value={roundForm.arrowsPerEnd} onChange={(value)=>setRoundForm({...roundForm,arrowsPerEnd:value})}/><label className={styles.fullField}><span>Target face option</span><select value={TARGET_FACE_OPTIONS.find((item)=>item.diameterCm===roundForm.faceDiameterCm&&item.faceType===roundForm.faceType)?.id??"custom"} onChange={(e)=>chooseTargetOption(e.target.value)}><option value="custom" disabled>Custom target settings</option>{TARGET_FACE_OPTIONS.map((item)=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label><NumberField label="Target face diameter (cm)" value={roundForm.faceDiameterCm} onChange={(value)=>setRoundForm({...roundForm,faceDiameterCm:value})}/><label><span>Target face layout</span><select value={roundForm.faceType} onChange={(e)=>setRoundForm({...roundForm,faceType:e.target.value as TargetFaceType})}><option value="full_face">Full face</option><option value="six_ring">6-ring face</option><option value="triple_face">Triple face</option></select></label></div>
      <button className={styles.primary} disabled={pending} type="submit">{pending?"Creating Ends…":configuringRoundId?"Save settings and start scoring":"Start scoring"}</button>
    </form>}
  </section></>;
}
function SessionSection({heading,emptyMessage,sessions,onOpen,onDelete}:{heading:string;emptyMessage:string;sessions:SessionDraft[];onOpen:(session:SessionDraft)=>void;onDelete:(id:string)=>void}) {
  return <section aria-labelledby={`session-section-${heading.toLowerCase()}`}><h3 id={`session-section-${heading.toLowerCase()}`} className={styles.sessionSectionTitle}>{heading}</h3>{sessions.length===0?<p className={styles.sessionSectionEmpty}>{emptyMessage}</p>:<div className={styles.roundCards}>{sessions.map((item)=><article key={item.id} className={styles.roundCard}><div><p className={styles.kicker}>{item.date}</p><h3>{item.title}</h3><p>{item.rounds.length} {item.rounds.length===1?"Round":"Rounds"}</p><p>Arrow count: <strong>{item.arrowCount}</strong></p></div><div className={styles.cardActions}><button type="button" onClick={()=>onOpen(item)}>Open</button><button type="button" className={styles.dangerText} onClick={()=>onDelete(item.id)}>Delete</button></div></article>)}</div>}</section>;
}
function NumberField({label,value,onChange}:{label:string;value:number;onChange:(value:number)=>void}) { return <label><span>{label}</span><input required type="number" min="1" step="1" value={value} onChange={(e)=>onChange(Math.max(1,Number(e.target.value)))}/></label>; }
function DistanceField({value,onChange}:{value:string;onChange:(value:string)=>void}) { return <label><span>Distance (m)</span><input type="text" inputMode="numeric" value={value} onChange={(event)=>onChange(event.target.value)}/></label>; }
function DirectNumberField({label,value,onChange}:{label:string;value:number;onChange:(value:number)=>void}) {
  const [editingText,setEditingText]=useState<string|null>(null);
  const text=editingText??String(value);
  return <label><span>{label}</span><input required type="text" inputMode="numeric" pattern="[0-9]*" value={text} onFocus={()=>setEditingText(String(value))} onChange={(event)=>{const next=event.target.value;if (!/^\d*$/.test(next)) return;setEditingText(next);if (next!=="") onChange(Number(next));}} onBlur={()=>setEditingText(null)}/></label>;
}
function defaultTarget(distanceMetres:number,division:Division,fallback:{faceDiameterCm:number;faceType:TargetFaceType}) { if (distanceMetres===70) return {faceDiameterCm:122,faceType:"full_face" as const}; if (distanceMetres===50&&division==="Compound") return {faceDiameterCm:80,faceType:"six_ring" as const}; if (distanceMetres===18) return {faceDiameterCm:40,faceType:"full_face" as const}; return fallback; }

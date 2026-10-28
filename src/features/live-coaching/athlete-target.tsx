'use client';
import {useMemo,useState} from 'react';
import {GroupingTarget} from '../sessions/components/session-insights';
import {calculateRoundGroupingInsights} from '../sessions/session-insights-model';
import type {RoundDraft} from '../sessions/scoring-model';
import styles from './monitoring-dashboard.module.css';

/** Read-only use of the same target faces and normalised coordinates as Session insights. */
export default function AthleteTarget({rounds}:{rounds:RoundDraft[]}){
 const [roundId,setRound]=useState(rounds[0]?.id??''),[end,setEnd]=useState('all');
 const round=rounds.find(r=>r.id===roundId)??rounds[0];
 const shown=useMemo(()=>round?{...round,arrows:round.arrows.filter(a=>(end==='all'||a.end===Number(end))&&a.syncState!=='failed'&&a.syncState!=='saving')}:null,[round,end]);
 const grouping=useMemo(()=>shown?calculateRoundGroupingInsights(shown):null,[shown]);
 if(!shown||!grouping)return <p className={styles.empty}>No Round available for plotting.</p>;
 return <div><div className={styles.plotControls}><label>Plot Round<select value={shown.id} onChange={e=>{setRound(e.target.value);setEnd('all');}}>{rounds.map(r=><option key={r.id} value={r.id}>{r.name} · {r.distanceMetres} m</option>)}</select></label><label>Plot End<select value={end} onChange={e=>setEnd(e.target.value)}><option value='all'>All available arrows</option>{Array.from({length:shown.ends},(_,i)=><option key={i} value={i+1}>End {i+1}</option>)}</select></label></div>
 <div className={styles.targetPlot}><GroupingTarget round={shown} grouping={grouping}/></div><p className={styles.muted}>{grouping.arrows.length} recorded placements · {grouping.missingPlotCount} arrows without coordinates. {grouping.unassignedTripleCount>0?`${grouping.unassignedTripleCount} triple-face placements have no face assignment and are excluded.`:''} Scores alone never create a placement.</p></div>;
}

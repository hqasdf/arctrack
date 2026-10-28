'use client';
import {memo,useMemo,useState} from 'react';
import {hrGeometry,type HrHistory,type EndActivity} from '../monitor-model';
import styles from '../monitoring-dashboard.module.css';
const clockFormatter=new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const time=(value:string)=>clockFormatter.format(new Date(value));
const HeartRateChart=memo(function HeartRateChart({history,markers=[],compact=false}:{history?:HrHistory;markers?:EndActivity[];compact?:boolean}){
 const geometry=useMemo(()=>hrGeometry(history?.points??[]),[history]);
 const visibleDots=useMemo(()=>{if(!compact)return geometry.dots;const counts=new Map<number,number>();for(const dot of geometry.dots)counts.set(dot.point.segment,(counts.get(dot.point.segment)??0)+1);return geometry.dots.filter(dot=>counts.get(dot.point.segment)===1);},[geometry,compact]);
 const [showMarkers,setShowMarkers]=useState(false);
 if(!geometry.dots.length)return <p className={styles.empty}>No retained HR readings for this interval. Live sharing alone does not retain a timeline.</p>;
 const label=compact?'Recent recorded HR':'Recorded heart rate over time';
 return <div className={styles.chart}>
  {!compact&&<><div className={styles.stats}><span>Minimum <strong>{history!.minimum} BPM</strong></span><span>Average <strong>{history!.average} BPM</strong></span><span>Maximum <strong>{history!.maximum} BPM</strong></span></div><label className={styles.checkbox}><input type='checkbox' checked={showMarkers} onChange={e=>setShowMarkers(e.target.checked)}/>Show recorded end updates</label></>}
  <svg viewBox='0 0 600 130' role='img' aria-label={label}><title>{label}</title><desc>Actual retained samples. Gaps and sensor changes split the line. No interpolated measurements.</desc>
   {!compact&&<><text x='2' y='16'>{geometry.max}</text><text x='2' y='122'>{geometry.min}</text><line x1='20' y1='106' x2='580' y2='106' className={styles.axis}/></>}
   {geometry.paths.map((path,i)=><path key={i} d={path} className={styles.hrLine}/>)}
   {visibleDots.map(({x,y,point},i)=><circle key={i} cx={x} cy={y} r={compact?2:3} className={styles.hrDot}><title>{time(point.at)+' SGT - '+point.bpm+' BPM'}</title></circle>)}
   {!compact&&showMarkers&&markers.filter(e=>e.confirmedAt&&Date.parse(e.confirmedAt)>=geometry.start&&Date.parse(e.confirmedAt)<=geometry.end).map(e=>{const x=20+(Date.parse(e.confirmedAt!)-geometry.start)/Math.max(1000,geometry.end-geometry.start)*560;return <line key={e.roundId+e.end} x1={x} x2={x} y1='20' y2='106' className={styles.marker}><title>{'End '+e.end+' latest confirmed update '+time(e.confirmedAt!)+' SGT'}</title></line>;})}
  </svg>
  {!compact&&<><div className={styles.chartLabels}><span>{time(new Date(geometry.start).toISOString())}</span><span>{time(new Date(geometry.end).toISOString())} SGT</span></div><p className={styles.muted}>{history!.count} retained samples in this interval; at most one actual reading per second. The display is bounded to 724 points. Statistics describe retained samples, not continuous physiology.</p><p className={styles.muted}>End markers are the latest observed confirmed scoring updates, including corrections. They are not shot timestamps; comparisons are exploratory.</p><details><summary>Accessible HR sample table</summary><div className={styles.tableWrap}><table><caption>Displayed actual HR readings</caption><thead><tr><th>Received (SGT)</th><th>BPM</th><th>Signal segment</th></tr></thead><tbody>{geometry.dots.map(({point},i)=><tr key={i}><td>{time(point.at)}</td><td>{point.bpm}</td><td>{point.segment}</td></tr>)}</tbody></table></div></details></>}
 </div>;
});

export default HeartRateChart;

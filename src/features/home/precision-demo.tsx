"use client";

import { useState } from "react";
import { arrowAverage, roundTotal, scoreFromPlot, xCount, type ArrowEntry } from "@arc-track/core/scoring";
import styles from "./home.module.css";

const samples = [
  [{ x: -.07, y: -.025 }, { x: -.045, y: -.06 }, { x: .015, y: -.08 }, { x: .065, y: -.035 }, { x: .07, y: .03 }, { x: -.025, y: .065 }],
  [{ x: -.065, y: .035 }, { x: -.02, y: .075 }, { x: .04, y: .065 }, { x: .08, y: .005 }, { x: .04, y: -.06 }, { x: -.035, y: -.07 }],
] as const;
const rings = ["#f4f1e9", "#f4f1e9", "#202020", "#202020", "#49a4cf", "#49a4cf", "#e65a55", "#e65a55", "#f5cf3d", "#f5cf3d"];

export function PrecisionDemo() {
  const [selected, setSelected] = useState(0);
  const arrows: ArrowEntry[] = samples[selected].map((plot, i) => ({ id: `sample-${i}`, end: 1, arrow: i + 1, score: scoreFromPlot(plot), plot }));
  return <div className={styles.demo}>
    <div className={styles.demoHeader}><span>ROUND INSIGHTS</span><span className={styles.sampleLabel}>Illustrative data</span></div>
    <div className={styles.demoBody}>
      <svg viewBox="-110 -110 220 220" role="img" aria-label={`Sample End ${selected + 1} target: ${arrows.map(arrow => arrow.score).join(", ")}`}>
        {rings.map((fill, i) => <circle key={i} r={100 - i * 10} fill={fill} stroke="#302d27" strokeWidth=".5" />)}
        <circle r="5" fill="none" stroke="#55421a" strokeWidth=".5" />
        {arrows.map(arrow => <circle key={arrow.id} cx={arrow.plot!.x * 100} cy={arrow.plot!.y * 100} r="1.6" fill="#f1e8df" stroke="#382a24" strokeWidth="1.2" />)}
      </svg>
      <div className={styles.demoScores}>
        <p className={styles.eyebrow}>End {selected + 1} · 6 Arrows</p>
        <p className={styles.demoTotal}>{roundTotal(arrows)}<span> / 60</span></p>
        <div className={styles.scoreDots}>{arrows.map(arrow => <span key={arrow.id}>{arrow.score}</span>)}</div>
        <dl><div><dt>Average / Arrow</dt><dd>{arrowAverage(arrows)?.toFixed(2)}</dd></div><div><dt>X count</dt><dd>{xCount(arrows)}</dd></div></dl>
        <div className={styles.demoTabs} role="group" aria-label="Choose a sample End">{[0, 1].map(index => <button key={index} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}>End {index + 1}</button>)}</div>
        <p className={styles.demoNote}>Explore a sample. Your actual records stay private.</p>
      </div>
    </div>
  </div>;
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { chartAxis, chartTick, type ChartAxisKind } from "@arc-track/core/chart-axis";
import styles from "./coach.module.css";

function useChartReveal(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const revealed = useRef(false);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || revealed.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      revealed.current = true;
      element.classList.add(styles.chartReveal);
      observer.disconnect();
    }, { threshold: 0.15 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);
  return ref;
}

export type BarPoint = { label: string; value: number; tooltip: string; secondary?: number; href?: string };
function axisKind(label: string): ChartAxisKind {
  return label.includes("%") || label === "Percent" ? "percentage" : label.includes("Avg") ? "score" : label.includes("cm") ? "measurement" : "count";
}
export function VerticalBarChart({ points, yLabel, secondaryLabel }: { points: BarPoint[]; yLabel: string; secondaryLabel?: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (!points.length) return null;
  const kind = axisKind(yLabel);
  const { max, ticks } = chartAxis(points.flatMap((point) => [point.value, ...(point.secondary === undefined ? [] : [point.secondary])]), kind, true);
  const width = Math.max(280, points.length * 44);
  return <div className={styles.chartScroll}><div className={styles.chartFrame} style={{ minWidth: width }}>
    <span className={styles.axisName}>{yLabel}</span>
    <div className={styles.verticalPlot}>
      <div className={styles.yTicks}>{ticks.slice().reverse().map((tick) => <span key={tick}>{chartTick(tick, kind)}</span>)}</div>
      <div className={styles.columnGrid}>{points.map((point, index) => <div className={styles.columnSlot} key={`${point.label}-${index}`}>
        <div className={styles.columnHeight}>
          {point.href ? <Link href={point.href} className={styles.column} style={{ height: `${point.value / max * 100}%` }} title={point.tooltip} aria-label={`${point.tooltip}. Open athlete`} onMouseEnter={() => setSelected(point.tooltip)} onMouseLeave={() => setSelected(null)} onFocus={() => setSelected(point.tooltip)} onBlur={() => setSelected(null)}/> : <span className={styles.column} style={{ height: `${point.value / max * 100}%` }} title={point.tooltip} aria-label={point.tooltip} tabIndex={0} onMouseEnter={() => setSelected(point.tooltip)} onMouseLeave={() => setSelected(null)} onFocus={() => setSelected(point.tooltip)} onBlur={() => setSelected(null)}/>}
          {point.secondary !== undefined && <span className={`${styles.column} ${styles.secondaryColumn}`} style={{ height: `${point.secondary / max * 100}%` }} title={`${point.label}: ${secondaryLabel ?? "Secondary"} ${point.secondary.toFixed(1)}`} aria-label={`${point.label}: ${secondaryLabel ?? "Secondary"} ${point.secondary.toFixed(1)}`} tabIndex={0} onMouseEnter={() => setSelected(`${point.label}: ${secondaryLabel ?? "Secondary"} ${point.secondary!.toFixed(1)}`)} onMouseLeave={() => setSelected(null)} onFocus={() => setSelected(`${point.label}: ${secondaryLabel ?? "Secondary"} ${point.secondary!.toFixed(1)}`)} onBlur={() => setSelected(null)}/>}
        </div><span className={styles.columnLabel}>{point.label}</span>
      </div>)}</div>
    </div><span className={styles.xAxisName}>Period / category</span>
  </div>{selected ? <p className={styles.chartDetail} role="status">{selected}</p> : null}</div>;
}

export type LinePoint = { label: string; value: number | null; tooltip: string; secondary?: number | null };
export function CoachLineChart({ points, yLabel, secondaryLabel }: { points: LinePoint[]; yLabel: string; secondaryLabel?: string; maxValue?: number }) {
  const [selected, setSelected] = useState<string | null>(null);
  const valid = points.some((point) => point.value !== null || point.secondary !== undefined && point.secondary !== null);
  const revealRef = useChartReveal(valid);
  if (!valid) return null;
  const width = Math.max(320, points.length * 56);
  const kind = axisKind(yLabel);
  const domain = chartAxis(points.flatMap((point) => [point.value, point.secondary].filter((value): value is number => value !== null && value !== undefined)), kind);
  const { min, max, ticks } = domain;
  const x = (index: number) => 42 + (points.length === 1 ? (width - 70) / 2 : index * (width - 70) / (points.length - 1));
  const y = (value: number) => 170 - (value - min) / (max - min) * 140;
  const segments = (series: "value" | "secondary") => points.flatMap((point, index) => point[series] === null || point[series] === undefined ? [] : [{ index, value: point[series] as number }]);
  const primary = segments("value"); const secondary = segments("secondary");
  return <div ref={revealRef} className={styles.chartScroll}><div className={styles.chartFrame} style={{ minWidth: width }}>
    <span className={styles.axisName}>{yLabel}</span>
    <svg className={styles.lineSvg} viewBox={`0 0 ${width} 215`} role="img" aria-label={yLabel}>
      <line x1="42" y1="30" x2="42" y2="170" className={styles.axisLine}/><line x1="42" y1="170" x2={width - 8} y2="170" className={styles.axisLine}/>
      {ticks.map((tick) => <g key={tick}><line x1="42" x2={width - 8} y1={y(tick)} y2={y(tick)} className={styles.axisLine}/><text x="3" y={y(tick) + 4} className={styles.svgLabel}>{chartTick(tick, kind)}</text></g>)}
      {primary.length > 1 && <polyline pathLength="1" points={primary.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")} className={styles.primaryLine}/>}
      {secondary.length > 1 && <polyline points={secondary.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")} className={styles.secondaryLine}/>}
      {points.map((point, index) => <g key={`${point.label}-${index}`}>
        {point.value !== null && <circle cx={x(index)} cy={y(point.value)} r="5" className={`${styles.primaryDot} ${index === primary.at(-1)?.index ? styles.latestDot : ""}`} tabIndex={0} aria-label={point.tooltip} onMouseEnter={() => setSelected(point.tooltip)} onMouseLeave={() => setSelected(null)} onFocus={() => setSelected(point.tooltip)} onBlur={() => setSelected(null)}><title>{point.tooltip}</title></circle>}
        {point.secondary !== undefined && point.secondary !== null && <circle cx={x(index)} cy={y(point.secondary)} r="5" className={styles.secondaryDot} tabIndex={0} aria-label={`${point.label}: ${secondaryLabel ?? "Secondary"} ${point.secondary.toFixed(1)}`} onMouseEnter={() => setSelected(`${point.label}: ${secondaryLabel ?? "Secondary"} ${point.secondary?.toFixed(1)}`)} onMouseLeave={() => setSelected(null)} onFocus={() => setSelected(`${point.label}: ${secondaryLabel ?? "Secondary"} ${point.secondary?.toFixed(1)}`)} onBlur={() => setSelected(null)}><title>{`${point.label}: ${secondaryLabel ?? "Secondary"} ${point.secondary.toFixed(1)}`}</title></circle>}
        <text x={x(index)} y="198" textAnchor="middle" className={styles.svgLabel}>{point.label}</text>
      </g>)}
    </svg><span className={styles.xAxisName}>Period</span>
    {secondaryLabel && <p className={styles.legend}><span className={styles.primaryLegend}/> {yLabel} <span className={styles.secondaryLegend}/> {secondaryLabel}</p>}
    {selected ? <p className={styles.chartDetail} role="status">{selected}</p> : null}
  </div></div>;
}

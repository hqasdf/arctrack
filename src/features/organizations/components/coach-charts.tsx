"use client";

import Link from "next/link";
import styles from "./coach.module.css";

export type BarPoint = { label: string; value: number; tooltip: string; secondary?: number; href?: string };
export function VerticalBarChart({ points, yLabel, secondaryLabel }: { points: BarPoint[]; yLabel: string; secondaryLabel?: string }) {
  if (!points.length) return null;
  const max = Math.max(1, ...points.map((point) => point.value));
  const width = Math.max(440, points.length * 55);
  return <div className={styles.chartScroll}><div className={styles.chartFrame} style={{ minWidth: width }}>
    <span className={styles.axisName}>{yLabel}</span>
    <div className={styles.verticalPlot}>
      <div className={styles.yTicks}><span>{Math.ceil(max)}</span><span>{Math.ceil(max / 2)}</span><span>0</span></div>
      <div className={styles.columnGrid}>{points.map((point, index) => <div className={styles.columnSlot} key={`${point.label}-${index}`}>
        <div className={styles.columnHeight}>
          {point.href ? <Link href={point.href} className={styles.column} style={{ height: `${point.value / max * 100}%` }} title={point.tooltip} aria-label={`${point.tooltip}. Open athlete`}/> : <span className={styles.column} style={{ height: `${point.value / max * 100}%` }} title={point.tooltip} aria-label={point.tooltip} tabIndex={0}/>}
          {point.secondary !== undefined && <span className={`${styles.column} ${styles.secondaryColumn}`} style={{ height: `${point.secondary / max * 100}%` }} title={`${point.label}: ${secondaryLabel ?? "Secondary"} ${point.secondary.toFixed(1)}`} aria-label={`${point.label}: ${secondaryLabel ?? "Secondary"} ${point.secondary.toFixed(1)}`} tabIndex={0} />}
        </div><span className={styles.columnLabel}>{point.label}</span>
      </div>)}</div>
    </div><span className={styles.xAxisName}>Period / category</span>
  </div></div>;
}

export type LinePoint = { label: string; value: number | null; tooltip: string; secondary?: number | null };
export function CoachLineChart({ points, yLabel, secondaryLabel, maxValue }: { points: LinePoint[]; yLabel: string; secondaryLabel?: string; maxValue?: number }) {
  const valid = points.some((point) => point.value !== null || point.secondary !== undefined && point.secondary !== null);
  if (!valid) return null;
  const width = Math.max(440, points.length * 70);
  const top = maxValue ?? Math.max(1, ...points.flatMap((point) => [point.value ?? 0, point.secondary ?? 0]));
  const x = (index: number) => 42 + (points.length === 1 ? (width - 70) / 2 : index * (width - 70) / (points.length - 1));
  const y = (value: number) => 170 - value / top * 140;
  const segments = (series: "value" | "secondary") => points.flatMap((point, index) => point[series] === null || point[series] === undefined ? [] : [{ index, value: point[series] as number }]);
  const primary = segments("value"); const secondary = segments("secondary");
  return <div className={styles.chartScroll}><div className={styles.chartFrame} style={{ minWidth: width }}>
    <span className={styles.axisName}>{yLabel}</span>
    <svg className={styles.lineSvg} viewBox={`0 0 ${width} 215`} role="img" aria-label={yLabel}>
      <line x1="42" y1="30" x2="42" y2="170" className={styles.axisLine}/><line x1="42" y1="170" x2={width - 8} y2="170" className={styles.axisLine}/>
      <text x="5" y="35" className={styles.svgLabel}>{top.toFixed(top <= 10 ? 1 : 0)}</text><text x="19" y="172" className={styles.svgLabel}>0</text>
      {primary.length > 1 && <polyline points={primary.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")} className={styles.primaryLine}/>}
      {secondary.length > 1 && <polyline points={secondary.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")} className={styles.secondaryLine}/>}
      {points.map((point, index) => <g key={`${point.label}-${index}`}>
        {point.value !== null && <circle cx={x(index)} cy={y(point.value)} r="5" className={styles.primaryDot} tabIndex={0} aria-label={point.tooltip}><title>{point.tooltip}</title></circle>}
        {point.secondary !== undefined && point.secondary !== null && <circle cx={x(index)} cy={y(point.secondary)} r="5" className={styles.secondaryDot} tabIndex={0} aria-label={`${point.label}: ${secondaryLabel ?? "Secondary"} ${point.secondary.toFixed(1)}`}><title>{`${point.label}: ${secondaryLabel ?? "Secondary"} ${point.secondary.toFixed(1)}`}</title></circle>}
        <text x={x(index)} y="198" textAnchor="middle" className={styles.svgLabel}>{point.label}</text>
      </g>)}
    </svg><span className={styles.xAxisName}>Period</span>
    {secondaryLabel && <p className={styles.legend}><span className={styles.primaryLegend}/> {yLabel} <span className={styles.secondaryLegend}/> {secondaryLabel}</p>}
  </div></div>;
}

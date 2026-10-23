"use client";

import { useState } from "react";
import { formatDay, formatMetric } from "../model";
import type { HealthDay, HealthMetric } from "../types";
import styles from "./health.module.css";

export function HealthChart({ days, metric, label, tone, stacked = false }: {
  days: HealthDay[]; metric: HealthMetric; label: string; tone: string; stacked?: boolean;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selected = days.find((day) => day.date === selectedDate);
  const available = days.filter((day) => day[metric] !== null);
  if (!available.length) return <div className={styles.chartEmpty}><span aria-hidden="true">↗</span><p>No {label.toLowerCase()} measurements yet</p><small>Imported records will appear here.</small></div>;
  const values = available.map((day) => day[metric]!);
  const max = Math.max(...values, 1) * 1.15;
  const width = 420, height = 156, top = 14, bottom = 122, left = 34, right = 402;
  const x = (index: number) => left + (index / Math.max(1, days.length - 1)) * (right - left);
  const y = (value: number) => bottom - (value / max) * (bottom - top);
  const paths: string[] = [];
  let current = "";
  days.forEach((day, index) => {
    const value = day[metric];
    if (value === null) { if (current) paths.push(current); current = ""; }
    else current += `${current ? " L" : "M"}${x(index)} ${y(value)}`;
  });
  if (current) paths.push(current);
  const unit = metric === "restingHeartRate" ? " bpm" : metric === "activityMinutes" ? " min" : metric === "steps" ? " steps" : metric === "stress" || metric === "bodyBattery" ? "/100" : "";
  return <div className={styles.chart} data-tone={tone}>
    {stacked ? <div className={styles.sleepBars} aria-label={label}>
      {days.map((day) => {
        const stages = day.sleepStages;
        return <button key={day.date} type="button" className={styles.barButton}
          aria-label={`${formatDay(day.date)}: ${formatMetric(metric, day[metric])}${stages ? `, light ${stages.light}, deep ${stages.deep}, REM ${stages.rem}, awake ${stages.awake} minutes` : ", sleep stages unavailable"}`}
          onMouseEnter={() => setSelectedDate(day.date)} onFocus={() => setSelectedDate(day.date)} onClick={() => setSelectedDate(day.date)}>
          <span className={styles.barTrack}>
            {day.sleepMinutes !== null && <span className={styles.barStack} style={{ height: `${day.sleepMinutes / max * 100}%` }}>
              {stages ? <><span className={styles.stageRem} style={{ flex: stages.rem }} /><span className={styles.stageLight} style={{ flex: stages.light }} /><span className={styles.stageDeep} style={{ flex: stages.deep }} /></> : <span className={styles.stageUnknown} style={{ flex: 1 }} />}
            </span>}
          </span>
          <span className={styles.axisLabel}>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-SG", { weekday: "narrow", timeZone: "UTC" })}</span>
        </button>;
      })}
    </div> : <svg viewBox={`0 0 ${width} ${height}`} className={styles.lineChart} role="group" aria-label={`${label} history. Focus a point for its value.`}>
      {[0, .5, 1].map((fraction) => <g key={fraction}><line x1={left} x2={right} y1={y(max * fraction)} y2={y(max * fraction)} className={styles.gridLine} /><text x={left - 7} y={y(max * fraction) + 4} textAnchor="end" className={styles.svgLabel}>{Math.round(max * fraction)}</text></g>)}
      {paths.map((path, index) => <path key={index} d={path} fill="none" className={styles.trendLine} />)}
      {days.map((day, index) => day[metric] !== null && <g key={day.date} tabIndex={0} role="button" aria-label={`${formatDay(day.date)}: ${formatMetric(metric, day[metric])}${unit}`}
        onFocus={() => setSelectedDate(day.date)} onMouseEnter={() => setSelectedDate(day.date)} onClick={() => setSelectedDate(day.date)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedDate(day.date); } }}>
        <circle cx={x(index)} cy={y(day[metric]!)} r={12} fill="transparent" />
        <circle cx={x(index)} cy={y(day[metric]!)} r={selectedDate === day.date ? 5 : 3.5} className={styles.point} />
      </g>)}
      {[0, Math.floor((days.length - 1) / 2), days.length - 1].map((index, key) => <text key={key} x={x(index)} y={148} textAnchor={key === 0 ? "start" : key === 2 ? "end" : "middle"} className={styles.svgLabel}>{formatDay(days[index].date, true)}</text>)}
    </svg>}
    <div className={styles.chartTooltip} aria-live="polite" aria-atomic="true">
      {selected ? <><strong>{formatDay(selected.date, true)}</strong> · {formatMetric(metric, selected[metric])}{selected[metric] !== null && unit}{stacked && (selected.sleepStages ? <span>Light {formatMetric("sleepMinutes", selected.sleepStages.light)} · Deep {formatMetric("sleepMinutes", selected.sleepStages.deep)} · REM {formatMetric("sleepMinutes", selected.sleepStages.rem)} · Awake {selected.sleepStages.awake}m</span> : <span>Sleep stages unavailable</span>)}</> : "Hover, tap or focus a data point to explore"}
    </div>
    {stacked && <div className={styles.legend}><span><i className={styles.stageDeep} />Deep</span><span><i className={styles.stageLight} />Light</span><span><i className={styles.stageRem} />REM</span><span><i className={styles.stageUnknown} />Stages unavailable</span></div>}
  </div>;
}

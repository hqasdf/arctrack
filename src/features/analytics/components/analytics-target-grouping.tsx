"use client";

import { memo, useState } from "react";
import type { TargetFaceType } from "@/features/sessions/scoring-model";
import type { TargetGrouping } from "../analytics-model";
import styles from "./analytics.module.css";

const ringColours: Record<number, string> = { 1: "#f4f1e9", .9: "#f4f1e9", .8: "#202020", .7: "#202020", .6: "#49a4cf", .5: "#49a4cf", .4: "#e65a55", .3: "#e65a55", .2: "#f5cf3d", .1: "#f5cf3d" };
const fullRings = [1, .9, .8, .7, .6, .5, .4, .3, .2, .1];
const sixRings = [.6, .5, .4, .3, .2, .1];
const tripleRings = [.5, .4, .3, .2, .1];
const tripleCentres = [-110, 0, 110] as const;
const views = { full_face: "-105 -105 210 210", six_ring: "-65 -65 130 130", triple_face: "-58 -168 116 336" } as const;
const labels: Record<TargetFaceType, string> = { full_face: "Full face", six_ring: "6-ring", triple_face: "Triple face" };

export const AnalyticsTargetGrouping = memo(function AnalyticsTargetGrouping({ groups }: { groups: TargetGrouping[] }) {
  const [requestedFace, setRequestedFace] = useState<TargetFaceType | null>(null);
  const active = groups.find((group) => group.faceType === requestedFace) ?? groups.find((group) => group.arrows.length > 0) ?? groups[0] ?? null;

  if (!active) return <div className={styles.emptyState}><h3>No target plots yet</h3><p>Plotted Arrows in the selected filters will appear here.</p></div>;

  return <div>
    <div className={styles.groupingTabs} role="group" aria-label="Target grouping layout">
      {groups.map((group) => <button key={group.faceType} type="button" aria-pressed={active.faceType === group.faceType} onClick={() => setRequestedFace(group.faceType)}>{labels[group.faceType]} <span>{group.arrows.length}</span></button>)}
    </div>
    {active.arrows.length === 0 ? <div className={styles.emptyState}><h3>No plotted Arrows for {labels[active.faceType]}</h3><p>Choose another layout or record plotted Arrows in a matching Round.</p></div> : <div className={`${styles.groupingCanvas} ${active.faceType === "triple_face" ? styles.tripleCanvas : ""}`}>
      <svg viewBox={views[active.faceType]} role="img" aria-label={`${labels[active.faceType]} grouping with ${active.arrows.length} plotted Arrows`}>
        {active.faceType === "triple_face" ? tripleCentres.map((cy) => <Face key={cy} cy={cy} radii={tripleRings}/>) : <Face cy={0} radii={active.faceType === "six_ring" ? sixRings : fullRings}/>} 
        {active.arrows.map((arrow) => {
          const cy = active.faceType === "triple_face" ? tripleCentres[arrow.faceIndex ?? 1] : 0;
          return <circle key={arrow.id} cx={arrow.x * 100} cy={cy + arrow.y * 100} r="3.2" className={styles.groupingMarker}/>;
        })}
      </svg>
    </div>}
    <p className={styles.groupingContext}>{active.arrows.length} plotted {active.arrows.length === 1 ? "Arrow" : "Arrows"}{active.missingPlotCount > 0 ? ` · ${active.missingPlotCount} without plot coordinates` : ""}{active.unassignedTripleCount > 0 ? ` · ${active.unassignedTripleCount} Triple-face plots without a face index excluded` : ""}</p>
  </div>;
});

function Face({ cy, radii }: { cy: number; radii: number[] }) {
  return <g>{radii.map((radius) => <circle key={radius} cx="0" cy={cy} r={radius * 100} fill={ringColours[radius]} stroke="#4b443e" strokeWidth=".7"/>)}<circle cx="0" cy={cy} r="5" fill="none" stroke="#4b443e" strokeWidth=".7"/><circle cx="0" cy={cy} r="1.5" fill="none" stroke="#4b443e" strokeWidth=".6"/></g>;
}

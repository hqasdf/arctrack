"use client";

import { useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { calculateRobustMainGroup, calculateRoundGroupingInsights } from "@arc-track/core/insights";
import type { RoundDraft } from "@arc-track/core/scoring";
import { GroupingTarget } from "@/features/sessions/components/session-insights";
import styles from "./coach.module.css";

type Point = { x: number; y: number };
export function CoachReadonlyTarget({ round }: { round: RoundDraft }) {
  const grouping = calculateRoundGroupingInsights(round);
  const mainGroup = calculateRobustMainGroup(grouping.arrows, round.faceDiameterCm);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const last = useRef<Point | null>(null);
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const reset = () => setView({ scale: 1, x: 0, y: 0 });
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  function down(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) last.current = { x: event.clientX, y: event.clientY };
    if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = { distance: distance(a, b), scale: view.scale }; last.current = null; }
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size >= 2 && pinch.current) { const [a, b] = [...pointers.current.values()]; setView((current) => ({ ...current, scale: Math.max(1, Math.min(4, pinch.current!.scale * distance(a, b) / Math.max(1, pinch.current!.distance))) })); return; }
    const previous = last.current;
    if (previous && view.scale > 1) {
      const deltaX = point.x - previous.x;
      const deltaY = point.y - previous.y;
      setView((current) => ({ ...current, x: current.x + deltaX, y: current.y + deltaY }));
    }
    last.current = point;
  }
  function up(event: PointerEvent<HTMLDivElement>) { pointers.current.delete(event.pointerId); if (pointers.current.size < 2) pinch.current = null; last.current = null; }
  function wheel(event: WheelEvent<HTMLDivElement>) { event.preventDefault(); setView((current) => ({ ...current, scale: Math.max(1, Math.min(4, current.scale + (event.deltaY < 0 ? .2 : -.2))) })); }
  return <section className={styles.section} aria-label="Read-only target"><div className={styles.sectionHeading}><h2>Saved target plots</h2><button type="button" onClick={reset} className={styles.resetTarget}>Reset view</button></div>
    <p className={styles.note}>Read only · Drag to pan when zoomed, pinch or scroll to zoom.</p>
    <div className={styles.readonlyTargetViewport} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
      <div className={styles.readonlyTargetContent} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}><GroupingTarget round={round} grouping={grouping}/></div>
    </div>
    {grouping.arrows.length === 0 && <p className={styles.empty}>No plotted Arrows yet.</p>}
    {mainGroup.flyers.length > 0 && <p className={styles.note}>{mainGroup.flyers.length} possible {mainGroup.flyers.length === 1 ? "flyer" : "flyers"} in the saved plots.</p>}
  </section>;
}

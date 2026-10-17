"use client";

import { useId, useRef, type ReactNode, type TouchEvent } from "react";
import styles from "./sessions.module.css";

type Category = "training" | "competition";
export function SessionCategoryTabs({ category, onCategoryChange: setCategory, training, competition, toolbar }: { category: Category; onCategoryChange: (category: Category) => void; training: ReactNode; competition: ReactNode; toolbar: ReactNode }) {
  const id = useId();
  const touch = useRef<{ x: number; y: number } | null>(null);
  function start(event: TouchEvent<HTMLDivElement>) {
    touch.current = null;
    if (event.touches.length !== 1) return;
    const target = event.target as Element;
    if (target.closest('button,a,input,select,textarea,[role="button"],[role="slider"],svg,canvas')) return;
    for (let node: Element | null = target; node && node !== event.currentTarget; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return;
    }
    touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }
  return <>
    <div role="tablist" aria-label="Session category" className={styles.sessionTabs} onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "training" : event.key === "End" ? "competition" : category === "training" ? "competition" : "training";
      setCategory(next);
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next === "training" ? 0 : 1]?.focus();
    }}>
      {(["training", "competition"] as const).map((value) => <button key={value} type="button" role="tab" id={`${id}-${value}-tab`} aria-controls={`${id}-${value}-panel`} aria-selected={category === value} tabIndex={category === value ? 0 : -1} className={category === value ? styles.sessionTabActive : styles.sessionTab} onClick={() => setCategory(value)}>{value === "training" ? "Training" : "Competition"}</button>)}
    </div>
    {toolbar}
    <div onTouchStart={start} onTouchMove={(event) => {
      if (!touch.current) return;
      if (event.touches.length !== 1 || (Math.abs(event.touches[0].clientY - touch.current.y) >= 12 && Math.abs(event.touches[0].clientY - touch.current.y) > Math.abs(event.touches[0].clientX - touch.current.x))) touch.current = null;
    }} onTouchCancel={() => { touch.current = null; }} onTouchEnd={(event) => {
      const origin = touch.current; touch.current = null;
      if (!origin || event.changedTouches.length !== 1) return;
      const dx = event.changedTouches[0].clientX - origin.x, dy = event.changedTouches[0].clientY - origin.y;
      if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.5) setCategory(dx < 0 ? "competition" : "training");
    }}>
      <div role="tabpanel" className={styles.sessionPanel} id={`${id}-training-panel`} aria-labelledby={`${id}-training-tab`} hidden={category !== "training"}>{training}</div>
      <div role="tabpanel" className={styles.sessionPanel} id={`${id}-competition-panel`} aria-labelledby={`${id}-competition-tab`} hidden={category !== "competition"}>{competition}</div>
    </div>
  </>;
}

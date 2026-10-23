"use client";

import { useEffect, useRef, useState } from "react";
import { TargetFallback } from "./target-fallback";
import styles from "./home.module.css";

export function CinematicScene() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    const element = canvas.current;
    const story = element?.closest<HTMLElement>("[data-archery-story]");
    if (!element || !story) return;
    // Keep Three.js out of the initial HTML and every authenticated route.
    void import("./archery-scene").then(({ mountArcheryScene }) => {
      if (!cancelled) dispose = mountArcheryScene(element, story, () => setUnavailable(true));
    }).catch(() => { if (!cancelled) setUnavailable(true); });
    return () => { cancelled = true; dispose?.(); };
  }, []);

  return <div className={styles.stage} aria-hidden="true">
    <div className={styles.fallback}>
      <div className={styles.fallbackTarget}><TargetFallback /></div>
    </div>
    {!unavailable && <canvas ref={canvas} className={styles.canvas} />}
    <div className={styles.vignette} />
    <span className={styles.sceneLabel}>{unavailable ? "THE PURSUIT OF PRECISION" : "PRECISION IN EVERY DIMENSION"}</span>
  </div>;
}

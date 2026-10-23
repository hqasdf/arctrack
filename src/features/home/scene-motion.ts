export function clampProgress(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function storyProgress(scrollY: number, top: number, height: number, viewport: number) {
  return clampProgress((scrollY - top) / Math.max(1, height - viewport));
}

const smooth = (value: number) => value * value * (3 - 2 * value);
const mix = (a: number, b: number, progress: number) => a + (b - a) * progress;

// Pure camera choreography. No application coordinates or scoring state.
export function scenePose(progress: number, mobile: boolean, aspect = 1) {
  const p = clampProgress(progress);
  const approach = smooth(clampProgress(p * 2));
  const analysis = smooth(clampProgress((p - 0.5) * 2));
  return {
    cameraX: mobile ? mix(0.65, 0, approach) : mix(0.1, 0.65, approach),
    cameraY: mobile ? mix(0.5, 0.12, approach) : mix(0.65, 0.18, approach),
    cameraZ: mobile ? mix(10.2, 9.4, approach) * Math.max(1, 0.5 / aspect) : mix(7, 5.25, approach),
    lookX: mobile ? 0 : mix(0.05, 0.1, approach),
    lookY: mobile ? 0.85 : 0,
    targetX: mobile ? 0 : mix(1.8, 1.65, approach),
    targetY: mobile ? -0.55 : 0,
    targetRotation: mix(-0.38, 0, analysis),
    arrowTravel: smooth(clampProgress((p - 0.08) / 0.36)),
    groupingOpacity: analysis * 0.75,
  };
}

export function initialPixelRatio(deviceRatio: number, mobile: boolean, saveData = false) {
  return Math.min(deviceRatio || 1, saveData ? 1 : mobile ? 1.25 : 1.6);
}

import type { Plot, TargetFaceType } from "@arc-track/core/scoring";

export const targetViews = {
  full_face: { x: -105, y: -105, width: 210, height: 210 },
  six_ring: { x: -65, y: -65, width: 130, height: 130 },
  triple_face: { x: -58, y: -168, width: 116, height: 336 },
} as const;

export const tripleCentres = [-110, 0, 110] as const;

export type TargetViewport = { scale: number; panX: number; panY: number };
export const initialViewport: TargetViewport = { scale: 1, panX: 0, panY: 0 };

export function nativeTargetSize(availableWidth: number, faceType: TargetFaceType) {
  const available = Math.max(0, availableWidth);
  const width = faceType === "triple_face" ? Math.min(available * .52, 203) : Math.min(available, 460);
  return { width, height: width * targetViews[faceType].height / targetViews[faceType].width };
}

export function withinNativeTarget(x: number, y: number, width: number, height: number) {
  return Number.isFinite(x) && Number.isFinite(y) && width > 0 && height > 0
    && x >= 0 && x <= width && y >= 0 && y <= height;
}

export function untransformTouch(x: number, y: number, width: number, height: number, viewport: TargetViewport) {
  return {
    x: width / 2 + (x - width / 2 - viewport.panX) / viewport.scale,
    y: height / 2 + (y - height / 2 - viewport.panY) / viewport.scale,
  };
}

export function zoomAndPanViewport(
  initial: TargetViewport, initialCentre: { x: number; y: number }, currentCentre: { x: number; y: number },
  distanceRatio: number, width: number, height: number,
): TargetViewport {
  const scale = Math.max(1, Math.min(4, initial.scale * distanceRatio));
  const anchor = untransformTouch(initialCentre.x, initialCentre.y, width, height, initial);
  return {
    scale,
    panX: currentCentre.x - width / 2 - (anchor.x - width / 2) * scale,
    panY: currentCentre.y - height / 2 - (anchor.y - height / 2) * scale,
  };
}

export function plotFromTransformedNativeTouch(
  x: number, y: number, width: number, height: number, faceType: TargetFaceType, viewport: TargetViewport,
): Plot {
  const local = untransformTouch(x, y, width, height, viewport);
  return plotFromNativeTouch(local.x, local.y, width, height, faceType);
}

export function shouldCommitNativeTap(input: { moved: boolean; hadMultiTouch: boolean; changedTouchCount: number }) {
  return !input.moved && !input.hadMultiTouch && input.changedTouchCount === 1;
}

export function plotFromNativeTouch(localX: number, localY: number, width: number, height: number, faceType: TargetFaceType): Plot {
  const view = targetViews[faceType];
  const x = view.x + localX / width * view.width;
  const y = view.y + localY / height * view.height;
  if (faceType !== "triple_face") return { x: x / 100, y: y / 100 };
  let faceIndex: 0 | 1 | 2 = 0;
  if (Math.abs(y - tripleCentres[1]) < Math.abs(y - tripleCentres[faceIndex])) faceIndex = 1;
  if (Math.abs(y - tripleCentres[2]) < Math.abs(y - tripleCentres[faceIndex])) faceIndex = 2;
  return { x: x / 100, y: (y - tripleCentres[faceIndex]) / 100, faceIndex };
}

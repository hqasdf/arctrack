import { createThemedStyles } from "./appearance";
import { calculateGroupingForArrows, convexHull } from "@arc-track/core/insights";
import type { ArrowEntry, Plot, TargetFaceType } from "@arc-track/core/scoring";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import Svg, { Circle, G, Polygon } from "react-native-svg";
import {
  initialViewport, plotFromTransformedNativeTouch, shouldCommitNativeTap, targetViews, tripleCentres,
  nativeTargetSize, withinNativeTarget, zoomAndPanViewport, type TargetViewport,
} from "./native-target-geometry";

const fullRings = [1, .9, .8, .7, .6, .5, .4, .3, .2, .1];
const sixRings = [.6, .5, .4, .3, .2, .1];
const tripleRings = [.5, .4, .3, .2, .1];
const ringColours: Record<number, string> = {
  1: "#f4f1e9", .9: "#f4f1e9", .8: "#202020", .7: "#202020",
  .6: "#49a4cf", .5: "#49a4cf", .4: "#e65a55", .3: "#e65a55",
  .2: "#f5cf3d", .1: "#f5cf3d",
};

type Props = {
  arrows: ArrowEntry[];
  selectedId: string | null;
  currentEnd: number;
  faceType: TargetFaceType;
  faceDiameterCm: number;
  onPlot: (plot: Plot) => void;
  onMultiTouchChange?: (active: boolean) => void;
};

type Tap = { startX: number; startY: number; moved: boolean; hadMultiTouch: boolean } | null;
type Gesture = { viewport: TargetViewport; centre: { x: number; y: number }; distance: number; ids: number[] } | null;

function touchPair(event: GestureResponderEvent, width: number, height: number) {
  const [a, b] = event.nativeEvent.touches;
  if (!a || !b || event.nativeEvent.touches.length !== 2
    || !withinNativeTarget(a.locationX, a.locationY, width, height)
    || !withinNativeTarget(b.locationX, b.locationY, width, height)) return null;
  const distance = Math.hypot(a.locationX - b.locationX, a.locationY - b.locationY);
  if (distance < 1) return null;
  return {
    centre: { x: (a.locationX + b.locationX) / 2, y: (a.locationY + b.locationY) / 2 },
    distance, ids: [a.identifier, b.identifier].sort(),
  };
}

export function NativeTarget({ arrows, selectedId, currentEnd, faceType, faceDiameterCm, onPlot, onMultiTouchChange }: Props) {
  const styles = useStyles();
  const [availableWidth, setAvailableWidth] = useState(320);
  const tap = useRef<Tap>(null);
  const gesture = useRef<Gesture>(null);
  const interruptedPinch = useRef(false);
  const multiTouch = useRef(false);
  const finishGesture = useCallback(() => {
    tap.current = null;
    gesture.current = null;
    interruptedPinch.current = false;
    if (multiTouch.current) { multiTouch.current = false; onMultiTouchChange?.(false); }
  }, [onMultiTouchChange]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => { if (state !== "active") finishGesture(); });
    return () => { subscription.remove(); finishGesture(); };
  }, [finishGesture]);
  const [viewport, setViewport] = useState<TargetViewport>(initialViewport);
  const viewportRef = useRef<TargetViewport>(initialViewport);
  const view = targetViews[faceType];
  const { width, height } = nativeTargetSize(availableWidth, faceType);
  const grouping = useMemo(() => calculateGroupingForArrows(arrows, faceType, faceDiameterCm), [arrows, faceType, faceDiameterCm]);
  const plotted = useMemo(() => arrows.filter((item) => item.plot !== null), [arrows]);
  const ordered = [
    ...plotted.filter((item) => item.end !== currentEnd && item.id !== selectedId),
    ...plotted.filter((item) => item.end === currentEnd && item.id !== selectedId),
    ...plotted.filter((item) => item.id === selectedId),
  ];

  function captureMultiTouch(event: GestureResponderEvent) {
    if (event.nativeEvent.touches.length > 1) {
      if (!tap.current) tap.current = { startX: event.nativeEvent.locationX, startY: event.nativeEvent.locationY, moved: false, hadMultiTouch: true };
      tap.current.hadMultiTouch = true;
      if (!multiTouch.current) { multiTouch.current = true; onMultiTouchChange?.(true); }
    }
    return multiTouch.current;
  }

  function trackTouch(event: GestureResponderEvent) {
    if (event.nativeEvent.touches.length > 1) {
      captureMultiTouch(event);
      const pair = touchPair(event, width, height);
      if (!pair) { interruptedPinch.current = true; gesture.current = null; return; }
      if (interruptedPinch.current) return;
      if (!gesture.current || pair.ids.some((id, index) => id !== gesture.current!.ids[index])) {
        gesture.current = { viewport: viewportRef.current, ...pair };
        return;
      }
      if (pair.distance === gesture.current.distance && pair.centre.x === gesture.current.centre.x
        && pair.centre.y === gesture.current.centre.y) return;
      if (pair && gesture.current) {
        const next = zoomAndPanViewport(
          gesture.current.viewport, gesture.current.centre, pair.centre,
          pair.distance / Math.max(gesture.current.distance, 1), width, height,
        );
        viewportRef.current = next;
        setViewport(next);
      }
      return;
    }
    // Keep ownership after one finger lifts; a new pair starts from the current view.
    if (multiTouch.current) { gesture.current = null; return; }
    if (!tap.current) return;
    if (Math.hypot(event.nativeEvent.locationX - tap.current.startX, event.nativeEvent.locationY - tap.current.startY) > 8) tap.current.moved = true;
  }

  function release(event: GestureResponderEvent) {
    if (multiTouch.current && event.nativeEvent.touches.length > 0) return;
    const candidate = tap.current;
    finishGesture();
    if (!candidate || !shouldCommitNativeTap({ moved: candidate.moved, hadMultiTouch: candidate.hadMultiTouch, changedTouchCount: event.nativeEvent.changedTouches.length })) return;
    const { locationX, locationY } = event.nativeEvent;
    if (locationX < 0 || locationX > width || locationY < 0 || locationY > height) return;
    onPlot(plotFromTransformedNativeTouch(locationX, locationY, width, height, faceType, viewportRef.current));
  }

  const faces = faceType === "triple_face"
    ? tripleCentres.map((centre, faceIndex) => ({ centre, faceIndex, radii: tripleRings }))
    : [{ centre: 0, faceIndex: 0, radii: faceType === "six_ring" ? sixRings : fullRings }];
  const centreX = view.x + view.width / 2;
  const centreY = view.y + view.height / 2;
  const panX = viewport.panX / width * view.width;
  const panY = viewport.panY / height * view.height;
  const transform = `matrix(${viewport.scale} 0 0 ${viewport.scale} ${centreX + panX - centreX * viewport.scale} ${centreY + panY - centreY * viewport.scale})`;

  return <View style={styles.container} onLayout={(event) => {
    const measuredWidth = event.nativeEvent.layout.width;
    if (measuredWidth !== availableWidth) { finishGesture(); setAvailableWidth(measuredWidth); }
  }}>
    <View style={{ width, height }}>
      <Svg width={width} height={height} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} pointerEvents="none">
        <G transform={transform}>
        {faces.map(({ centre, faceIndex, radii }) => <G key={faceIndex}>
          {radii.map((radius) => <Circle key={radius} cx={0} cy={centre} r={radius * 100} fill={ringColours[radius]} stroke="#4b443e" strokeWidth={.7} />)}
          <Circle cx={0} cy={centre} r={5} fill="none" stroke="#4b443e" strokeWidth={.7} />
          <Circle cx={0} cy={centre} r={1.5} fill="none" stroke="#4b443e" strokeWidth={.6} />
        </G>)}
        {faces.map(({ centre, faceIndex }) => {
          const points = grouping.arrows.filter((arrow) => faceType !== "triple_face" || arrow.faceIndex === faceIndex);
          const hull = points.length >= 3 ? convexHull(points) : [];
          return hull.length >= 3 ? <Polygon key={`hull-${faceIndex}`}
            points={hull.map((point) => `${point.x * 100},${centre + point.y * 100}`).join(" ")}
            fill="#306b60" fillOpacity={.16} stroke="#306b60" strokeOpacity={.55} strokeWidth={1.1} /> : null;
        })}
        {ordered.map((arrow) => {
          const plot = arrow.plot!;
          const centre = faceType === "triple_face" ? tripleCentres[plot.faceIndex ?? 1] : 0;
          const selected = arrow.id === selectedId;
          return <G key={arrow.id} transform={`translate(${plot.x * 100} ${centre + plot.y * 100})`}>
            {selected ? <Circle r={5} fill="none" stroke="#306b60" strokeWidth={1.5} /> : null}
            <Circle r={selected ? 2.5 : arrow.end === currentEnd ? 2 : 1.5}
              fill={selected ? "#306b60" : "#242d2b"} stroke="#fff" strokeWidth={.8} />
          </G>;
        })}
        </G>
      </Svg>
      <View style={StyleSheet.absoluteFill} accessible accessibilityLabel="Scoring target"
        onStartShouldSetResponderCapture={captureMultiTouch}
        onMoveShouldSetResponderCapture={captureMultiTouch}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={captureMultiTouch}
        onResponderGrant={(event) => {
          if (!multiTouch.current) tap.current = {
            startX: event.nativeEvent.locationX, startY: event.nativeEvent.locationY,
            moved: false, hadMultiTouch: false,
          };
          trackTouch(event);
          return multiTouch.current; // Also block native interception when claiming a pinch.
        }}
        onResponderStart={trackTouch}
        onTouchStart={trackTouch}
        onTouchMove={trackTouch}
        onTouchEnd={(event) => {
          if (!event.nativeEvent.touches.length) finishGesture();
          else if (multiTouch.current) { gesture.current = null; interruptedPinch.current = false; }
        }}
        onTouchCancel={finishGesture}
        onResponderRelease={release}
        onResponderTerminate={finishGesture}
        onResponderTerminationRequest={() => !multiTouch.current} />
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Reset target zoom" onPress={() => {
      viewportRef.current = initialViewport;
      setViewport(initialViewport);
      finishGesture();
    }} style={styles.reset}><Text style={styles.resetText}>Reset zoom</Text></Pressable>
  </View>;
}

const useStyles = createThemedStyles((colors) => StyleSheet.create({
  container: { width: "100%", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  reset: { alignSelf: "flex-end", minHeight: 40, justifyContent: "center", paddingHorizontal: 8 },
  resetText: { color: colors.accent, fontSize: 13, fontWeight: "700" },
}));

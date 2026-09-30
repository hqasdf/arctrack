import type { RoundDraft } from "@arc-track/core/scoring";
import { calculateRobustMainGroup, calculateRoundGroupingInsights } from "@arc-track/core/insights";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { AnalysisTarget } from "./analysis-target";
import { coachPalette } from "./coach-ui";

type Point = { x: number; y: number };
const clamp = (value: number) => Math.max(1, Math.min(4, value));
function pair(event: GestureResponderEvent): { centre: Point; distance: number } | null {
  const [a,b] = event.nativeEvent.touches;
  if (!a || !b) return null;
  return { centre: { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 }, distance: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) };
}

export function CoachReadonlyTarget({ round }: { round: RoundDraft }) {
  const grouping = calculateRoundGroupingInsights(round);
  const mainGroup = calculateRobustMainGroup(grouping.arrows, round.faceDiameterCm);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const current = useRef(view);
  const last = useRef<Point | null>(null);
  const pinch = useRef<{ centre: Point; distance: number; scale: number } | null>(null);
  const reset = () => { const next = { scale: 1, x: 0, y: 0 }; current.current = next; setView(next); };
  function start(event: GestureResponderEvent) {
    const two = pair(event);
    if (two) { pinch.current = { ...two, scale: current.current.scale }; last.current = null; }
    else { const touch = event.nativeEvent.touches[0]; last.current = touch ? { x: touch.pageX, y: touch.pageY } : null; }
  }
  function move(event: GestureResponderEvent) {
    const two = pair(event);
    if (two) {
      if (!pinch.current) pinch.current = { ...two, scale: current.current.scale };
      const next = { scale: clamp(pinch.current.scale * two.distance / Math.max(1, pinch.current.distance)),
        x: current.current.x + two.centre.x - pinch.current.centre.x,
        y: current.current.y + two.centre.y - pinch.current.centre.y };
      current.current = next; setView(next);
      pinch.current = { ...two, scale: next.scale }; last.current = null; return;
    }
    pinch.current = null;
    const touch = event.nativeEvent.touches[0];
    if (!touch) return;
    const point = { x: touch.pageX, y: touch.pageY };
    if (last.current && current.current.scale > 1) {
      const next = { ...current.current, x: current.current.x + point.x - last.current.x, y: current.current.y + point.y - last.current.y };
      current.current = next; setView(next);
    }
    last.current = point;
  }
  return <View style={styles.section}>
    <View style={styles.heading}><Text style={styles.title}>Saved target plots</Text><Pressable accessibilityRole="button" onPress={reset} style={styles.reset}><Text style={styles.resetText}>Reset view</Text></Pressable></View>
    <Text style={styles.note}>Read only Â· Pinch to zoom; drag to pan while zoomed.</Text>
    <View style={styles.viewport} onMoveShouldSetResponder={(event) => event.nativeEvent.touches.length > 1 || current.current.scale > 1}
      onResponderGrant={start} onResponderMove={move} onResponderRelease={() => { last.current = null; pinch.current = null; }}
      onResponderTerminate={() => { last.current = null; pinch.current = null; }}>
      <View pointerEvents="none" style={{ transform: [{ translateX: view.x }, { translateY: view.y }, { scale: view.scale }] }}>
        <AnalysisTarget faceType={round.faceType} arrows={grouping.arrows} centre={grouping.metrics ? { x: grouping.metrics.centreX, y: grouping.metrics.centreY } : null} flyerIds={new Set(mainGroup.flyers.map((arrow) => arrow.id))}/>
      </View>
    </View>
    {!grouping.arrows.length ? <Text style={styles.note}>No plotted Arrows yet.</Text> : null}
    {mainGroup.flyers.length ? <Text style={styles.note}>{mainGroup.flyers.length} possible {mainGroup.flyers.length === 1 ? "flyer" : "flyers"}.</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { backgroundColor: coachPalette.surface, borderRadius: 20, padding: 12, gap: 10, marginVertical: 12 },
  heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { color: coachPalette.text, fontSize: 18, fontWeight: "800", flexShrink: 1 },
  reset: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderRadius: 8, borderColor: coachPalette.border, borderWidth: 1 },
  resetText: { color: coachPalette.accent, fontSize: 13, fontWeight: "700" },
  note: { color: coachPalette.muted, fontSize: 12 },
  viewport: { overflow: "hidden", borderRadius: 8 },
});

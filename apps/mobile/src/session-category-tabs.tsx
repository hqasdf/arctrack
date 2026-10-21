import { useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { createThemedStyles } from "./appearance";

type Category = "training" | "competition";

export function SessionCategoryTabs({ children }: { children: (category: Category) => ReactNode }) {
  const styles = useStyles();
  const [category, setCategory] = useState<Category>("training");
  const vertical = useRef(false);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => { vertical.current = false; return false; },
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      if (gesture.numberActiveTouches !== 1) { vertical.current = true; return false; }
      if (Math.abs(gesture.dy) >= 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx)) vertical.current = true;
      return !vertical.current && Math.abs(gesture.dx) >= 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5;
    },
    onPanResponderMove: (_event, gesture) => { if (gesture.numberActiveTouches !== 1) vertical.current = true; },
    onPanResponderRelease: (_event, gesture) => {
      if (!vertical.current && Math.abs(gesture.dx) >= 48 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5) setCategory(gesture.dx < 0 ? "competition" : "training");
    },
    onPanResponderTerminationRequest: () => true,
    onShouldBlockNativeResponder: () => false,
  }), []);
  return <View style={styles.content}>
    <View accessibilityRole="tablist" accessibilityLabel="Session category" style={styles.tabs}>
      {(["training", "competition"] as const).map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value === "training" ? "Training" : "Competition"} accessibilityState={{ selected: category === value }} onPress={() => setCategory(value)} style={[styles.tab, category === value && styles.active]}><Text style={[styles.label, category === value && styles.activeLabel]}>{value === "training" ? "Training" : "Competition"}</Text></Pressable>)}
    </View>
    <View style={styles.content} {...responder.panHandlers}>{children(category)}</View>
  </View>;
}

const useStyles = createThemedStyles((colors) => StyleSheet.create({
  content: { flex: 1, minWidth: 0 },
  tabs: { flexDirection: "row", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 28, padding: 4, gap: 4, marginBottom: 16 },
  tab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 24, paddingHorizontal: 10 },
  active: { backgroundColor: colors.accent },
  label: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  activeLabel: { color: colors.onPrimary },
}));

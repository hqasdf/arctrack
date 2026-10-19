import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, FlatList, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  addArrows, COUNTER_STORAGE_KEY, DEFAULT_COUNTER, readCounter,
  resetCounter, setIncrement, undoLastAddition, type CounterState,
} from "../../src/counter-model";
import { colors, PAGE_TOP_SPACING } from "../../src/theme";
import { COUNTER_TOTAL_COLUMN_FLEX, COUNTER_WHEEL_COLUMN_FLEX, COUNTER_WHEEL_ROW_HEIGHT, COUNTER_WHEEL_VISIBLE_ROWS, COUNTER_WHEEL_WINDOW, counterWheelRangeStart, counterWheelValueFromOffset, shouldRecenterCounterWheel, shouldTickCounterWheel } from "../../src/counter-wheel-model";

export default function CounterScreen() {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const compact = (viewportHeight || window.height) < 560;
  const padding = compact ? 12 : 18;
  const [counter, setCounter] = useState<CounterState>(DEFAULT_COUNTER);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const writes = useRef(Promise.resolve());
  const currentCounter = useRef<CounterState>(DEFAULT_COUNTER);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(COUNTER_STORAGE_KEY).then((stored) => {
      if (!active) return;
      const state = stored === null ? DEFAULT_COUNTER : readCounter(JSON.parse(stored));
      currentCounter.current = state;
      setCounter(state);
      setReady(true);
    }).catch(() => {
      if (active) { setMessage("Saved counter could not be loaded."); setReady(true); }
    });
    return () => { active = false; };
  }, []);

  function apply(change: (current: CounterState) => CounterState) {
    if (!ready) return;
    const next = change(currentCounter.current);
    if (next === currentCounter.current) return;
    currentCounter.current = next;
    setCounter(next);
    writes.current = writes.current.catch(() => {}).then(() => AsyncStorage.setItem(COUNTER_STORAGE_KEY, JSON.stringify(next)));
    void writes.current.catch(() => setMessage("Counter could not be saved on this device."));
  }
  const changeIncrement = useCallback((increment: number) => {
    if (!shouldTickCounterWheel(currentCounter.current.increment, increment)) return;
    apply((current) => setIncrement(current, increment));
    void Haptics.selectionAsync().catch(() => {});
  }, [ready]);

  function reset() {
    Alert.alert("Reset counter?", "The total and Undo history will be cleared.", [
      { text: "Cancel", style: "cancel" },
      { text: "Reset", style: "destructive", onPress: () => apply(resetCounter) },
    ]);
  }

  return <ScrollView style={styles.page}
    onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
    onContentSizeChange={(_, height) => setContentHeight(height)}
    scrollEnabled={viewportHeight > 0 && contentHeight > viewportHeight + 1}
    nestedScrollEnabled
    contentContainerStyle={[styles.content, compact && styles.compactContent, {
      minHeight: viewportHeight,
      paddingTop: Math.max(compact ? 12 : 18 + PAGE_TOP_SPACING, insets.top + padding),
      paddingLeft: padding + insets.left, paddingRight: padding + insets.right,
    }]}>
    <View style={styles.toolbar}>
      <Text style={styles.heading}>Arrow Counter</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Undo last addition" disabled={!ready || counter.history.length === 0}
          onPress={() => apply(undoLastAddition)} style={styles.tool}><Text style={[styles.toolText, counter.history.length === 0 && styles.disabled]}>Undo</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Reset counter" disabled={!ready || counter.totalArrows === 0}
          onPress={reset} style={styles.tool}><Text style={[styles.toolText, counter.totalArrows === 0 && styles.disabled]}>Reset</Text></Pressable>
      </View>
    </View>
    <View style={styles.center}>
      <View style={styles.counterTopRow}>
        <View style={styles.totalColumn}>
          <Text style={styles.totalLabel}>TOTAL ARROWS</Text>
          <Text style={styles.total} adjustsFontSizeToFit minimumFontScale={0.55} numberOfLines={1}>{counter.totalArrows}</Text>
        </View>
        <View style={styles.wheelArea}>
          <Text style={styles.wheelLabel}>ARROWS TO ADD</Text>
          <CounterWheel value={counter.increment} enabled={ready} onChange={changeIncrement} />
        </View>
      </View>
    </View>
    {message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={`Add ${counter.increment} Arrows`} disabled={!ready}
      onPress={() => apply(addArrows)} style={({ pressed }) => [styles.clicker, compact && styles.compactClicker, pressed && styles.pressed]}>
      <Text style={[styles.arrow, compact && styles.compactArrow]}>↑</Text><Text style={styles.addText}>+{counter.increment}</Text>
    </Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: 18, gap: 10 },
  compactContent: { padding: 12, gap: 8 },
  toolbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  heading: { color: colors.text, fontSize: 17, fontWeight: "700", flexShrink: 1 },
  actions: { flexDirection: "row", gap: 5 },
  tool: { minHeight: 44, minWidth: 54, alignItems: "center", justifyContent: "center" },
  toolText: { color: colors.accent, fontWeight: "700" },
  disabled: { opacity: .4 },
  center: { flex: 1, justifyContent: "center", minHeight: COUNTER_WHEEL_ROW_HEIGHT * COUNTER_WHEEL_VISIBLE_ROWS + 30 },
  counterTopRow: { width: "100%", flexDirection: "row", alignItems: "center", gap: 8 },
  totalColumn: { flex: COUNTER_TOTAL_COLUMN_FLEX, minWidth: 0, alignItems: "center" },
  totalLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textAlign: "center" },
  total: { width: "100%", color: colors.text, fontSize: 76, fontWeight: "800", paddingHorizontal: 2, paddingVertical: 8, textAlign: "center" },
  wheelArea: { flex: COUNTER_WHEEL_COLUMN_FLEX, minWidth: 0, alignItems: "center", position: "relative" },
  wheelLabel: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: .7, marginBottom: 4, textAlign: "center" },
  wheel: { width: "100%", height: COUNTER_WHEEL_ROW_HEIGHT * COUNTER_WHEEL_VISIBLE_ROWS },
  wheelContent: { alignItems: "center" },
  wheelSpacer: { height: COUNTER_WHEEL_ROW_HEIGHT * 2 },
  wheelRow: { height: COUNTER_WHEEL_ROW_HEIGHT, width: "100%", alignItems: "center", justifyContent: "center" },
  wheelValue: { color: colors.muted, fontSize: 17, fontWeight: "600" },
  wheelSelected: { color: colors.accent, fontSize: 25, fontWeight: "900" },
  wheelSelection: { position: "absolute", top: 16 + COUNTER_WHEEL_ROW_HEIGHT * 2, width: "96%", height: COUNTER_WHEEL_ROW_HEIGHT, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.accent, borderRadius: 8 },
  error: { color: colors.error, fontSize: 12, textAlign: "center" },
  clicker: { flex: 1, minHeight: 160, borderRadius: 20, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  compactClicker: { minHeight: 88 },
  compactArrow: { fontSize: 40 },
  pressed: { opacity: .8 },
  arrow: { color: "#fff", fontSize: 58, fontWeight: "700" },
  addText: { color: "#fff", fontSize: 22, fontWeight: "800" },
});

function CounterWheel({ value, enabled, onChange }: { value: number; enabled: boolean; onChange: (value: number) => void }) {
  const list = useRef<FlatList<number>>(null);
  const [rangeStart, setRangeStart] = useState(() => counterWheelRangeStart(value));
  const rangeEnd = Math.min(Number.MAX_SAFE_INTEGER, rangeStart + COUNTER_WHEEL_WINDOW - 1);
  const [selectedValue, setSelectedValue] = useState(value);
  const selectedValueRef = useRef(value);
  const pendingCenter = useRef<number | null>(null);
  const initialized = useRef(false);
  const values = Array.from({ length: rangeEnd - rangeStart + 1 }, (_, index) => rangeStart + index);
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!enabled) return;
    const next = counterWheelValueFromOffset(event.nativeEvent.contentOffset.y, rangeStart, rangeEnd, selectedValueRef.current);
    if (next === selectedValueRef.current) return;
    selectedValueRef.current = next;
    setSelectedValue(next);
    onChange(next);
    if (shouldRecenterCounterWheel(next, rangeStart, rangeEnd)) {
      pendingCenter.current = next;
      setRangeStart(counterWheelRangeStart(next));
    }
  }, [enabled, onChange, rangeStart, rangeEnd]);

  useEffect(() => {
    if (!enabled) return;
    const center = pendingCenter.current ?? (initialized.current ? null : value);
    if (center !== null) {
      list.current?.scrollToOffset({ offset: Math.max(0, (center - rangeStart) * COUNTER_WHEEL_ROW_HEIGHT), animated: false });
      pendingCenter.current = null;
      initialized.current = true;
      selectedValueRef.current = center;
      setSelectedValue(center);
    }
  }, [enabled, rangeStart, value]);

  useEffect(() => {
    selectedValueRef.current = value;
    setSelectedValue(value);
    if (enabled && initialized.current && !shouldRecenterCounterWheel(value, rangeStart, rangeEnd)) return;
    if (enabled && initialized.current) {
      pendingCenter.current = value;
      setRangeStart(counterWheelRangeStart(value));
    }
  }, [enabled]);

  return <>
    <FlatList
      ref={list}
      accessibilityRole="adjustable"
      accessibilityLabel="Arrow increment"
      accessibilityValue={{ min: 1, max: Number.MAX_SAFE_INTEGER, now: selectedValue, text: `Add ${selectedValue} Arrows` }}
      accessibilityActions={[{ name: "increment", label: "Increase Arrow increment" }, { name: "decrement", label: "Decrease Arrow increment" }]}
      onAccessibilityAction={(event) => onChange(Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, selectedValue + (event.nativeEvent.actionName === "increment" ? 1 : -1))))}
      data={values}
      keyExtractor={(item) => String(item)}
      getItemLayout={(_, index) => ({ length: COUNTER_WHEEL_ROW_HEIGHT, offset: index * COUNTER_WHEEL_ROW_HEIGHT, index })}
      snapToInterval={COUNTER_WHEEL_ROW_HEIGHT}
      snapToAlignment="start"
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
      scrollEnabled={enabled}
      scrollEventThrottle={16}
      onScroll={handleScroll}
      style={styles.wheel}
      contentContainerStyle={styles.wheelContent}
      renderItem={({ item }) => <View style={styles.wheelRow}><Text style={[styles.wheelValue, item === selectedValue && styles.wheelSelected]}>{item === selectedValue ? `+${item}` : item}</Text></View>}
      ListHeaderComponent={<View style={styles.wheelSpacer} />}
      ListFooterComponent={<View style={styles.wheelSpacer} />}
    />
    <View pointerEvents="none" style={styles.wheelSelection} />
  </>;
}

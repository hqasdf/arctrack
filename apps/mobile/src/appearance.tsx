import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActivityIndicator, Appearance, AppState, View } from "react-native";
import * as SystemUI from "expo-system-ui";
import { createAppearanceStore } from "./appearance-store";
import { getThemeColors, type ThemeColors } from "./theme";
import { getCoachPalette } from "./coach-palette";

function makeStore() {
  return createAppearanceStore(AsyncStorage, {
    current: () => Appearance.getColorScheme() === "dark" ? "dark" : "light",
    apply: (preference) => Appearance.setColorScheme(preference === "system" ? "unspecified" : preference),
    listen(callback) {
      const appearance = Appearance.addChangeListener(callback);
      const lifecycle = AppState.addEventListener("change", (state) => { if (state === "active") callback(); });
      return () => { appearance.remove(); lifecycle.remove(); };
    },
  });
}
type Store = ReturnType<typeof makeStore>;
type AppearanceValue = ReturnType<Store["getSnapshot"]> & Pick<Store, "setPreference" | "retry"> & { colors: ThemeColors; coachColors: ReturnType<typeof getCoachPalette> };
const Context = createContext<AppearanceValue | null>(null);
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [store] = useState(makeStore);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => store.start(), [store]);
  const colors = getThemeColors(snapshot.resolvedTheme);
  useEffect(() => { void SystemUI.setBackgroundColorAsync(colors.background).catch(() => {}); }, [colors]);
  if (!snapshot.ready) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}><ActivityIndicator color={colors.accent} accessibilityLabel="Loading appearance" /></View>;
  return <Context.Provider value={{ ...snapshot, colors, coachColors: getCoachPalette(snapshot.resolvedTheme), setPreference: store.setPreference, retry: store.retry }}>{children}</Context.Provider>;
}
export function useAppearance() {
  const value = useContext(Context);
  if (!value) throw new Error("AppearanceProvider is required.");
  return value;
}
export function createThemedStyles<T>(factory: (colors: ThemeColors) => T) {
  const cache = new WeakMap<ThemeColors, T>();
  return function useStyles(): T {
    const { colors } = useAppearance();
    if (!cache.has(colors)) cache.set(colors, factory(colors));
    return cache.get(colors)!;
  };
}

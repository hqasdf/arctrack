import { organizationAppearance } from "./organization-appearance.ts";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
function makeColors(mode: ResolvedTheme) {
  const base = organizationAppearance(mode);
  const dark = mode === "dark";
  return {
    ...base, accent: base.primary,
    soft: dark ? "#2d2823" : "#efebe5",
    inputBorder: dark ? "#8f7e6f" : "#9f9083",
    errorBackground: dark ? "#3c2220" : "#fff0ed",
    errorBorder: dark ? "#965c54" : "#c68478",
    chartSecondary: dark ? "#d6a75f" : "#b4803a",
    overlay: dark ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.45)",
  };
}
const palettes = { light: makeColors("light"), dark: makeColors("dark") };
export type ThemeColors = ReturnType<typeof makeColors>;
export function getThemeColors(mode: ResolvedTheme): ThemeColors { return palettes[mode]; }
// Non-rendering compatibility; screen components subscribe through useAppearance.
export const colors = palettes.light;
export const PAGE_TOP_SPACING = 40;

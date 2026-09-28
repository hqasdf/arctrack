import { colors } from "./theme";

// One tonal step deeper than the athlete app, with the same text and teal accent.
export const coachPalette = {
  background: "#e9e7df", surface: "#f1f0e9", raised: "#e0e4dc",
  text: colors.text, muted: colors.muted, accent: colors.accent,
  border: "#c3ccc2", secondary: "#789083",
  kpiSurface: "#425a4e", kpiBorder: "#536e62", kpiDivider: "#637b6e",
  kpiText: colors.background, kpiMuted: "#e0e7df",
} as const;

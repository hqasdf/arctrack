import { colors } from "./theme.ts";

// A deeper warm-neutral Coach workspace with the same text and teal accent.
export const coachPalette = {
  background: "#e2ded5", surface: "#efebe3", raised: "#d5cfc4",
  text: colors.text, muted: colors.muted, accent: colors.accent,
  border: "#c8cbc2", secondary: "#6f8678",
  kpiSurface: "#394f45", kpiBorder: "#53695e", kpiDivider: "#64796e",
  kpiText: colors.background, kpiMuted: "#e0e7df",
} as const;

import { organizationAppearance } from "./organization-appearance.ts";

function makeCoachPalette(mode: "light" | "dark") {
  const website = organizationAppearance(mode, true);
  return {
    background: website.background, surface: website.surface, raised: website.control,
    text: website.text, muted: website.muted, accent: website.primary,
    onPrimary: website.onPrimary, error: website.error, border: website.border,
    secondary: mode === "dark" ? "#BCA7C7" : "#7A677E",
    kpiSurface: mode === "dark" ? "#4A3044" : "#EBC7CD",
    kpiBorder: website.border, kpiDivider: website.border,
    kpiText: website.text, kpiMuted: website.muted,
    inputBorder: mode === "dark" ? "#AD8A9F" : "#9A7382",
  };
}
const palettes = { light: makeCoachPalette("light"), dark: makeCoachPalette("dark") };
export type CoachPalette = ReturnType<typeof makeCoachPalette>;
export function getCoachPalette(mode: "light" | "dark"): CoachPalette { return palettes[mode]; }
// Static compatibility for non-rendering consumers; UI reads the appearance context.
export const coachPalette = palettes.light;

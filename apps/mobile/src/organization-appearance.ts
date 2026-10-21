// Website globals.css/theme.css and the Head Coach coach.module.css overrides.
// Shared website palette source for mobile appearance and organisation surfaces.
const light = {
  background: "#f7f5f1", surface: "#fffefa", control: "#ffffff", text: "#382a24",
  muted: "#75665c", primary: "#563d30", onPrimary: "#ffffff", border: "#ded6cd",
  soft: "#fbefe5", error: "#8b2920",
};
const dark: typeof light = {
  background: "#181715", surface: "#24211e", control: "#24211e", text: "#f1e8df",
  muted: "#bcada0", primary: "#e6b895", onPrimary: "#241a13", border: "#51473d",
  soft: "#342923", error: "#ffb4a9",
};
const coachLight: typeof light = {
  ...light, background: "#F3E1DB", surface: "#FFF8F1", control: "#FFFCF8",
  text: "#452A35", muted: "#6A525F", primary: "#A04A66", onPrimary: "#FFFCF8",
  border: "#D7BFC4", soft: "#E4BBC5",
};
const coachDark: typeof light = {
  ...dark, background: "#281C29", surface: "#3D2B3D", control: "#463146",
  text: "#FFF2F4", muted: "#BBAFB8", primary: "#E6A0B2", onPrimary: "#281C29",
  border: "#60485B", soft: "#583449",
};
export function organizationAppearance(scheme: "light" | "dark" | "unspecified" | null | undefined, coach = false) {
  return coach ? (scheme === "dark" ? coachDark : coachLight) : (scheme === "dark" ? dark : light);
}

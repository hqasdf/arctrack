export type ThemePreference = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "arc-track:theme:v1";
const CHANGE_EVENT = "arc-track:theme-change";
let temporaryPreference: ThemePreference | null = null;

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}
export function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  if (temporaryPreference) return temporaryPreference;
  try { return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY)); }
  catch { return "system"; }
}
export function setThemePreference(value: ThemePreference) {
  if (typeof window === "undefined") return;
  temporaryPreference = parseThemePreference(value);
  try { window.localStorage.setItem(THEME_STORAGE_KEY, temporaryPreference); }
  catch { /* Appearance still works for this page when browser storage is blocked. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
export function subscribeThemePreference(notify: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    temporaryPreference = null;
    notify();
  }
  window.addEventListener(CHANGE_EVENT, notify);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, notify);
    window.removeEventListener("storage", onStorage);
  };
}
export const serverThemePreference = (): ThemePreference => "system";

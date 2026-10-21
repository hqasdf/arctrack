import type { ResolvedTheme, ThemePreference } from "./theme";
export const APPEARANCE_STORAGE_KEY = "arc-track:mobile-appearance:v1";
export function parsePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
type Driver = { current(): ResolvedTheme; apply(preference: ThemePreference): void; listen(callback: () => void): () => void };
export function createAppearanceStore(storage: Storage, driver: Driver) {
  let snapshot = { preference: "system" as ThemePreference, resolvedTheme: driver.current(), ready: false, error: null as string | null };
  const listeners = new Set<() => void>();
  let revision = 0;
  let queue = Promise.resolve();
  function publish(next: typeof snapshot) { snapshot = next; listeners.forEach((listener) => listener()); }
  function resolve(preference: ThemePreference): ResolvedTheme { return preference === "system" ? driver.current() : preference; }
  async function restore() {
    const initialRevision = revision;
    try {
      const preference = parsePreference(await storage.getItem(APPEARANCE_STORAGE_KEY));
      if (initialRevision !== revision) return;
      driver.apply(preference);
      publish({ preference, resolvedTheme: resolve(preference), ready: true, error: null });
    } catch {
      if (initialRevision === revision) publish({ ...snapshot, ready: true, error: "Appearance preference could not be loaded. Retry or choose an appearance." });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() {
      const stop = driver.listen(() => {
        const resolvedTheme = resolve(snapshot.preference);
        if (resolvedTheme !== snapshot.resolvedTheme) publish({ ...snapshot, resolvedTheme });
      });
      void restore();
      return stop;
    },
    retry: restore,
    setPreference(preference: ThemePreference) {
      revision++;
      driver.apply(preference);
      publish({ preference, resolvedTheme: resolve(preference), ready: true, error: null });
      const operation = queue.then(() => storage.setItem(APPEARANCE_STORAGE_KEY, preference));
      queue = operation.catch(() => {});
      return operation.catch(() => {
        if (snapshot.preference === preference) publish({ ...snapshot, error: "Appearance changed, but could not be saved. Select it again to retry." });
      });
    },
  };
}

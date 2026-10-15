export const BIOMETRIC_BACKGROUND_MS = 60_000;
export const biometricPreferenceKey = (userId: string) => `arc-track.biometric-unlock.v1.${userId}`;
export type BiometricAvailability = { available: boolean; label: string; reason: string | null };
export type LockSnapshot = {
  userId: string | null; loaded: boolean; enabled: boolean; locked: boolean;
  obscured: boolean; busy: boolean; error: string | null; hasUnlocked: boolean;
};
type Dependencies = {
  readPreference: (key: string) => Promise<string | null>;
  writePreference: (key: string, value: string) => Promise<void>;
  removePreference: (key: string) => Promise<void>;
  authenticate: () => Promise<{ success: boolean; message?: string }>;
  verifySession: (userId: string) => Promise<"valid" | "signed-out" | "unavailable">;
  onInvalidSession: () => Promise<void>;
  now?: () => number;
};

/** Local UI lock only. Supabase still verifies identity and authorizes every request. */
export class BiometricLock {
  private snapshot: LockSnapshot = { userId: null, loaded: false, enabled: false, locked: true, obscured: false, busy: false, error: null, hasUnlocked: false };
  private listeners = new Set<() => void>();
  private accountVersion = 0;
  private attemptVersion = 0;
  private prompting = false;
  private preferenceKnown = false;
  private writes: Promise<void> = Promise.resolve();
  private appState = "active";
  private backgroundAt: number | null = null;
  private resumeUnlocked = false;
  private dependencies: Dependencies;
  constructor(dependencies: Dependencies) { this.dependencies = dependencies; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(change: Partial<LockSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach(listener => listener());
  }
  private save(userId: string, enabled: boolean) {
    // A delayed enable write must not finish after sign-out's cleanup of that account.
    const key = biometricPreferenceKey(userId);
    const task = this.writes.catch(() => {}).then(() => enabled
      ? this.dependencies.writePreference(key, "1") : this.dependencies.removePreference(key));
    this.writes = task;
    return task;
  }
  setUser(userId: string | null) {
    if (this.snapshot.userId === userId && this.snapshot.loaded) return;
    ++this.accountVersion; ++this.attemptVersion;
    this.preferenceKnown = false;
    this.backgroundAt = null; this.resumeUnlocked = false;
    this.publish({ userId, loaded: !userId, enabled: false, locked: !!userId, busy: false, error: null, hasUnlocked: false });
    if (userId) void this.loadPreference();
  }
  private async loadPreference() {
    const { userId } = this.snapshot;
    if (!userId) return;
    const version = this.accountVersion;
    this.publish({ loaded: false, locked: true, error: null });
    try {
      await this.writes.catch(() => {});
      const stored = await this.dependencies.readPreference(biometricPreferenceKey(userId));
      if (version !== this.accountVersion) return;
      if (stored !== null && stored !== "1") throw new Error("Invalid local preference");
      this.preferenceKnown = true;
      this.publish({ loaded: true, enabled: stored === "1", locked: stored === "1", hasUnlocked: stored !== "1" });
      if (stored === "1") void this.unlock();
    } catch {
      if (version === this.accountVersion) this.publish({ loaded: true, enabled: true, locked: true, error: "Unlock settings could not be read. Retry or sign out." });
    }
  }
  async signedOut() {
    const userId = this.snapshot.userId;
    this.setUser(null); // Invalidate pending native results before any storage I/O.
    if (userId) await this.save(userId, false);
  }
  retry = async () => { if (!this.preferenceKnown) await this.loadPreference(); else await this.unlock(); };
  private async authenticate(enabling: boolean) {
    const { userId, loaded, locked } = this.snapshot;
    if (!userId || !loaded || this.prompting || this.appState !== "active" || (enabling && locked)) return;
    this.prompting = true;
    const account = this.accountVersion, attempt = ++this.attemptVersion;
    const current = () => account === this.accountVersion && attempt === this.attemptVersion && this.appState === "active";
    this.publish({ busy: true, error: null });
    try {
      const result = await this.dependencies.authenticate();
      if (!current()) return;
      if (!result.success) { this.publish({ error: result.message ?? "Not unlocked. Retry or sign out to use your password." }); return; }
      const identity = await this.dependencies.verifySession(userId);
      if (!current()) return;
      if (identity !== "valid") {
        this.publish({ error: identity === "signed-out" ? "Sign in again to continue." : "Your sign-in could not be checked. Check your connection and retry." });
        if (identity === "signed-out") await this.dependencies.onInvalidSession();
        return;
      }
      if (enabling) {
        await this.save(userId, true);
        if (account === this.accountVersion && !current()) this.publish({ enabled: true, locked: true });
      }
      if (!current()) return;
      this.publish({ enabled: true, locked: false, error: null, hasUnlocked: true });
    } catch {
      if (current()) this.publish({ error: "Biometric unlock could not be completed. Retry or sign out." });
    } finally {
      this.prompting = false;
      this.publish({ busy: false });
    }
  }
  unlock = async () => {
    if (this.snapshot.enabled && this.snapshot.locked) await this.authenticate(false);
  };
  setEnabled = async (enabled: boolean) => {
    if (enabled) { await this.authenticate(true); return; }
    const { userId, locked, busy } = this.snapshot;
    if (!userId || locked || busy) return;
    const version = this.accountVersion;
    this.publish({ busy: true, error: null });
    try {
      await this.save(userId, false);
      if (version === this.accountVersion) this.publish({ enabled: false });
    } catch {
      if (version === this.accountVersion) this.publish({ error: "Unlock settings could not be saved. Please retry." });
    } finally { if (version === this.accountVersion) this.publish({ busy: false }); }
  };
  appStateChanged(next: string) {
    const now = (this.dependencies.now ?? Date.now)();
    this.appState = next;
    if (next !== "active") {
      // Native prompts can cause inactive/active transitions; those are not app switching.
      if (this.backgroundAt === null && (!this.prompting || next === "background")) {
        this.backgroundAt = now;
        this.resumeUnlocked = !this.snapshot.locked && !this.prompting;
      }
      if (next === "background") {
        ++this.attemptVersion;
        if (this.snapshot.enabled) this.publish({ locked: true });
      }
      this.publish({ obscured: true });
      return;
    }
    const elapsed = this.backgroundAt === null ? null : now - this.backgroundAt;
    if (elapsed !== null && this.snapshot.enabled) {
      this.publish({ locked: !this.resumeUnlocked || elapsed >= BIOMETRIC_BACKGROUND_MS });
    }
    this.backgroundAt = null;
    this.publish({ obscured: false });
    if (elapsed !== null && this.snapshot.locked && this.snapshot.loaded && this.snapshot.enabled) void this.unlock();
  }
  dispose() { ++this.accountVersion; ++this.attemptVersion; this.listeners.clear(); }
}

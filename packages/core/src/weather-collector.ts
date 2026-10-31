import { weatherFailureState, WEATHER_REFRESH_MS, type ApproximateLocation, type WeatherSnapshot, type WeatherSuccess } from "./weather-model.ts";

export type WeatherState = {
  status: "loading" | "ready" | "unavailable";
  readings: WeatherSnapshot[];
  enabled: boolean;
  nextRefreshAt: string | null;
  message?: string;
  retry?: () => void;
};
export type WeatherCollectorDependencies = {
  load(): Promise<WeatherSuccess>;
  locate(): Promise<ApproximateLocation>;
  capture(location: ApproximateLocation): Promise<WeatherSuccess>;
  onChange(state: WeatherState): void;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  random?: () => number;
  clearTimer?: (handle: unknown) => void;
};
const timers = globalThis as unknown as {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

/** One foreground collector; pausing never aborts or delays an Arrow operation. */
export class WeatherCollector {
  private active = false;
  private disposed = false;
  private generation = 0;
  private busy = false;
  private pending = false;
  private timer: unknown;
  private failures = 0;
  private retryNotBefore=0;
  private locationDenied = false;
  private state: WeatherState = { status: "loading", readings: [], enabled: false, nextRefreshAt: null };
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private readonly dependencies: WeatherCollectorDependencies;

  constructor(dependencies: WeatherCollectorDependencies) {
    this.dependencies = dependencies;
    this.now = dependencies.now ?? Date.now;
    this.setTimer = dependencies.setTimer ?? ((callback, delayMs) => timers.setTimeout(callback, delayMs));
    this.clearTimer = dependencies.clearTimer ?? ((handle) => timers.clearTimeout(handle));
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    this.generation++;
    this.cancelTimer();
    if (active) {
      // Recheck current permission on resume; platform helpers still suppress repeat prompts.
      this.locationDenied = false;this.failures=0;
      void this.refresh();
    }
  }

  retry(): void {
    if(!this.active||this.disposed||this.busy||this.now()<this.retryNotBefore)return;
    this.failures=0;this.locationDenied=false;this.cancelTimer();void this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    this.active = false;
    this.generation++;
    this.pending = false;
    this.cancelTimer();
  }

  private valid(generation: number): boolean {
    return this.active && !this.disposed && generation === this.generation;
  }
  private cancelTimer(): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }
  private publish(next: WeatherState): void {
    this.state = next;
    this.dependencies.onChange(next);
  }
  private schedule(delayMs: number): void {
    this.cancelTimer();
    if (!this.active || this.disposed) return;
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      void this.refresh();
    }, Math.max(0, delayMs));
  }
  private accept(result: WeatherSuccess): void {
    this.publish({ status: "ready", readings: result.readings, enabled: result.enabled, nextRefreshAt: result.nextRefreshAt });
  }
  private dueAt(result: WeatherSuccess): number {
    const value = result.nextRefreshAt === null ? this.now() : Date.parse(result.nextRefreshAt);
    return Number.isFinite(value) ? value : this.now() + WEATHER_REFRESH_MS;
  }
  private async refresh(): Promise<void> {
    if (!this.active || this.disposed) return;
    if (this.busy) { this.pending = true; return; }
    this.busy = true;
    const generation = this.generation;
    try {
      const result = await this.dependencies.load();
      if (!this.valid(generation)) return;
      this.accept(result);
      if (!result.enabled || this.locationDenied) return;
      const remaining = this.dueAt(result) - this.now();
      if (remaining > 0) { this.failures = 0; this.schedule(remaining); return; }
      const location = await this.dependencies.locate();
      if (!this.valid(generation)) return;
      const captured = await this.dependencies.capture(location);
      if (!this.valid(generation)) return;
      this.failures = 0;
      this.accept(captured);
      if (captured.enabled) {
        // A different device may hold a short lease: re-read when that lease expires.
        const nextDue = captured.nextRefreshAt === null ? NaN : Date.parse(captured.nextRefreshAt);
        this.schedule(Number.isFinite(nextDue) ? Math.max(1000, nextDue - this.now()) : WEATHER_REFRESH_MS);
      }
    } catch (error) {
      if (!this.valid(generation)) return;
      this.locationDenied = !!error && typeof error === "object" && "noRetry" in error && error.noRetry === true;
      this.publish(weatherFailureState(this.state,error));
      const retryAt = error && typeof error === "object" && "retryAt" in error && typeof error.retryAt === "string" ? Date.parse(error.retryAt) : NaN;
      this.retryNotBefore=Number.isFinite(retryAt)?retryAt:0;
      if (!this.locationDenied && this.failures < 3) {
        const backoff = [60_000, 5 * 60_000, 15 * 60_000][Math.min(this.failures++, 2)];
        const jitter=1+Math.max(0,Math.min(1,this.dependencies.random?.()??Math.random()))*.1;
        this.schedule(Number.isFinite(retryAt) ? Math.max(backoff*jitter, retryAt - this.now()) : backoff*jitter);
      }
    } finally {
      this.busy = false;
      if (this.pending) {
        this.pending = false;
        if (this.active && !this.disposed) void this.refresh();
      }
    }
  }
}

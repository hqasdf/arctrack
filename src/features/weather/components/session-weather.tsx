"use client";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { WeatherCollector, type WeatherState } from "@arc-track/core/weather-collector";
import { canCollectWeather, compassDirection, conditionDescription, isWeatherDistance, WEATHER_REFRESH_MS,
  type WeatherResponse, type WeatherSnapshot, type WeatherSuccess } from "@arc-track/core/weather";
import type { RoundDraft } from "@arc-track/core/scoring";
import styles from "./session-weather.module.css";
import { locateForWeather } from "../location.client";

const initial: WeatherState = { status: "loading", readings: [], enabled: false, nextRefreshAt: null };
const visible = () => document.visibilityState === "visible" && document.hasFocus();
const serverVisible = () => false;
function subscribeVisibility(callback: () => void) {
  document.addEventListener("visibilitychange", callback);
  window.addEventListener("focus", callback); window.addEventListener("blur", callback);
  return () => { document.removeEventListener("visibilitychange", callback); window.removeEventListener("focus", callback); window.removeEventListener("blur", callback); };
}
async function requestWeather(sessionId: string, roundId?: string, location?: { latitude: number; longitude: number }): Promise<WeatherSuccess> {
  const response = await fetch(`/api/session-weather?sessionId=${encodeURIComponent(sessionId)}`, {
    method: roundId ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(20_000),
    ...(roundId ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roundId, location }) } : {}),
  });
  const result = await response.json() as WeatherResponse;
  if (!response.ok || !result.ok) throw Object.assign(new Error("Weather unavailable"), { noRetry: response.status === 401 || response.status === 403 });
  return result;
}
function useWeather(sessionId: string, sessionDate?: string, round?: RoundDraft, collecting = false) {
  const foreground = useSyncExternalStore(subscribeVisibility, visible, serverVisible);
  const [state, setState] = useState<WeatherState>(initial);
  const [now, setNow] = useState(Date.now);
  const context = useRef({ round, sessionDate, collecting });
  useLayoutEffect(() => { context.current = { round, sessionDate, collecting }; }, [round, sessionDate, collecting]);
  const collector = useRef<WeatherCollector | null>(null);
  const eligible = !!round && !!sessionDate && canCollectWeather({ distance: round.distanceMetres, sessionDate,
    plannedEnds: round.ends, arrowsPerEnd: round.arrowsPerEnd, arrows: round.arrows }, now);
  const active = foreground && collecting && eligible;
  const roundId = round?.id;
  useEffect(() => {
    if (!roundId) return;
    const allowed = () => {
      const current = context.current;
      return visible() && current.collecting && !!current.round && !!current.sessionDate && canCollectWeather({
        distance: current.round.distanceMetres, sessionDate: current.sessionDate, plannedEnds: current.round.ends,
        arrowsPerEnd: current.round.arrowsPerEnd, arrows: current.round.arrows }, Date.now());
    };
    const instance = new WeatherCollector({ load: () => requestWeather(sessionId), locate: () => locateForWeather(allowed),
      capture: location => allowed() ? requestWeather(sessionId, roundId, location) : Promise.reject(Object.assign(new Error("Weather paused"), { noRetry: true })), onChange: next => { setNow(Date.now()); setState(next); } });
    collector.current = instance;
    return () => { instance.dispose(); if (collector.current === instance) collector.current = null; };
  }, [sessionId, roundId]);
  useEffect(() => subscribeVisibility(() => {
    const current = context.current;
    const allowed = visible() && current.collecting && !!current.round && !!current.sessionDate && canCollectWeather({
      distance: current.round.distanceMetres, sessionDate: current.sessionDate, plannedEnds: current.round.ends,
      arrowsPerEnd: current.round.arrowsPerEnd, arrows: current.round.arrows }, Date.now());
    collector.current?.setActive(allowed);
    setNow(Date.now());
  }), []);
  useEffect(() => { collector.current?.setActive(active); }, [active, sessionId, roundId]);
  useEffect(() => {
    if (active || !foreground) return;
    let cancelled = false;
    void requestWeather(sessionId).then(result => { if (!cancelled) { setNow(Date.now()); setState({ status: "ready", ...result }); } })
      .catch(() => { if (!cancelled) setState({ ...initial, status: "unavailable" }); });
    return () => { cancelled = true; };
  }, [sessionId, active, foreground]);
  return { ...state, now };
}
function time(value: string) { return `${new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ")} SGT`; }
const measurement = (value: number | null, unit: string) => value === null ? "—" : `${value}${unit}`;
function WindDirection({ degrees }: { degrees: number | null }) {
  if (degrees === null || !Number.isFinite(degrees) || degrees < 0 || degrees > 360) return <span className={styles.directionUnavailable}>Direction unavailable</span>;
  const towardDegrees = (degrees + 180) % 360;
  const from = compassDirection(degrees);
  const toward = compassDirection(towardDegrees);
  return <div className={styles.direction} aria-label={`Wind from ${from}, blowing toward ${toward}`}>
    <svg className={styles.compass} viewBox="0 0 72 72" aria-hidden="true">
      <circle className={styles.compassRing} cx="36" cy="36" r="29" />
      <text className={styles.compassPoint} x="36" y="13" textAnchor="middle">N</text>
      <text className={styles.compassPoint} x="59" y="39" textAnchor="middle">E</text>
      <text className={styles.compassPoint} x="36" y="66" textAnchor="middle">S</text>
      <text className={styles.compassPoint} x="13" y="39" textAnchor="middle">W</text>
      <g transform={`rotate(${towardDegrees} 36 36)`}>
        <path className={styles.windArrow} d="M36 53V24 M27 33l9-10 9 10" />
      </g>
    </svg>
    <span>From {from} · toward {toward}</span>
  </div>;
}
function Reading({ reading, stale = false, compact = false }: { reading: WeatherSnapshot; stale?: boolean; compact?: boolean }) {
  if (compact) return <div className={styles.historyReading}>
    <div><strong>{measurement(reading.temperatureC, "°C")}</strong><span>{conditionDescription(reading.conditionCode)}</span></div>
    <div><strong>{measurement(reading.windSpeedKph, " km/h")}</strong><span>Wind from {compassDirection(reading.windDirectionDegrees)}{reading.windDirectionDegrees === null ? "" : ` · toward ${compassDirection((reading.windDirectionDegrees + 180) % 360)}`}</span></div>
    <small>Observed {time(reading.observedAt)}{stale ? " · not current" : ""} · Gust {measurement(reading.windGustKph, " km/h")} · Humidity {measurement(reading.humidityPercent, "%")}</small>
  </div>;
  return <>
    <div className={styles.primaryGrid}>
      <div className={styles.primaryMetric}>
        <span className={styles.metricLabel}>Temperature</span>
        <strong className={styles.temperature}>{measurement(reading.temperatureC, "°C")}</strong>
        <span className={styles.condition}>{conditionDescription(reading.conditionCode)}</span>
      </div>
      <div className={styles.primaryMetric}>
        <span className={styles.metricLabel}>Wind</span>
        <div className={styles.windRow}>
          <strong className={styles.windSpeed}>{measurement(reading.windSpeedKph, " km/h")}</strong>
          <WindDirection degrees={reading.windDirectionDegrees}/>
        </div>
      </div>
    </div>
    <div className={styles.secondaryGrid}>
      <div><span>Gusts</span><strong>{measurement(reading.windGustKph, " km/h")}</strong></div>
      <div><span>Humidity</span><strong>{measurement(reading.humidityPercent, "%")}</strong></div>
      <div><span>Wind direction</span><strong>{reading.windDirectionDegrees === null ? "—" : `${compassDirection(reading.windDirectionDegrees)} · ${measurement(reading.windDirectionDegrees, "°")}`}</strong></div>
    </div>
    <div className={styles.observation}>
      <span>{stale ? "Saved observation · not current" : "Observed"}</span>
      <time dateTime={reading.observedAt}>{time(reading.observedAt)}</time>
    </div>
  </>;
}
function Panel({ sessionId, sessionDate, round, collecting, history = false }: { sessionId: string; sessionDate?: string; round?: RoundDraft; collecting?: boolean; history?: boolean }) {
  const state = useWeather(sessionId, sessionDate, round, collecting);
  const latest = state.readings[0];
  if (history && !latest) return null;
  const stale = latest && (state.status === "unavailable" || state.now - Date.parse(latest.observedAt) >= WEATHER_REFRESH_MS);
  if (history) return <details className={styles.historyDisclosure}>
    <summary><strong>Saved weather</strong><span>{measurement(latest!.temperatureC, "°C")} · Wind {measurement(latest!.windSpeedKph, " km/h")}</span></summary>
    <div className={styles.historyBody}>
      <div className={styles.historyList}>{state.readings.map((reading, index) => <Reading key={reading.id} reading={reading} compact={true} stale={index > 0 || !!stale}/>)}</div>
      <a className={styles.attribution} href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo</a>
    </div>
  </details>;
  return <section className={styles.panel} aria-label="Shooting conditions">
    <div className={styles.heading}>
      <div className={styles.headingTitle}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 10a3.5 3.5 0 0 0 1 7Z"/><path d="M8 20h8m-6 3h4"/></svg><div><h3>Shooting Conditions</h3><span>Estimated local weather</span></div></div>
      {latest && <span className={stale ? styles.statusStale : styles.statusReady}>{stale ? "Saved" : "Current"}</span>}
    </div>
    {latest ? <Reading reading={latest} stale={!!stale}/> : <p className={styles.stateMessage} role="status">{state.status === "loading" ? "Checking conditions…" : "Weather unavailable"}</p>}
    {latest && state.status === "unavailable" && <p className={styles.stateMessage} role="status">Weather unavailable. This saved observation is retained.</p>}
    <a className={styles.attribution} href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo</a>
  </section>;
}
export function ScoringWeather(props: { sessionId: string; sessionDate: string; round: RoundDraft; collecting: boolean }) {
  return isWeatherDistance(props.round.distanceMetres) ? <Panel key={props.round.id} {...props}/> : null;
}
export function SessionWeatherHistory({ sessionId }: { sessionId: string }) { return <Panel key={sessionId} sessionId={sessionId} history/>; }

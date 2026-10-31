import { weatherFailureState, canCollectWeather } from "@arc-track/core/weather";
import { WeatherCollector, type WeatherState } from "@arc-track/core/weather-collector";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { ArrowEntry, RoundDraft, SessionDraft } from "@arc-track/core/scoring";
import { useAuth } from "./auth";
import { mobileWeatherApi } from "./weather-api";
import { locateForWeather } from "./weather-location";

const initial: WeatherState = { status: "loading", readings: [], enabled: false, nextRefreshAt: null };

/** Independent foreground weather lifecycle; it never reads or mutates scoring queues. */
export function useSessionWeather(session: SessionDraft, round?: RoundDraft, arrows: readonly ArrowEntry[] = []) {
  const { user } = useAuth();
  const userId = user?.id;
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [state, setState] = useState<WeatherState & {scope?:string}>(initial);
  const scope=`${userId??""}:${session.id}`;
  const [attempt,setAttempt]=useState(0);
  const collector = useRef<WeatherCollector | null>(null);
  const permitted = useRef(false);
  const context = useRef({ session, round, arrows });
  context.current = { session, round, arrows };
  const eligible = !!round && canCollectWeather({ distance: round.distanceMetres, sessionDate: session.date,
    plannedEnds: round.ends, arrowsPerEnd: round.arrowsPerEnd, arrows }, Date.now());
  const active = !!userId && focused && foreground && eligible && mobileWeatherApi.available;
  permitted.current = active;

  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => { permitted.current = false; collector.current?.setActive(false); setFocused(false); };
  }, []));
  useEffect(() => {
    const listener = AppState.addEventListener("change", next => {
      if (next !== "active") { permitted.current = false; collector.current?.setActive(false); }
      setForeground(next === "active");
    });
    return () => listener.remove();
  }, []);

  const sessionId = session.id;
  const roundId = round?.id;
  useEffect(() => {
    if (!userId || !roundId || !mobileWeatherApi.available) return;
    const allowedNow = () => {
      const current = context.current;
      return permitted.current && !!current.round && canCollectWeather({ distance: current.round.distanceMetres,
        sessionDate: current.session.date, plannedEnds: current.round.ends, arrowsPerEnd: current.round.arrowsPerEnd,
        arrows: current.arrows }, Date.now());
    };
    const instance = new WeatherCollector({
      load: () => mobileWeatherApi.load(sessionId),
      locate: () => locateForWeather(allowedNow),
      capture: location => {
        if (!allowedNow()) return Promise.reject(Object.assign(new Error("Weather collection paused."), { noRetry: true }));
        return mobileWeatherApi.capture(sessionId, roundId, location);
      },
      onChange: next=>setState({...next,scope}),
    });
    collector.current = instance;
    return () => { instance.dispose(); if (collector.current === instance) collector.current = null; };
  }, [sessionId, roundId, userId, scope]);
  useEffect(() => { collector.current?.setActive(active); }, [active, sessionId, roundId, userId]);

  // History-only views (including old/completed Rounds) must never request location.
  useEffect(() => {
    if (active || !focused || !foreground || !userId) return;
    let cancelled = false;
    if (!mobileWeatherApi.available) return;
    void mobileWeatherApi.load(sessionId).then(result => {
      if (!cancelled) setState({ status: "ready", readings: result.readings, enabled: result.enabled, nextRefreshAt: result.nextRefreshAt,scope });
    }).catch(error => { if (!cancelled) setState(previous=>({...weatherFailureState(previous.scope===scope?previous:initial,error),scope})); });
    return () => { cancelled = true; };
  }, [sessionId, active, focused, foreground, userId, attempt, scope]);
  const shown=mobileWeatherApi.available ? state.scope===scope?state:initial : { ...initial, status: "unavailable" as const };
  return {...shown,retry:()=>{if(active)collector.current?.retry();else setAttempt(value=>value+1);}};
}

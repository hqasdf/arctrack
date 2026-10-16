import { WEATHER_REFRESH_MS, compassDirection, conditionDescription, isWeatherDistance, type WeatherSnapshot } from "@arc-track/core/weather";
import type { ArrowEntry, RoundDraft, SessionDraft } from "@arc-track/core/scoring";
import type { WeatherState } from "@arc-track/core/weather-collector";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Path, Text as SvgText } from "react-native-svg";
import { colors } from "./theme";
import { useSessionWeather } from "./use-session-weather";

const measurement = (value: number | null, unit: string) => value === null ? "—" : `${value}${unit}`;
function observedTime(value: string) {
  return `${new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ")} SGT`;
}
function WindCompass({ degrees }: { degrees: number | null }) {
  if (degrees === null || !Number.isFinite(degrees) || degrees < 0 || degrees > 360) return <Text style={styles.directionUnavailable}>Direction unavailable</Text>;
  const towardDegrees = (degrees + 180) % 360;
  const from = compassDirection(degrees);
  const toward = compassDirection(towardDegrees);
  return <View style={styles.compassWrap} accessibilityLabel={`Wind from ${from}, blowing toward ${toward}`}>
    <Svg width={68} height={68} viewBox="0 0 72 72" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx="36" cy="36" r="29" fill={colors.surface} stroke={colors.border} strokeWidth="1.5" />
      <SvgText x="36" y="13" textAnchor="middle" fontSize="6" fontWeight="700" fill={colors.muted}>N</SvgText>
      <SvgText x="59" y="39" textAnchor="middle" fontSize="6" fontWeight="700" fill={colors.muted}>E</SvgText>
      <SvgText x="36" y="66" textAnchor="middle" fontSize="6" fontWeight="700" fill={colors.muted}>S</SvgText>
      <SvgText x="13" y="39" textAnchor="middle" fontSize="6" fontWeight="700" fill={colors.muted}>W</SvgText>
      <G rotation={towardDegrees} originX={36} originY={36}>
        <Path d="M36 53V24 M27 33l9-10 9 10" fill="none" stroke={colors.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </G>
    </Svg>
    <Text style={styles.directionLabel}>From {from} · toward {toward}</Text>
  </View>;
}
function CompactReading({ reading, stale }: { reading: WeatherSnapshot; stale: boolean }) {
  return <View style={styles.historyReading}>
    <View style={styles.historyReadingColumns}>
      <View style={styles.historyReadingMetric}><Text style={styles.historyValue}>{measurement(reading.temperatureC, "°C")}</Text><Text style={styles.historyLabel}>{conditionDescription(reading.conditionCode)}</Text></View>
      <View style={styles.historyReadingMetric}><Text style={styles.historyValue}>{measurement(reading.windSpeedKph, " km/h")}</Text><Text style={styles.historyLabel}>Wind from {compassDirection(reading.windDirectionDegrees)}{reading.windDirectionDegrees === null ? "" : ` · toward ${compassDirection((reading.windDirectionDegrees + 180) % 360)}`}</Text></View>
    </View>
    <Text style={styles.historyMeta}>Observed {observedTime(reading.observedAt)}{stale ? " · not current" : ""} · Gust {measurement(reading.windGustKph, " km/h")} · Humidity {measurement(reading.humidityPercent, "%")}</Text>
  </View>;
}
function WeatherPanel({ state }: { state: WeatherState }) {
  const reading = state.readings[0];
  const stale = reading && (state.status === "unavailable" || Date.now() - Date.parse(reading.observedAt) >= WEATHER_REFRESH_MS);
  return <View style={styles.panel} accessibilityLabel="Shooting conditions">
    <View style={styles.header}>
      <View style={styles.titleGroup}>
        <View style={styles.weatherIcon}><Text style={styles.weatherIconText}>☁</Text></View>
        <View><Text style={styles.heading}>Shooting Conditions</Text><Text style={styles.subheading}>Estimated local weather</Text></View>
      </View>
      {reading ? <Text style={[styles.status, stale ? styles.statusStale : styles.statusCurrent]}>{stale ? "Saved" : "Current"}</Text> : null}
    </View>
    {reading ? <>
      <View style={styles.primaryGrid}>
        <View style={styles.primaryMetric}>
          <Text style={styles.metricLabel}>TEMPERATURE</Text>
          <Text style={styles.temperature}>{measurement(reading.temperatureC, "°C")}</Text>
          <Text style={styles.condition}>{conditionDescription(reading.conditionCode)}</Text>
        </View>
        <View style={styles.primaryMetric}>
          <Text style={styles.metricLabel}>WIND</Text>
          <View style={styles.windRow}><Text style={styles.windSpeed}>{measurement(reading.windSpeedKph, " km/h")}</Text><WindCompass degrees={reading.windDirectionDegrees}/></View>
        </View>
      </View>
      <View style={styles.secondaryGrid}>
        <View style={styles.secondaryMetric}><Text style={styles.metricLabel}>GUSTS</Text><Text style={styles.secondaryValue}>{measurement(reading.windGustKph, " km/h")}</Text></View>
        <View style={styles.secondaryMetric}><Text style={styles.metricLabel}>HUMIDITY</Text><Text style={styles.secondaryValue}>{measurement(reading.humidityPercent, "%")}</Text></View>
        <View style={styles.secondaryMetric}><Text style={styles.metricLabel}>DIRECTION</Text><Text style={styles.secondaryValue}>{reading.windDirectionDegrees === null ? "—" : `${compassDirection(reading.windDirectionDegrees)} · ${measurement(reading.windDirectionDegrees, "°")}`}</Text></View>
      </View>
      <View style={styles.observation}><Text style={styles.observationLabel}>{stale ? "Saved observation · not current" : "Observed"}</Text><Text style={styles.observationTime}>{observedTime(reading.observedAt)}</Text></View>
    </> : <Text accessibilityRole="text" style={styles.message}>{state.status === "loading" ? "Checking conditions…" : "Weather unavailable. Scoring is unaffected."}</Text>}
    {reading && state.status === "unavailable" ? <Text style={styles.message}>Weather unavailable. This saved observation is retained.</Text> : null}
    <Pressable accessibilityRole="link" onPress={() => void Linking.openURL("https://open-meteo.com/")} style={styles.attribution}>
      <Text style={styles.attributionText}>Weather data by Open-Meteo</Text>
    </Pressable>
  </View>;
}
export function ScoringWeather({ session, round, arrows }: { session: SessionDraft; round: RoundDraft; arrows: ArrowEntry[] }) {
  return isWeatherDistance(round.distanceMetres) ? <ActiveWeather session={session} round={round} arrows={arrows}/> : null;
}
function ActiveWeather({ session, round, arrows }: { session: SessionDraft; round: RoundDraft; arrows: ArrowEntry[] }) {
  const state = useSessionWeather(session, round, arrows);
  return <WeatherPanel state={state}/>;
}
export function SessionWeatherHistory({ session }: { session: SessionDraft }) {
  const state = useSessionWeather(session);
  const [expanded, setExpanded] = useState(false);
  const readings = [...state.readings].sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt));
  if (!readings.length) return null;
  const latest = readings[0];
  return <View style={styles.historyDisclosure}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.historySummary}>
      <Text style={styles.historyTitle}>Saved weather</Text>
      <Text style={styles.historyPreview}>{measurement(latest.temperatureC, "°C")} · Wind {measurement(latest.windSpeedKph, " km/h")}</Text>
      <Text style={styles.historyToggle}>{expanded ? "−" : "+"}</Text>
    </Pressable>
    {expanded ? <View style={styles.historyBody}>
      {readings.map((reading, index) => <CompactReading key={reading.id} reading={reading} stale={index > 0 || state.status === "unavailable" || Date.now() - Date.parse(reading.observedAt) >= WEATHER_REFRESH_MS}/>)}
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL("https://open-meteo.com/")} style={styles.attribution}><Text style={styles.attributionText}>Weather data by Open-Meteo</Text></Pressable>
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  panel: { minWidth: 0, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, padding: 14, gap: 10, shadowColor: "#382a24", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 2 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  titleGroup: { flexDirection: "row", alignItems: "center", gap: 9 },
  weatherIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#f0eee9", alignItems: "center", justifyContent: "center" },
  weatherIconText: { color: colors.accent, fontSize: 20 },
  heading: { color: colors.text, fontSize: 15, fontWeight: "800" },
  subheading: { color: colors.muted, fontSize: 11, marginTop: 2 },
  status: { overflow: "hidden", borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5, fontSize: 9, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  statusCurrent: { color: colors.accent, borderColor: "#b9d0c8" },
  statusStale: { color: colors.muted },
  primaryGrid: { flexDirection: "row", gap: 8 },
  primaryMetric: { flex: 1, minWidth: 0, borderRadius: 10, backgroundColor: "#f6f4ef", padding: 10 },
  metricLabel: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  temperature: { color: colors.text, fontSize: 32, fontWeight: "800", letterSpacing: -1.5, marginTop: 4 },
  condition: { color: colors.muted, fontSize: 12, marginTop: 3 },
  windRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 2, marginTop: 3 },
  windSpeed: { flexShrink: 1, color: colors.text, fontSize: 21, fontWeight: "800", letterSpacing: -0.7 },
  compassWrap: { alignItems: "center", minWidth: 68 },
  directionLabel: { color: colors.accent, fontSize: 8, fontWeight: "800", textAlign: "center" },
  directionUnavailable: { color: colors.muted, fontSize: 10, textAlign: "center", maxWidth: 72 },
  secondaryGrid: { flexDirection: "row", gap: 6 },
  secondaryMetric: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 8 },
  secondaryValue: { color: colors.text, fontSize: 12, fontWeight: "700", marginTop: 4, flexWrap: "wrap" },
  observation: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 8, gap: 2 },
  observationLabel: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  observationTime: { color: colors.text, fontSize: 11, fontVariant: ["tabular-nums"] },
  message: { color: colors.muted, fontSize: 12, lineHeight: 18, paddingVertical: 5 },
  attribution: { minHeight: 36, justifyContent: "center", alignSelf: "flex-start" },
  attributionText: { color: colors.accent, fontSize: 11, textDecorationLine: "underline" },
  historyDisclosure: { minWidth: 0, borderWidth: 1, borderColor: colors.border, borderRadius: 9, backgroundColor: colors.surface },
  historySummary: { minHeight: 46, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  historyTitle: { color: colors.text, fontSize: 12, fontWeight: "700" },
  historyPreview: { flex: 1, color: colors.muted, fontSize: 11, textAlign: "right" },
  historyToggle: { color: colors.accent, fontSize: 18, fontWeight: "700", width: 18, textAlign: "center" },
  historyBody: { paddingHorizontal: 11, paddingBottom: 6, borderTopWidth: 1, borderColor: colors.border },
  historyReading: { paddingVertical: 9, borderBottomWidth: 1, borderColor: colors.border, gap: 5 },
  historyReadingColumns: { flexDirection: "row", gap: 8 },
  historyReadingMetric: { flex: 1, minWidth: 0, gap: 2 },
  historyValue: { color: colors.text, fontSize: 12, fontWeight: "700" },
  historyLabel: { color: colors.muted, fontSize: 10 },
  historyMeta: { color: colors.muted, fontSize: 9, lineHeight: 14 },
});

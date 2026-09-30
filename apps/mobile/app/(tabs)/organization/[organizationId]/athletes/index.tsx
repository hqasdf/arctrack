import { buildCoachTeamAnalytics, DEFAULT_COACH_FILTERS } from "@arc-track/core/coach-analytics";
import { formatDateOnly } from "@arc-track/core/dates";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { CoachChoices, CoachNav, CoachState, coachPalette, coachStyles } from "@/src/coach-ui";
import { filterCoachDirectory } from "@/src/coach-mobile-model";
import { useCoachWorkspace } from "@/src/coach-workspace";
import { singaporeToday } from "@/src/mobile-analytics";
import { athleteLabel } from "@/src/organizations";

export default function CoachAthletesScreen() {
  const { organizationId } = useLocalSearchParams<{ organizationId: string }>();
  const { data, loading, error, reload } = useCoachWorkspace(organizationId);
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState("all");
  const [activity, setActivity] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const today = singaporeToday(new Date());
  const athletes = useMemo(() => data?.athletes.map((athlete) => ({ userId: athlete.userId, name: athleteLabel(athlete) })) ?? [], [data]);
  const result = useMemo(() => data ? buildCoachTeamAnalytics(athletes, data.sessions, DEFAULT_COACH_FILTERS, today) : null, [data, athletes, today]);
  if (loading || error || !data || !result) return <CoachState loading={loading} error={error} unavailable="Coach access is unavailable." retry={() => void reload()}/>;
  const divisions = [...new Set(result.perAthlete.flatMap((item) => item.latestSession?.rounds.map((round) => round.division) ?? []))].sort();
  const shown = filterCoachDirectory(result.perAthlete, search, division, activity as "all" | "recent" | "none");
  return <ScrollView style={coachStyles.page} contentContainerStyle={coachStyles.content} keyboardShouldPersistTaps="handled">
    <CoachNav organizationId={data.organization.id} current="athletes"/>
    <Text style={coachStyles.eyebrow}>HEAD COACH · DIRECTORY</Text><Text style={coachStyles.title}>Athletes</Text>
    <Text style={coachStyles.muted}>{athletes.length} active Archers</Text>
    <TextInput accessibilityLabel="Search athletes" placeholder="Search athletes" placeholderTextColor={coachPalette.muted} value={search} onChangeText={setSearch} style={{ backgroundColor: coachPalette.surface, color: coachPalette.text, borderColor: coachPalette.border, borderWidth: 1, borderRadius: 10, minHeight: 48, paddingHorizontal: 12 }}/>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: filtersOpen }} onPress={() => setFiltersOpen((open) => !open)} style={coachStyles.chip}><Text style={coachStyles.chipText}>Filters{[division !== "all", activity !== "all"].filter(Boolean).length ? ` · ${[division !== "all", activity !== "all"].filter(Boolean).length} active` : ""}</Text></Pressable>
    {filtersOpen ? <View style={{ gap: 9 }}><CoachChoices label="Division" value={division} choices={[["all","All"],...divisions.map((item): [string,string] => [item,item])]} change={setDivision}/><CoachChoices label="Activity" value={activity} choices={[["all","All"],["recent","Session in 30d"],["none","No Session in 30d"]]} change={setActivity}/></View> : null}
    {shown.length ? shown.map((item) => <Pressable key={item.userId} accessibilityRole="button" onPress={() => router.push({ pathname: "/organization/[organizationId]/athletes/[userId]", params: { organizationId: data.organization.id, userId: item.userId } })} style={coachStyles.card}>
      <Text style={coachStyles.cardTitle}>{item.name}</Text>
      <Text style={coachStyles.muted}>{item.latestSession?.rounds.at(-1)?.division ?? "No division yet"} · Last Session {item.latestSession ? formatDateOnly(item.latestSession.date) : "—"}</Text>
      <Text style={coachStyles.muted}>{item.arrowCount} Session Arrows · {item.sessionCount} Sessions · {item.average?.toFixed(2) ?? "—"} avg/Arrow</Text>
      <Text style={coachStyles.muted}>{item.tenPlusXRate?.toFixed(1) ?? "—"}% 10+X · {item.xRate?.toFixed(1) ?? "—"}% X</Text>
    </Pressable>) : <Text style={coachStyles.muted}>No active Archers match these filters.</Text>}
  </ScrollView>;
}

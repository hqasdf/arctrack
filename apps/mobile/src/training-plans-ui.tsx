import { formatDateOnly } from "@arc-track/core/dates";
import { trainingPlanDates, trainingPlanStatus, type TrainingPlanDayProgress,
  type TrainingPlanProgress, type TrainingPlanWeekProgress } from "@arc-track/core/training-plan";
import { prepareTrainingPlanInput, type TrainingPlanDayInput,
  type TrainingPlanEditorInput } from "@arc-track/core/training-plan-input";
import { router } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { coachPalette } from "./coach-palette";
import { colors } from "./theme";
import type { MobileTrainingPlan } from "./training-plans-read";
import { saveMobileTrainingPlan } from "./training-plans-write";

export function visibleTrainingWeek(progress: TrainingPlanProgress, today: string) {
  return progress.currentWeek ?? (today < progress.weeks[0]?.startDate ? progress.weeks[0] : progress.weeks.at(-1)) ?? null;
}

export function TrainingGoalRing({ week, coach = false, compact = false }: { week: TrainingPlanWeekProgress | null; coach?: boolean; compact?: boolean }) {
  const palette = coach ? coachPalette : colors;
  if (!week || week.arrowTarget === null) return <Text style={{ color: palette.muted }}>No weekly Arrow target. Daily requirements may still apply.</Text>;
  const circumference = 2 * Math.PI * 69;
  const size = compact ? 88 : 160;
  return <View style={ui.goalWrap}>
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}><Svg width={size} height={size} viewBox="0 0 160 160">
      {[76, 53].map((radius) => <Circle key={radius} cx={80} cy={80} r={radius} stroke={palette.accent} strokeOpacity={.22} strokeWidth={1} fill="none"/>)}
      <Circle cx={80} cy={80} r={69} stroke={palette.border} strokeWidth={11} fill="none"/>
      {(week.visualRatio ?? 0) > 0 && <Circle cx={80} cy={80} r={69} stroke={palette.accent} strokeWidth={11} fill="none" strokeLinecap="round"
        strokeDasharray={`${(week.visualRatio ?? 0) * circumference}, ${circumference}`} rotation={-90} origin="80,80"/>
      }
      <Circle cx={80} cy={80} r={3} fill={palette.accent}/>
    </Svg></View>
    <View style={{ flexShrink: 1, gap: 5 }}><Text style={{ color: palette.muted }}>{formatDateOnly(week.startDate)} – {formatDateOnly(week.endDate)}</Text>
      <Text style={[ui.goalNumber, { color: palette.text }]}>{week.arrowsCompleted} / {week.arrowTarget}</Text>
      <Text style={{ color: palette.text, fontWeight: "700" }}>{Math.round((week.progressRatio ?? 0) * 100)}% · arrows</Text>
      <Text style={{ color: palette.muted }}>{week.goalReached ? `Goal complete${week.amountAboveGoal ? ` · +${week.amountAboveGoal} above target` : ""}` : `${week.arrowsRemaining} remaining`}</Text>
      {week.unknownArrowCountSessions > 0 && <Text style={{ color: palette.muted }}>{week.unknownArrowCountSessions} Session(s) have no known Arrow count.</Text>}
    </View>
  </View>;
}

export function TrainingDailyProgress({ days, today, coach = false }: { days: TrainingPlanDayProgress[]; today: string; coach?: boolean }) {
  const palette = coach ? coachPalette : colors;
  return <View>{days.map((day) => {
    const status = day.date > today ? "Upcoming" : day.noTrackedRequirement ? "No tracked requirement" : day.dayComplete ? "Complete" : day.date < today ? "Incomplete" : "In Progress";
    return <View key={day.date} style={[ui.day, { borderColor: palette.border }]}>
      <Text style={{ color: palette.text, fontWeight: "700" }}>{formatDateOnly(day.date)} · {status}</Text>
      <Text style={{ color: palette.muted }}>{day.arrowTarget === null ? "No Arrow target" : `${day.arrowsCompleted} / ${day.arrowTarget} arrows`}</Text>
      <Text style={{ color: palette.muted }}>{day.scoredRoundTarget === null ? "No scored-Round target" : `${day.scoredRoundsCompleted} / ${day.scoredRoundTarget} scored Rounds`}</Text>
      {day.coachNote ? <Text style={{ color: palette.muted }}>Coach note: {day.coachNote}</Text> : null}
    </View>;
  })}</View>;
}

function initialInput(plan: MobileTrainingPlan | null, today: string, eligibleIds: Set<string>): TrainingPlanEditorInput {
  return { title: plan?.title ?? "", startDate: plan?.startDate ?? today, endDate: plan?.endDate ?? today,
    weeklyArrowTarget: plan?.weeklyArrowTarget?.toString() ?? "", note: plan?.note ?? "",
    athleteUserIds: plan?.assignedUserIds.filter((id) => eligibleIds.has(id)) ?? [],
    days: plan?.days.map((day) => ({ date: day.date, arrowTarget: day.arrowTarget?.toString() ?? "",
      scoredRoundTarget: day.scoredRoundTarget?.toString() ?? "", coachNote: day.coachNote ?? "" })) ?? [] };
}

export function MobileTrainingPlanForm({ organizationId, plan, today, athletes }: {
  organizationId: string; plan: MobileTrainingPlan | null; today: string;
  athletes: Array<{ userId: string; name: string }>;
}) {
  const eligibleIds = useMemo(() => new Set(athletes.map((athlete) => athlete.userId)), [athletes]);
  const [form, setForm] = useState(() => initialInput(plan, today, eligibleIds));
  const [search, setSearch] = useState("");
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dates = useMemo(() => { try { return trainingPlanDates(form.startDate, form.endDate); } catch { return []; } }, [form.startDate, form.endDate]);
  const selected = new Set(form.athleteUserIds);
  const set = <K extends keyof TrainingPlanEditorInput>(key: K, value: TrainingPlanEditorInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const toggle = (id: string) => set("athleteUserIds", selected.has(id) ? form.athleteUserIds.filter((item) => item !== id) : [...form.athleteUserIds, id]);
  const updateDay = (date: string, patch: Partial<TrainingPlanDayInput>) => setForm((current) => {
    const existing = current.days.find((day) => day.date === date) ?? { date, arrowTarget: "", scoredRoundTarget: "", coachNote: "" };
    return { ...current, days: [...current.days.filter((day) => day.date !== date), { ...existing, ...patch }] };
  });
  async function save() {
    if (savingRef.current) return;
    const prepared = prepareTrainingPlanInput(form);
    if (!prepared.ok) { setError(prepared.message); return; }
    const initial = plan ? initialInput(plan, today, eligibleIds) : null;
    const prescription = (value: TrainingPlanEditorInput) => JSON.stringify([value.title.trim(), value.startDate, value.endDate,
      value.weeklyArrowTarget.trim(), value.note.trim(), value.days]);
    if (plan && plan.assignedUserIds.length > 1 && initial && prescription(form) !== prescription(initial)) {
      Alert.alert("Shared Training Plan", `This plan is assigned to ${plan.assignedUserIds.length} athletes. Changes will apply to everyone assigned to this plan.`, [
        { text: "Cancel", style: "cancel" }, { text: "Save for everyone", onPress: () => void commit() },
      ]);
    } else await commit();
  }
  async function commit() {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(null);
    try {
      const id = await saveMobileTrainingPlan(organizationId, plan?.id ?? null, form);
      router.replace({ pathname: "/organization/[organizationId]/training-plans/[planId]", params: { organizationId, planId: id } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Training Plan could not be saved."); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: coachPalette.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.formContent}>
      <Text style={ui.eyebrow}>HEAD COACH · PLANNING</Text><Text style={ui.title}>{plan ? "Edit Training Plan" : "New Training Plan"}</Text>
      <Text style={ui.heading}>Plan</Text>
      <Field label="Plan Name" value={form.title} change={(value) => set("title", value)}/>
      <Field label="Start Date · YYYY-MM-DD" value={form.startDate} change={(value) => set("startDate", value)} keyboard="numbers-and-punctuation"/>
      <Field label="End Date · YYYY-MM-DD" value={form.endDate} change={(value) => set("endDate", value)} keyboard="numbers-and-punctuation"/>
      <Field label="Weekly Arrow Target · optional" value={form.weeklyArrowTarget} change={(value) => set("weeklyArrowTarget", value)} keyboard="number-pad"/>
      <Field label="Overall Coach Note · optional" value={form.note} change={(value) => set("note", value)} multiline/>
      <Text style={ui.heading}>Assign to · {selected.size} athletes selected</Text>
      <Field label="Search athletes" value={search} change={setSearch}/>
      <View style={ui.actions}><Action label="Select All" press={() => set("athleteUserIds", athletes.map((athlete) => athlete.userId))} secondary/><Action label="Clear All" press={() => set("athleteUserIds", [])} secondary/></View>
      {athletes.filter((athlete) => athlete.name.toLowerCase().includes(search.toLowerCase())).map((athlete) => <Pressable key={athlete.userId} accessibilityRole="checkbox" accessibilityState={{ checked: selected.has(athlete.userId) }} onPress={() => toggle(athlete.userId)} style={ui.pickRow}><Text style={ui.body}>{selected.has(athlete.userId) ? "☑" : "□"}  {athlete.name}</Text></Pressable>)}
      {!athletes.length && <Text style={ui.muted}>No active Archers are available to assign.</Text>}
      <Text style={ui.heading}>Daily requirements</Text><Text style={ui.muted}>Leave a target blank when that day has no target.</Text>
      {!dates.length && <Text style={ui.error}>Choose a valid date range to edit days.</Text>}
      {dates.map((date) => { const day = form.days.find((item) => item.date === date); return <View key={date} style={ui.dayEditor}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: openDay === date }} onPress={() => setOpenDay(openDay === date ? null : date)} style={ui.dayTrigger}><Text style={ui.body}>{formatDateOnly(date)}  {openDay === date ? "⌃" : "⌄"}</Text></Pressable>
        {openDay === date && <View style={{ gap: 10, paddingBottom: 10 }}><Field label="Arrow Target · optional" value={day?.arrowTarget ?? ""} change={(value) => updateDay(date, { arrowTarget: value })} keyboard="number-pad"/>
          <Field label="Scored Rounds · optional" value={day?.scoredRoundTarget ?? ""} change={(value) => updateDay(date, { scoredRoundTarget: value })} keyboard="number-pad"/>
          <Field label="Coach Note · optional" value={day?.coachNote ?? ""} change={(value) => updateDay(date, { coachNote: value })} multiline/></View>}
      </View>; })}
      {error && <Text accessibilityRole="alert" style={ui.error}>{error}</Text>}
      <Action label={saving ? "Saving…" : plan ? "Save changes" : "Create Training Plan"} press={() => void save()} disabled={saving}/>
    </ScrollView>
  </KeyboardAvoidingView>;
}

function Field({ label, value, change, keyboard, multiline = false }: { label: string; value: string; change: (value: string) => void; keyboard?: "number-pad" | "numbers-and-punctuation"; multiline?: boolean }) {
  return <View style={{ gap: 5 }}><Text style={ui.muted}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={change} keyboardType={keyboard} multiline={multiline} maxLength={multiline ? 2000 : undefined} placeholderTextColor={coachPalette.muted} style={[ui.input, multiline && { minHeight: 82, textAlignVertical: "top" }]}/></View>;
}

export function Action({ label, press, secondary = false, disabled = false }: { label: string; press: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={press} style={[ui.action, secondary && ui.actionSecondary, disabled && { opacity: .5 }]}><Text style={[ui.actionText, secondary && { color: coachPalette.accent }]}>{label}</Text></Pressable>;
}

export const ui = StyleSheet.create({
  formContent: { padding: 20, paddingBottom: 64, gap: 14 }, eyebrow: { color: coachPalette.accent, fontSize: 11, fontWeight: "800", letterSpacing: 1.6 },
  title: { color: coachPalette.text, fontSize: 33, fontWeight: "700", letterSpacing: -1 }, heading: { color: coachPalette.text, fontSize: 21, fontWeight: "700", marginTop: 15 },
  body: { color: coachPalette.text, fontSize: 15, fontWeight: "600" }, muted: { color: coachPalette.muted, fontSize: 13, lineHeight: 19 },
  input: { backgroundColor: coachPalette.surface, borderColor: coachPalette.border, borderWidth: 1, borderRadius: 9, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, color: coachPalette.text, fontSize: 15 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 9 }, action: { backgroundColor: coachPalette.accent, borderRadius: 9, minHeight: 48, paddingHorizontal: 17, paddingVertical: 12, justifyContent: "center", alignItems: "center" },
  actionSecondary: { borderColor: coachPalette.border, borderWidth: 1, backgroundColor: "transparent" }, actionText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  pickRow: { minHeight: 48, justifyContent: "center", borderBottomColor: coachPalette.border, borderBottomWidth: 1, paddingVertical: 8 },
  dayEditor: { borderTopColor: coachPalette.border, borderTopWidth: 1 }, dayTrigger: { minHeight: 48, justifyContent: "center" },
  day: { borderTopWidth: 1, paddingVertical: 14, gap: 5 }, error: { color: colors.error, fontSize: 14, fontWeight: "700" },
  goalWrap: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 18, paddingVertical: 12 }, goalNumber: { fontSize: 28, fontWeight: "700", fontVariant: ["tabular-nums"], letterSpacing: -1 },
});

export { trainingPlanStatus };

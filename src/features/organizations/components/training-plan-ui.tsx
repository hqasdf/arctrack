"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { formatDateOnly } from "@arc-track/core/dates";
import { trainingPlanDates, trainingPlanStatus, type TrainingPlanDayProgress,
  type TrainingPlanProgress, type TrainingPlanWeekProgress } from "@arc-track/core/training-plan";
import { prepareTrainingPlanInput, type TrainingPlanDayInput,
  type TrainingPlanEditorInput } from "@arc-track/core/training-plan-input";
import { deleteTrainingPlan, saveTrainingPlan } from "../training-plans-actions";
import type { TrainingPlanRecord } from "../training-plans-read.server";
import styles from "./training-plans.module.css";

type Athlete = { userId: string; name: string };
type AthleteProgress = Athlete & { progress: TrainingPlanProgress };

export function GoalRing({ week }: { week: TrainingPlanWeekProgress | null }) {
  if (!week || week.arrowTarget === null) return <p className={styles.muted}>No weekly Arrow target. Daily requirements may still apply.</p>;
  const ratio = week.visualRatio ?? 0;
  const circumference = 2 * Math.PI * 70;
  return <div className={styles.goalWrap}>
    <svg className={styles.ring} viewBox="0 0 180 180" aria-hidden="true">
      {[78, 56].map((radius) => <circle key={radius} cx="90" cy="90" r={radius} fill="none" stroke="currentColor" opacity=".12" strokeWidth="1"/>)}
      <circle cx="90" cy="90" r="70" fill="none" stroke="currentColor" opacity=".15" strokeWidth="12"/>
      {ratio > 0 && <circle cx="90" cy="90" r="70" fill="none" stroke="var(--color-primary)" strokeWidth="12"
        strokeLinecap="round" strokeDasharray={`${ratio * circumference} ${circumference}`}
        transform="rotate(-90 90 90)"/>}
      <circle cx="90" cy="90" r="3" fill="var(--color-primary)"/>
    </svg>
    <div className={styles.ringText}><span>{formatDateOnly(week.startDate)} – {formatDateOnly(week.endDate)}</span>
      <strong>{week.arrowsCompleted} / {week.arrowTarget} arrows</strong>
      <span>{Math.round((week.progressRatio ?? 0) * 100)}%</span>
      <span>{week.goalReached ? `Goal complete${week.amountAboveGoal ? ` · +${week.amountAboveGoal} above target` : ""}` : `${week.arrowsRemaining} remaining`}</span>
      {week.unknownArrowCountSessions > 0 && <span>{week.unknownArrowCountSessions} Session(s) have no known Arrow count.</span>}
    </div>
  </div>;
}

export function displayedWeek(progress: TrainingPlanProgress, today: string) {
  return progress.currentWeek ?? (today < progress.weeks[0]?.startDate ? progress.weeks[0] : progress.weeks.at(-1)) ?? null;
}

export function DayProgress({ day, today }: { day: TrainingPlanDayProgress; today: string }) {
  const status = day.date > today ? "Upcoming" : day.noTrackedRequirement ? "No tracked requirement" : day.dayComplete ? "Complete" : day.date < today ? "Incomplete" : "In Progress";
  return <div className={styles.dayRow}><strong>{formatDateOnly(day.date)} · {status}</strong>
    <span>{day.arrowTarget === null ? "No Arrow target" : `${day.arrowsCompleted} / ${day.arrowTarget} arrows`}</span>
    <span>{day.scoredRoundTarget === null ? "No scored-Round target" : `${day.scoredRoundsCompleted} / ${day.scoredRoundTarget} scored Rounds`}</span>
    {day.coachNote && <p className={styles.note}>Coach note: {day.coachNote}</p>}
  </div>;
}

export function CoachPlanList({ organizationId, plans, today }: { organizationId: string; plans: TrainingPlanRecord[]; today: string }) {
  const base = `/organization/${organizationId}/training-plans`;
  return <div className={styles.page}><header className={styles.hero}><div><p className={styles.eyebrow}>Head Coach · Planning</p><h1>Training Plans</h1></div><Link className={styles.button} href={`${base}/new`}>+ New Plan</Link></header>
    {plans.length ? <ul className={styles.planList}>{plans.map((plan) => <li key={plan.id}><Link className={styles.planLink} href={`${base}/${plan.id}`}>
      <strong>{plan.title}</strong><em>View Plan →</em><span>{formatDateOnly(plan.startDate)} – {formatDateOnly(plan.endDate)} · {plan.weeklyArrowTarget === null ? "No weekly Arrow target" : `${plan.weeklyArrowTarget} arrows / week`} · {plan.assignedUserIds.length} athletes</span><span>{trainingPlanStatus(plan.startDate, plan.endDate, today)}</span>
    </Link></li>)}</ul> : <div className={styles.empty}><h2>No Training Plans yet</h2><p>Create a plan to set weekly Arrow goals and daily training requirements for your athletes.</p><Link className={styles.button} href={`${base}/new`}>Create Training Plan</Link></div>}
  </div>;
}

function initialInput(plan: TrainingPlanRecord | null, today: string, eligibleIds: Set<string>): TrainingPlanEditorInput {
  return { title: plan?.title ?? "", startDate: plan?.startDate ?? today, endDate: plan?.endDate ?? today,
    weeklyArrowTarget: plan?.weeklyArrowTarget?.toString() ?? "", note: plan?.note ?? "",
    athleteUserIds: plan?.assignedUserIds.filter((id) => eligibleIds.has(id)) ?? [],
    days: plan?.days.map((day) => ({ date: day.date, arrowTarget: day.arrowTarget?.toString() ?? "",
      scoredRoundTarget: day.scoredRoundTarget?.toString() ?? "", coachNote: day.coachNote ?? "" })) ?? [] };
}

export function CoachPlanForm({ organizationId, athletes, plan, today }: {
  organizationId: string; athletes: Athlete[]; plan: TrainingPlanRecord | null; today: string;
}) {
  const router = useRouter();
  const eligibleIds = useMemo(() => new Set(athletes.map((athlete) => athlete.userId)), [athletes]);
  const [form, setForm] = useState(() => initialInput(plan, today, eligibleIds));
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dates = useMemo(() => { try { return trainingPlanDates(form.startDate, form.endDate); } catch { return []; } }, [form.startDate, form.endDate]);
  const selected = new Set(form.athleteUserIds);
  const initial = plan ? initialInput(plan, today, eligibleIds) : null;
  const prescription = (value: TrainingPlanEditorInput) => JSON.stringify([value.title.trim(), value.startDate, value.endDate,
    value.weeklyArrowTarget.trim(), value.note.trim(), value.days]);
  const updateDay = (date: string, patch: Partial<TrainingPlanDayInput>) => setForm((current) => {
    const existing = current.days.find((day) => day.date === date) ?? { date, arrowTarget: "", scoredRoundTarget: "", coachNote: "" };
    return { ...current, days: [...current.days.filter((day) => day.date !== date), { ...existing, ...patch }] };
  });
  const toggleAthlete = (id: string) => setForm((current) => ({ ...current,
    athleteUserIds: current.athleteUserIds.includes(id) ? current.athleteUserIds.filter((item) => item !== id) : [...current.athleteUserIds, id] }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pendingRef.current) return;
    const prepared = prepareTrainingPlanInput(form);
    if (!prepared.ok) { setError(prepared.message); return; }
    if (plan && plan.assignedUserIds.length > 1 && initial && prescription(form) !== prescription(initial)
      && !window.confirm(`This plan is assigned to ${plan.assignedUserIds.length} athletes. Changes will apply to everyone assigned to this plan.`)) return;
    pendingRef.current = true; setPending(true); setError(null);
    try {
      const result = await saveTrainingPlan(organizationId, plan?.id ?? null, form);
      if (!result.ok) { setError(result.message); return; }
      router.push(`/organization/${organizationId}/training-plans/${result.data}`);
      router.refresh();
    } catch { setError("Training Plan could not be saved. Try again."); }
    finally { pendingRef.current = false; setPending(false); }
  };
  return <div className={styles.page}><header className={styles.hero}><div><Link className={styles.secondary} href={plan ? `/organization/${organizationId}/training-plans/${plan.id}` : `/organization/${organizationId}/training-plans`}>← Training Plans</Link><p className={styles.eyebrow}>Head Coach · Planning</p><h1>{plan ? "Edit Training Plan" : "New Training Plan"}</h1></div></header>
    <form className={styles.form} onSubmit={submit}><section className={styles.section}><h2>Plan</h2><div className={styles.fields}>
      <label className={`${styles.field} ${styles.full}`}>Plan Name<input required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })}/></label>
      <label className={styles.field}>Start Date<input type="date" required value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })}/></label>
      <label className={styles.field}>End Date<input type="date" required value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })}/></label>
      <label className={styles.field}>Weekly Arrow Target · optional<input inputMode="numeric" value={form.weeklyArrowTarget} onChange={(event) => setForm({ ...form, weeklyArrowTarget: event.target.value })}/></label>
      <label className={`${styles.field} ${styles.full}`}>Overall Coach Note · optional<textarea maxLength={2000} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })}/></label>
    </div></section>
    <section className={styles.section}><h2>Assign to</h2><p className={styles.muted}>{selected.size} athletes selected</p>
      <input className={styles.search} aria-label="Search athletes" placeholder="Search athletes" value={search} onChange={(event) => setSearch(event.target.value)}/>
      <div className={styles.pickerActions}><button className={styles.secondary} type="button" onClick={() => setForm({ ...form, athleteUserIds: athletes.map((athlete) => athlete.userId) })}>Select All</button><button className={styles.secondary} type="button" onClick={() => setForm({ ...form, athleteUserIds: [] })}>Clear All</button></div>
      <div className={styles.picker}>{athletes.filter((athlete) => athlete.name.toLowerCase().includes(search.toLowerCase())).map((athlete) => <label key={athlete.userId} className={styles.pickRow}><input type="checkbox" checked={selected.has(athlete.userId)} onChange={() => toggleAthlete(athlete.userId)}/><span>{athlete.name}</span></label>)}</div>
      {!athletes.length && <p className={styles.muted}>No active Archers are available to assign.</p>}
    </section>
    <section className={styles.section}><h2>Daily requirements</h2><p className={styles.muted}>Leave a target blank when that day has no target.</p>
      {!dates.length && <p className={styles.error}>Choose a valid date range to edit days.</p>}
      {dates.map((date) => { const day = form.days.find((item) => item.date === date); return <details key={date} className={styles.dayEditor}><summary>{formatDateOnly(date)}</summary><div className={styles.dayFields}>
        <label className={styles.field}>Arrow Target<input inputMode="numeric" value={day?.arrowTarget ?? ""} onChange={(event) => updateDay(date, { arrowTarget: event.target.value })}/></label>
        <label className={styles.field}>Scored Rounds<input inputMode="numeric" value={day?.scoredRoundTarget ?? ""} onChange={(event) => updateDay(date, { scoredRoundTarget: event.target.value })}/></label>
        <label className={`${styles.field} ${styles.full}`}>Coach Note<textarea maxLength={2000} value={day?.coachNote ?? ""} onChange={(event) => updateDay(date, { coachNote: event.target.value })}/></label>
      </div></details>; })}
    </section>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}><button className={styles.button} disabled={pending} type="submit">{pending ? "Saving…" : plan ? "Save changes" : "Create Training Plan"}</button></div>
    </form></div>;
}

export function CoachPlanDetail({ plan, athletes, today }: {
  plan: TrainingPlanRecord; athletes: AthleteProgress[]; today: string;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(athletes[0]?.userId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = athletes.find((athlete) => athlete.userId === selectedId) ?? athletes[0];
  const base = `/organization/${plan.organizationId}/training-plans`;
  async function remove() {
    if (!window.confirm("Delete this Training Plan and its assignments? Athlete Sessions, Rounds, Arrows and scores will be unaffected.")) return;
    setPending(true); setError(null);
    try {
      const result = await deleteTrainingPlan(plan.organizationId, plan.id);
      if (!result.ok) { setError(result.message); return; }
      router.push(base); router.refresh();
    } catch { setError("Training Plan could not be deleted. Try again."); }
    finally { setPending(false); }
  }
  return <div className={styles.page}><header className={styles.hero}><div><Link className={styles.secondary} href={base}>← Training Plans</Link><p className={styles.eyebrow}>Head Coach · Training Plan</p><h1>{plan.title}</h1><div className={styles.heroMeta}><span>{formatDateOnly(plan.startDate)} – {formatDateOnly(plan.endDate)}</span><strong>{trainingPlanStatus(plan.startDate, plan.endDate, today)}</strong><span>{plan.assignedUserIds.length} assigned athletes</span></div></div><div className={styles.actions}><Link className={styles.secondary} href={`${base}/${plan.id}/edit`}>Edit Plan</Link><button className={styles.secondary} disabled={pending} onClick={() => void remove()}>Delete Plan</button></div></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.heroMeta}><strong>{plan.weeklyArrowTarget === null ? "No weekly Arrow target" : `${plan.weeklyArrowTarget} arrows / week`}</strong></div>
    {plan.note && <p className={styles.note}>{plan.note}</p>}
    <section className={styles.section}><h2>Weekly progress</h2>{selected ? <GoalRing week={displayedWeek(selected.progress, today)}/> : <p className={styles.muted}>No active assigned athletes are available.</p>}</section>
    <section className={styles.section}><h2>Athlete progress</h2>{athletes.length ? <ul className={styles.athleteRows}>{athletes.map((athlete) => { const week = displayedWeek(athlete.progress, today); return <li key={athlete.userId}><button className={styles.athleteRow} aria-pressed={selected?.userId === athlete.userId} onClick={() => setSelectedId(athlete.userId)}><strong>{athlete.name}</strong><span>{week?.arrowTarget === null || !week ? "No weekly Arrow target" : `${week.arrowsCompleted} / ${week.arrowTarget} arrows · ${Math.round((week.progressRatio ?? 0) * 100)}% · ${week.goalReached ? week.amountAboveGoal ? `+${week.amountAboveGoal} above target` : "Goal complete" : `${week.arrowsRemaining} remaining`}`}</span><span className={styles.progressTrack}><span style={{ width: `${(week?.visualRatio ?? 0) * 100}%` }}/></span></button></li>; })}</ul> : <p className={styles.muted}>No active assigned athletes.</p>}</section>
    <section className={styles.section}><h2>Daily prescription{selected ? ` · ${selected.name}` : ""}</h2><div className={styles.dayList}>{selected ? selected.progress.days.map((day) => <DayProgress key={day.date} day={day} today={today}/>) : plan.days.map((day) => <div key={day.date} className={styles.dayRow}><strong>{formatDateOnly(day.date)}</strong><span>{day.arrowTarget ?? "No"} Arrow target · {day.scoredRoundTarget ?? "No"} scored-Round target</span>{day.coachNote && <p className={styles.note}>{day.coachNote}</p>}</div>)}</div></section>
  </div>;
}

export function AthletePlanCard({ plans, today }: { plans: Array<{ plan: TrainingPlanRecord; progress: TrainingPlanProgress }>; today: string }) {
  const active = plans.filter(({ plan }) => trainingPlanStatus(plan.startDate, plan.endDate, today) === "Active");
  if (!active.length) return null;
  if (active.length > 1) return <section className={styles.section}><h2>{active.length} Active Training Plans</h2><ul className={styles.planList}>{active.map(({ plan, progress }) => <li key={plan.id} className={styles.compactPlan}><Link className={styles.planLink} href={`/sessions/training-plans/${plan.id}`}><strong>{plan.title}</strong><em>View Plan →</em></Link><div className={styles.compactGoal}><GoalRing week={displayedWeek(progress, today)}/></div></li>)}</ul></section>;
  const { plan, progress } = active[0];
  const week = displayedWeek(progress, today);
  const day = progress.days.find((item) => item.date === today);
  return <section className={styles.section}><p className={styles.eyebrow}>Your Training Plan</p><h2>{plan.title}</h2><p className={styles.muted}>{formatDateOnly(plan.startDate)} – {formatDateOnly(plan.endDate)}</p>
    <GoalRing week={week}/>{day && <div className={styles.dayRow}><strong>Today</strong><span>{day.arrowTarget === null ? "No Arrow target" : `${day.arrowsCompleted} / ${day.arrowTarget} arrows`}</span><span>{day.scoredRoundTarget === null ? "No scored-Round target" : `${day.scoredRoundsCompleted} / ${day.scoredRoundTarget} scored Rounds`}</span>{day.coachNote && <p className={styles.note}>Coach note: {day.coachNote}</p>}</div>}
    <Link className={styles.secondary} href={`/sessions/training-plans/${plan.id}`}>View Training Plan →</Link></section>;
}

export function AthletePlanDetail({ plan, progress, today }: { plan: TrainingPlanRecord; progress: TrainingPlanProgress; today: string }) {
  return <div className={styles.page}><header className={styles.hero}><div><Link className={styles.secondary} href="/sessions">← Sessions</Link><h1>{plan.title}</h1><p className={styles.muted}>{formatDateOnly(plan.startDate)} – {formatDateOnly(plan.endDate)}</p></div></header>
    {plan.note && <p className={styles.note}>Coach note: {plan.note}</p>}
    <section className={styles.section}><h2>Weekly Arrow goal</h2><GoalRing week={displayedWeek(progress, today)}/>{progress.weeks.length > 1 && <div className={styles.dayList}>{progress.weeks.map((week) => <div key={week.startDate} className={styles.dayRow}><strong>{formatDateOnly(week.startDate)} – {formatDateOnly(week.endDate)}</strong><span>{week.arrowTarget === null ? "No weekly Arrow target" : `${week.arrowsCompleted} / ${week.arrowTarget} arrows`}</span></div>)}</div>}</section>
    <section className={styles.section}><h2>Daily prescription</h2><div className={styles.dayList}>{progress.days.map((day) => <DayProgress key={day.date} day={day} today={today}/>)}</div></section>
  </div>;
}

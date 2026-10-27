import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as shared from '@arc-track/core/recent-round-configs';
import { recentRuntime } from './helpers/recent-round-runtime.mjs';
import { loadSessionModule } from './helpers/session-layout-runtime.mjs';
import * as scoring from '@arc-track/core/scoring';
import * as presets from '@arc-track/core/presets';
import { newestRoundsFirst } from '@arc-track/core/round-order';
const actor = randomUUID(), id = randomUUID(), config = { name: 'Custom round', division: 'Barebow', distanceMetres: 25, faceDiameterCm: 80, faceType: 'full_face', ends: 9, arrowsPerEnd: 4 };
function runtime(overrides = {}) {
  let rows = [{ id, configuration: config }]; const selected = [], calls = [];
  const actions = { readRecentRounds: async user => { calls.push(['read', user]); return rows; }, forgetRecentRound: async (...args) => { calls.push(['remove', ...args]); rows = []; }, ...overrides };
  const ui = recentRuntime('src/features/sessions/components/recent-round-configs.tsx', { '../recent-round-actions': actions, '@arc-track/core/recent-round-configs': shared });
  ui.setProps({ userId: actor, onSelect: value => selected.push(value) }); ui.render();
  return { ui, calls, selected, setRows: value => { rows = value; } };
}
test('web recent selection fills the complete normal configuration and permits independent edits', async () => {
  const { ui, selected, calls } = runtime(); await ui.settle();
  assert.match(ui.text(), /Recent Custom Configurations/); assert.match(ui.text(), /9 × 4/);
  ui.nodes().find(n => n.type === 'button' && !n.props['aria-label'] && n.props.children?.[0]?.type === 'span').props.onClick();
  assert.deepEqual(selected[0], config); selected[0].ends = 6; assert.equal(config.ends, 9);
  assert.equal(calls.filter(c => c[0] !== 'read').length, 0, 'recall does not persist drafts or create Rounds'); ui.dispose();
});
test('web removal is server-confirmed and late reads cannot resurrect removed history', async () => {
  let resolveRead; const { ui, setRows } = runtime(); await ui.settle();
  setRows(new Promise(resolve => { resolveRead = resolve; })); ui.listeners.get('window:focus')();
  await ui.nodes().find(n => n.props?.['aria-label']?.startsWith('Remove recent')).props.onClick(); await ui.settle();
  resolveRead([{ id, configuration: config }]); await ui.settle(); assert.doesNotMatch(ui.text(), /9 × 4/); ui.dispose();
});
test('web refresh sees peer changes and preserves keyboard-safe non-submit actions', async () => {
  const { ui, setRows } = runtime(); await ui.settle(); setRows([]); ui.listeners.get('window:focus')(); await ui.settle();
  assert.match(ui.text(), /successfully confirm/); assert.ok(ui.nodes().filter(n => n.type === 'button').every(n => n.props.type === 'button'));
  ui.dispose(); assert.equal(ui.listeners.size, 0);
});
test('unavailable history never prevents normal configuration and removal failure keeps the entry', async () => {
  const first = runtime({ readRecentRounds: async () => { throw Error('offline'); } }); await first.ui.settle(); assert.match(first.ui.text(), /configure a Round normally/i); first.ui.dispose();
  const second = runtime({ forgetRecentRound: async () => { throw Error('offline'); } }); await second.ui.settle();
  await second.ui.nodes().find(n => n.props?.['aria-label']?.startsWith('Remove recent')).props.onClick(); await second.ui.settle(); assert.match(second.ui.text(), /9 × 4/); assert.match(second.ui.text(), /Removal could not be confirmed/); second.ui.dispose();
});
test('server history actions reject account switches before invoking Supabase', async () => {
  const compiled = loadSessionModule('src/features/sessions/recent-round-actions.ts', { '@/lib/auth/session.server': { requireUser: async () => ({ id: actor }) }, '@/lib/supabase/server': { createAuthClient: () => { throw Error('must not run'); } } });
  await assert.rejects(() => compiled.readRecentRounds(randomUUID()), /account changed/);
});
test('web has no Refresh button, automatically recovers a transient read failure and stops after success', async () => {
  let attempts = 0;
  const { ui } = runtime({ readRecentRounds: async () => { if (++attempts === 1) throw Error('temporary'); return [{ id, configuration: config }]; } });
  await ui.settle();
  assert.equal(ui.nodes().some(n => n.type === 'button' && n.props.children === 'Refresh'), false);
  assert.match(ui.text(), /temporarily unavailable/); assert.equal(attempts, 1);
  await ui.advance(999); assert.equal(attempts, 1);
  await ui.advance(1); assert.equal(attempts, 2); assert.match(ui.text(), /9 × 4/);
  assert.equal(ui.timers.size, 0); await ui.advance(60000); assert.equal(attempts, 2); ui.dispose();
});
test('web retries are bounded and online recovery restarts loading without manual action', async () => {
  let offline = true, attempts = 0;
  const { ui } = runtime({ readRecentRounds: async () => { attempts++; if (offline) throw Error('offline'); return []; } });
  await ui.settle(); for (const delay of [1000, 4000, 15000]) await ui.advance(delay);
  assert.equal(attempts, 4); assert.equal(ui.timers.size, 0);
  await ui.advance(120000); assert.equal(attempts, 4);
  offline = false; ui.listeners.get('window:online')(); await ui.settle();
  assert.equal(attempts, 5); assert.match(ui.text(), /successfully confirm/); ui.dispose();
});
test('web hidden pages suspend retry requests and unmount cancels pending retries', async () => {
  let attempts = 0;
  const { ui } = runtime({ readRecentRounds: async () => { attempts++; throw Error('offline'); } });
  await ui.settle(); ui.document.visibilityState = 'hidden'; await ui.advance(1000); assert.equal(attempts, 1);
  ui.document.visibilityState = 'visible'; ui.listeners.get('document:visibilitychange')(); ui.listeners.get('window:focus')(); await ui.settle();
  assert.equal(attempts, 2, 'simultaneous return events share the active request');
  ui.dispose(); assert.equal(ui.timers.size, 0); await ui.advance(60000); assert.equal(attempts, 2); assert.equal(ui.listeners.size, 0);
});
test('web uncertain removal automatically reconciles the list without repeating deletion', async () => {
  let removalAttempts = 0;
  const { ui, setRows } = runtime({ forgetRecentRound: async () => { removalAttempts++; throw Error('response lost'); } });
  await ui.settle(); await ui.nodes().find(n => n.props?.['aria-label']?.startsWith('Remove recent')).props.onClick(); await ui.settle();
  assert.match(ui.text(), /Removal could not be confirmed/);
  setRows([]); await ui.advance(1000); assert.doesNotMatch(ui.text(), /9 × 4|Removal could not be confirmed/);
  assert.equal(removalAttempts, 1, 'automatic recovery performs reads only');
  ui.dispose();
});
test('actual web Configure Round recalls 9 × 4 into normal fields and submits through existing Round action', async () => {
  const calls = [], sessionId = randomUUID(), roundId = randomUUID();
  const round = { ...config, id: roundId, roundNumber: 1, arrows: [] };
  const ui = recentRuntime('src/features/sessions/components/sessions-workspace.tsx', {
    'next/navigation': { useRouter: () => ({ refresh() {} }) }, '@arc-track/core/round-order': { newestRoundsFirst }, '../scoring-model': scoring, '../round-presets': presets,
    '../actions': { deleteRound: async () => ({ ok: true, data: null }), createRoundWithEnds: async value => { calls.push(value); return { ok: true, data: { ...value, id: randomUUID(), roundNumber: 2, arrows: [] } }; } },
    './recent-round-configs': { RecentRoundConfigs: 'Recent' }, './round-presets-panel': { RoundPresetsPanel: 'Presets' }, './session-category-tabs': { SessionCategoryTabs: 'Tabs' }, './scoring-workspace': { ScoringWorkspace: 'Scoring' },
    '@/features/notes-feedback/session-notes-panel': { SessionNotesPanel: 'Notes' }, '@/features/notes-feedback/coach-feedback-panel': { CoachFeedbackPanel: 'Feedback' }, '@/features/notes-feedback/draft-guard': { confirmDraftNavigation: () => true },
    '@/features/live-coaching/presence': { LivePresence: 'Presence' }, '@/features/session-health/garmin-session-health': { GarminSessionHealth: 'Health' }, '@/features/weather/components/session-weather': { SessionWeatherHistory: 'Weather' },
  });
  ui.setComponent(ui.exports.SessionsWorkspace); ui.setProps({ viewerId: actor, initialSessionId: sessionId, initialSessions: [{ id: sessionId, title: 'Owned Session', date: '2026-10-27', sessionType: 'training', arrowCount: 0, rounds: [round] }] }); ui.render();
  ui.nodes().find(n => n.type === 'button' && n.props.children === 'Open').props.onClick(); ui.render();
  ui.nodes().find(n => n.type === 'Scoring').props.onConfigure(); ui.render();
  ui.nodes().find(n => n.type === 'Recent').props.onSelect({ ...config }); ui.render();
  assert.equal(ui.nodes().find(n => n.props?.label === 'Number of Ends').props.value, 9);
  assert.equal(ui.nodes().find(n => n.props?.label === 'Arrows per End').props.value, 4);
  await ui.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  assert.deepEqual(calls[0], { sessionId, ...config }); assert.equal(ui.nodes().find(n => n.type === 'Scoring').props.round.ends, 9); ui.dispose();
});

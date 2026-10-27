import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as shared from '@arc-track/core/recent-round-configs';
import * as roundModel from '../src/round-config.ts';
import { recentRuntime } from '../../../tests/helpers/recent-round-runtime.mjs';
const actor = randomUUID(), id = randomUUID(), config = { name: 'Custom round', division: 'Barebow', distanceMetres: 25, faceDiameterCm: 80, faceType: 'full_face', ends: 9, arrowsPerEnd: 4 };
const native = { View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', TextInput: 'TextInput', ActivityIndicator: 'Spinner', StyleSheet: { create: value => value } };
const appearance = { createThemedStyles: fn => () => fn({}), useAppearance: () => ({ colors: {} }) };
function runtime({ read, forget, compatible } = {}) {
  const selected = [], calls = [];
  let rows = [{ id, round_name: config.name, division: config.division, distance_metres: 25, face_diameter_cm: 80, face_type: 'full_face', planned_ends: 9, arrows_per_end: 4, last_used_at: '2026-10-27T00:00:00Z' }];
  const ui = recentRuntime('apps/mobile/src/recent-round-configs.tsx', (hooks, listeners) => ({
    'react-native': { ...native, AppState: { addEventListener: (key, fn) => { listeners.set(key, fn); return { remove: () => listeners.delete(key) }; } } },
    'expo-router': { useFocusEffect: fn => hooks.useEffect(fn, [fn]) }, './appearance': appearance,
    './supabase': { supabase: { rpc: async (name, args) => { calls.push({ name, args }); if (name === 'read_recent_round_configs') return { data: read ? await read() : rows, error: null }; if (forget) await forget(); rows = []; return { data: true, error: null }; } } },
    '@arc-track/core/recent-round-configs': shared,
  }));
  ui.setProps({ userId: actor, compatible, onSelect: value => selected.push(value) }); ui.render();
  return { ui, calls, selected, setRows: value => { rows = value; } };
}
test('native recent selection restores all seven fields without manual saving or draft persistence', async () => {
  const { ui, selected, calls } = runtime(); await ui.settle();
  const choice = ui.nodes().find(n => n.props?.accessibilityLabel?.startsWith('Use 9 × 4'));
  assert.equal(Boolean(choice.props.disabled), false); choice.props.onPress(); assert.deepEqual(selected[0], config);
  selected[0].ends = 6; assert.equal(config.ends, 9); assert.ok(calls.every(c => c.name === 'read_recent_round_configs'));
  ui.dispose();
});
test('native history removes only after backend confirmation and foreground refresh sees other-device changes', async () => {
  const { ui, setRows, calls } = runtime(); await ui.settle();
  await ui.nodes().find(n => n.props?.accessibilityLabel?.startsWith('Remove recent')).props.onPress(); await ui.settle(); assert.doesNotMatch(ui.text(), /9 × 4/);
  assert.deepEqual(calls.at(-1).args, { p_actor: actor, p_id: id });
  setRows([{ id, round_name: 'Updated on web', division: 'Compound', distance_metres: 50, face_diameter_cm: 80, face_type: 'six_ring', planned_ends: 6, arrows_per_end: 12, last_used_at: '2026-10-27' }]);
  ui.listeners.get('change')('background'); ui.listeners.get('change')('active'); await ui.settle(); assert.match(ui.text(), /6 × 12/);
  ui.dispose(); assert.equal(ui.listeners.size, 0);
});
test('native offline history remains optional and failed removal keeps remembered configuration visible', async () => {
  const first = runtime({ read: async () => { throw Error('offline'); } }); await first.ui.settle(); assert.match(first.ui.text(), /configure a Round normally/); first.ui.dispose();
  const second = runtime({ forget: async () => { throw Error('offline'); } }); await second.ui.settle();
  await second.ui.nodes().find(n => n.props?.accessibilityLabel?.startsWith('Remove recent')).props.onPress(); await second.ui.settle(); assert.match(second.ui.text(), /9 × 4/); assert.match(second.ui.text(), /could not be confirmed/); second.ui.dispose();
});
test('restricted settings modal cannot partially restore an incompatible configuration', async () => {
  const { ui } = runtime({ compatible: c => c.arrowsPerEnd === 6 }); await ui.settle();
  assert.equal(ui.nodes().find(n => n.props?.accessibilityLabel?.startsWith('Use 9 × 4')).props.disabled, true);
  assert.match(ui.text(), /new Round/); ui.dispose();
});
test('native has no Refresh button and automatically recovers a transient loading failure', async () => {
  let attempts = 0;
  const { ui } = runtime({ read: async () => { if (++attempts === 1) throw Error('temporary'); return []; } });
  await ui.settle(); assert.doesNotMatch(ui.text(), /Refresh recent configurations/); assert.equal(attempts, 1);
  await ui.advance(999); assert.equal(attempts, 1);
  await ui.advance(1); assert.equal(attempts, 2); assert.match(ui.text(), /successfully confirmed/);
  assert.equal(ui.timers.size, 0); await ui.advance(60000); assert.equal(attempts, 2); ui.dispose();
});
test('native retry budget is bounded and app return permits automatic recovery', async () => {
  let offline = true, attempts = 0;
  const { ui } = runtime({ read: async () => { attempts++; if (offline) throw Error('offline'); return []; } });
  await ui.settle(); for (const delay of [1000, 4000, 15000]) await ui.advance(delay);
  assert.equal(attempts, 4); assert.equal(ui.timers.size, 0); await ui.advance(120000); assert.equal(attempts, 4);
  offline = false; ui.listeners.get('change')('background'); ui.listeners.get('change')('active'); ui.listeners.get('change')('active'); await ui.settle();
  assert.equal(attempts, 5); assert.match(ui.text(), /successfully confirmed/); ui.dispose();
});
test('native background retries do not issue requests and unmount clears timers and listeners', async () => {
  let attempts = 0;
  const { ui } = runtime({ read: async () => { attempts++; throw Error('offline'); } });
  await ui.settle(); ui.listeners.get('change')('background'); await ui.advance(1000); assert.equal(attempts, 1);
  ui.listeners.get('change')('active'); await ui.settle(); assert.equal(attempts, 2);
  ui.dispose(); assert.equal(ui.timers.size, 0); assert.equal(ui.listeners.size, 0); await ui.advance(60000); assert.equal(attempts, 2);
});
test('native uncertain removal automatically reloads history without repeating the removal', async () => {
  const { ui, setRows, calls } = runtime({ forget: async () => { throw Error('response lost'); } });
  await ui.settle(); await ui.nodes().find(n => n.props?.accessibilityLabel?.startsWith('Remove recent')).props.onPress(); await ui.settle();
  assert.match(ui.text(), /Removal could not be confirmed/);
  setRows([]); await ui.advance(1000); assert.doesNotMatch(ui.text(), /9 × 4|Removal could not be confirmed/);
  assert.equal(calls.filter(c => c.name === 'forget_recent_round_config').length, 1); ui.dispose();
});
test('actual mobile Configure Round recalls 9 × 4 into existing inputs then uses unchanged creation workflow', async () => {
  const created = [], navigation = [];
  const ui = recentRuntime('apps/mobile/app/sessions/[sessionId]/configure-round.tsx', {
    'react-native': native, '../../../src/appearance': appearance, '../../../src/theme': { PAGE_TOP_SPACING: 0 },
    '../../../src/auth': { useAuth: () => ({ user: { id: actor } }) },
    '../../../src/recent-round-configs': { RecentRoundConfigs: 'Recent' }, '../../../src/round-config': roundModel,
    '../../../src/round-navigation': { scoreRoundHref: roundId => ({ pathname: '/rounds/[roundId]/score', params: { roundId } }) },
    '../../../src/writes': { createMobileRound: async (sessionId, input) => { created.push({ sessionId, input }); return { roundId: 'created-round' }; } },
    'expo-router': { useLocalSearchParams: () => ({ sessionId: 'owned-session' }), router: { replace: value => navigation.push(value) } },
  });
  ui.setComponent(ui.exports.default); ui.render();
  ui.nodes().find(n => n.type === 'Recent').props.onSelect({ ...config }); ui.render();
  assert.equal(ui.nodes().find(n => n.props?.accessibilityLabel === 'Planned Ends').props.value, '9');
  assert.equal(ui.nodes().find(n => n.props?.accessibilityLabel === 'Arrows per End').props.value, '4');
  ui.nodes().find(n => n.type === 'Pressable' && n.props.children?.type === 'Text' && n.props.children.props.children === 'Start Round').props.onPress();
  await ui.settle(); assert.deepEqual(created[0], { sessionId: 'owned-session', input: config });
  assert.equal(navigation[0].params.roundId, 'created-round'); ui.dispose();
});

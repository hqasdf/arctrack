import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSessionUI, settle, treeText } from './helpers/session-layout-runtime.mjs';

const base = { revision: 'a'.repeat(32), authorized: false, window: null, candidates: [], datasets: [] };
const reply = data => Response.json(data);

for (const state of ['never_connected', 'disconnected', 'reauthorization_required', 'revoked']) test('General timing survives hidden Health: ' + state, async () => {
  const h = createSessionUI(async () => reply(base)); h.render(); await settle(); h.render();
  assert.match(h.text(), /Session Details.*Arrow count.*Start Session timer.*Scoring Rounds.*Session Notes/s);
  assert.doesNotMatch(h.text(), /Garmin Session Health|Manage Garmin|Confirm Garmin activity/);
  assert.equal(h.nodes().find(n => n.type === 'button' && treeText(n) === 'Start Session timer').props.disabled, false);
  h.dispose();
});
test('Loading and unavailable connection states do not render private Health or block rounds/notes', async () => {
  let reject; const h = createSessionUI(() => new Promise((_, no) => { reject = no; }));
  h.render(); assert.doesNotMatch(h.text(), /Garmin Session Health/); assert.match(h.text(), /Scoring Rounds.*Session Notes/s);
  reject(Error('offline')); await settle(); h.render(); assert.doesNotMatch(h.text(), /Garmin Session Health/); assert.match(h.text(), /Retry/); h.dispose();
});
test('Authorised empty Health is below rounds and notes, with one general timing form', async () => {
  const h = createSessionUI(async () => reply({ ...base, authorized: true })); h.render(); await settle(); const html = renderToStaticMarkup(h.render());
  const order = ['Session Details', 'Scoring Rounds', 'Session Notes', 'Garmin Session Health'].map(s => html.indexOf(s));
  assert.ok(order.every((v, i) => v >= 0 && (!i || v > order[i - 1])));
  assert.equal((html.match(/Start Session timer/g) ?? []).length, 1); assert.match(html, /Enter both shooting times in Session Details/); h.dispose();
});
test('Timing start/finish preserve the exact optimistic revision and server-confirmed result without Garmin', async () => {
  let data = base; const h = createSessionUI(async (_, options) => {
    if (options.method === 'POST') { const body = JSON.parse(options.body); assert.equal(body.expected, data.window?.updated_at ?? null); data = { ...base, window: { started_at: '2026-10-25T06:00:00Z', finished_at: body.action === 'finish' ? '2026-10-25T07:00:00Z' : null, updated_at: body.action } }; }
    return reply(data);
  }); h.render(); await settle(); h.render(); await h.click('Start Session timer'); await settle(); h.render();
  assert.match(h.text(), /Timer running/); await h.click('Finish Session timer'); await settle(); h.render(); assert.doesNotMatch(h.text(), /Timer running/);
  assert.deepEqual(h.calls.filter(c => c.options.method === 'POST').map(c => JSON.parse(c.options.body).action), ['start', 'finish']); h.dispose();
});
test('Unsaved Singapore timing draft survives status refresh and Health disconnection', async () => {
  let authorized = true; const h = createSessionUI(async () => reply({ ...base, authorized })); h.render(); await settle(); h.render();
  h.nodes().find(n => n.type === 'input' && n.props.type === 'datetime-local').props.onChange({ target: { value: '2026-10-25T14:30' } }); h.render();
  authorized = false; await h.click('Refresh details'); await settle(); h.render();
  assert.equal(h.nodes().find(n => n.type === 'input').props.value, '2026-10-25T14:30'); assert.doesNotMatch(h.text(), /Garmin Session Health/); h.dispose();
});
test('Backgrounding hides private HR and unmount cleans up its refresh timer and listeners', async () => {
  const h = createSessionUI(async () => reply({ ...base, authorized: true })); h.render(); await settle(); h.render(); h.visibility('hidden'); h.render();
  assert.doesNotMatch(h.text(), /Garmin Session Health/); assert.match(h.text(), /Session Details/); h.dispose(); assert.equal(h.timers.size, 0); assert.equal(h.listeners.size, 0);
});
test('Manual timing still submits Singapore-local values as UTC with the exact saved revision', async () => {
  const window = { started_at: '2026-10-24T16:30:00Z', finished_at: null, updated_at: 'microsecond-revision' };
  const h = createSessionUI(async () => reply({ ...base, window })); h.render(); await settle(); h.render();
  const fields = h.nodes().filter(n => n.type === 'input');
  fields[0].props.onChange({ target: { value: '2026-10-25T00:45' } }); h.render();
  h.nodes().filter(n => n.type === 'input')[1].props.onChange({ target: { value: '2026-10-25T01:45' } }); h.render();
  h.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await settle();
  assert.deepEqual(JSON.parse(h.calls.find(c => c.options.method === 'POST').options.body), { action: 'manual', expected: 'microsecond-revision', start: '2026-10-24T16:45:00.000Z', finish: '2026-10-24T17:45:00.000Z' }); h.dispose();
});
test('Background interruption during a timing write cannot leave the controls permanently busy', async () => {
  let resolvePost; const h = createSessionUI(async (_, options) => options.method === 'POST' ? new Promise(resolve => { resolvePost = resolve; }) : reply(base));
  h.render(); await settle(); h.render(); await h.click('Start Session timer'); h.render(); h.visibility('hidden'); h.render();
  resolvePost(reply({ ...base, authorized: true })); await settle(); h.render();
  assert.doesNotMatch(h.text(), /Garmin Session Health/);
  assert.equal(h.nodes().find(n => n.type === 'button' && treeText(n) === 'Refresh details').props.disabled, false); h.dispose();
});
test('Session composition preserves scoring handlers and places gated feedback last', () => {
  const source = readFileSync(new URL('../src/features/sessions/components/sessions-workspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /SessionHealthSections.*details=/); assert.match(source, /CoachFeedbackPanel[^>]*activeMembershipOnly/);
  assert.ok(source.indexOf('SessionNotesPanel key=') < source.lastIndexOf('CoachFeedbackPanel key='));
  assert.match(source, /setActiveRoundId\(round.id\);setView\("scoring"\)/);
});

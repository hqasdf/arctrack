import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateRoundConfiguration, roundConfigurationLabel, readRecentRoundConfigurations, forgetRecentRoundConfiguration } from '../src/recent-round-configs.ts';
const config = { name: 'Custom round', division: 'Barebow', distanceMetres: 25, faceDiameterCm: 80, faceType: 'full_face', ends: 9, arrowsPerEnd: 4 };
test('labels preserve Ends × arrows semantics and distinguish distance, division and face', () => {
  assert.equal(roundConfigurationLabel(config), '9 × 4 · Barebow · 25 m · 80 cm full face');
  assert.match(roundConfigurationLabel({ ...config, ends: 6, arrowsPerEnd: 12, faceType: 'triple_face' }), /^6 × 12.*triple face$/);
  assert.match(roundConfigurationLabel({ ...config, ends: 3, arrowsPerEnd: 10 }), /^3 × 10/);
});
test('configuration whitelist retains all form fields and never copies historical data', () => {
  const original = { ...config, id: randomUUID(), sessionId: randomUUID(), arrows: [{ score: 10 }], notes: 'private', date: '2000-01-01' };
  const result = validateRoundConfiguration(original);
  assert.deepEqual(result, config); result.name = 'Edited after recall'; assert.equal(original.name, config.name);
});
test('invalid and incomplete configuration is rejected without a transport call', () => {
  for (const patch of [{ name: '' }, { ends: 0 }, { ends: 1.5 }, { arrowsPerEnd: NaN }, { faceType: 'invalid' }, { division: null }, { distanceMetres: 32768 }]) assert.throws(() => validateRoundConfiguration({ ...config, ...patch }));
});
test('both platforms consume the same account-backed records in server recency order', async () => {
  const actor = randomUUID(), ids = [randomUUID(), randomUUID()], calls = [];
  const rows = ids.map((id, i) => ({ id, round_name: config.name, division: config.division, distance_metres: 25, face_diameter_cm: 80, face_type: 'full_face', planned_ends: i ? 6 : 9, arrows_per_end: i ? 12 : 4, last_used_at: '2026-10-27T06:00:00Z' }));
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'read_recent_round_configs' ? rows : true, error: null }; } };
  const web = await readRecentRoundConfigurations(client, actor), mobile = await readRecentRoundConfigurations(client, actor);
  assert.deepEqual(web, mobile); assert.deepEqual(web.map(r => r.id), ids); assert.deepEqual(web[0].configuration, config);
  await forgetRecentRoundConfiguration(client, actor, ids[0]);
  assert.deepEqual(calls.at(-1), { name: 'forget_recent_round_config', args: { p_actor: actor, p_id: ids[0] } });
  assert.equal(calls.some(c => /save|remember|create/.test(c.name)), false, 'no client-side draft saving API');
});
test('missing migration, offline requests and malformed records do not appear as saved history', async () => {
  const actor = randomUUID();
  for (const response of [{ data: null, error: { code: 'PGRST202' } }, { data: {}, error: null }, { data: [{}], error: null }]) await assert.rejects(() => readRecentRoundConfigurations({ rpc: async () => response }, actor));
  await assert.rejects(() => readRecentRoundConfigurations({ rpc: async () => { throw Error('offline'); } }, actor));
  await assert.rejects(() => forgetRecentRoundConfiguration({ rpc: async () => ({ data: false, error: null }) }, actor, randomUUID()), /could not be confirmed/);
});

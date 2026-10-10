/** Local-only integration harness. Requires a disposable, migrated Supabase stack.
 * Run: node supabase/tests/self-service-account-deletion.integration.mjs
 * Supply SUPABASE_TEST_URL, SUPABASE_TEST_PUBLISHABLE_KEY, SUPABASE_TEST_SECRET_KEY.
 * Never loads .env files. Real Auth/Admin/PostgREST calls; only Next cache and
 * the server-cookie client factory are replaced. Not browser-cookie/CSRF QA.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as sdk from '@supabase/supabase-js';

const endpoint = new URL(process.env.SUPABASE_TEST_URL || 'http://invalid/');
assert(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname)
  && !endpoint.username && !endpoint.password && endpoint.pathname === '/'
  && !endpoint.search && !endpoint.hash, 'Only explicit http localhost/127.0.0.1 test endpoints are allowed');
const publishableKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_TEST_SECRET_KEY;
assert(publishableKey?.startsWith('sb_publishable_') && secret, 'Explicit local test keys are required');
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const makeClient = () => sdk.createClient(endpoint.origin, publishableKey, options);
const admin = sdk.createClient(endpoint.origin, secret, options);
// Isolated environment passed only to transpiled real project modules. No production env is inherited.
const testProcess = { env: { NEXT_PUBLIC_SUPABASE_URL: endpoint.origin,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey, APP_URL: 'http://localhost:3000',
  SUPABASE_SECRET_KEY: secret } };
let cookieClient;
async function load(relativePath, imports) {
  const source = await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const compiledModule = { exports: {} };
  const require = (name) => {
    assert(Object.hasOwn(imports, name), `Unexpected project import: ${name}`);
    return imports[name];
  };
  new Function('require', 'module', 'exports', 'process', output)(require, compiledModule, compiledModule.exports, testProcess);
  return compiledModule.exports;
}
const config = await load('src/lib/auth/config.ts', {});
assert(config.getAuthConfig(), 'Real project config rejects the supplied local publishable key');
const helper = await load('src/lib/supabase/admin.server.ts', {
  'server-only': {}, '@supabase/supabase-js': sdk, '@/lib/auth/config': config,
});
const action = await load('src/features/profile/account-deletion-actions.ts', {
  'next/cache': { revalidatePath() {} }, '@supabase/supabase-js': sdk,
  '@/lib/auth/config': config, '@/lib/supabase/admin.server': helper,
  '@/lib/supabase/server': { async createAuthClient() { assert(cookieClient); return cookieClient; } },
});
function ok(result, label) { assert(!result.error, label); return result.data; }
function userMissing(result) {
  return Boolean(result.error && (result.error.status === 404 || result.error.code === 'user_not_found'));
}
function authorizationDenied(result) {
  return Boolean(result.error && [401, 403].includes(result.status ?? result.error.status));
}
function unreadable(result) {
  return authorizationDenied(result) || (!result.error && Array.isArray(result.data) && result.data.length === 0);
}
async function rows(table, column, value) {
  return ok(await admin.from(table).select('*').eq(column, value), `Read ${table} fixture`);
}
async function login(user) {
  const client = makeClient();
  const data = ok(await client.auth.signInWithPassword({ email: user.email, password: user.password }), 'Synthetic sign-in');
  assert.equal(data.user.id, user.id);
  return { client, session: data.session };
}
async function deleteThroughAction(user, fields = {}) {
  cookieClient = user.client;
  const form = new FormData();
  for (const [key, value] of Object.entries({ password: user.password, confirmation: 'DELETE', ...fields })) form.set(key, value);
  return action.deleteAccount({ status: 'idle', message: '' }, form);
}
const users = [];
const deleted = new Set();
let organizationId;
let primaryFailure;
try {
  for (const role of ['Archer A', 'Archer B', 'Coach C', 'Former D', 'Unrelated E']) {
    const email = `deletion-${randomUUID()}@example.invalid`;
    const password = `Local-test-${randomUUID()}!`;
    const created = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Create synthetic user');
    const user = { role, id: created.user.id, email, password };
    users.push(user); // Track before subsequent calls so partial setup can be cleaned up.
    Object.assign(user, await login(user));
    const today = new Date().toISOString().slice(0, 10);
    const session = ok(await user.client.rpc('create_owned_session', {
      p_title: `Deletion fixture ${role}`, p_session_date: today, p_session_type: 'training',
    }), 'Guarded session setup')[0];
    user.scoringSession = session.id;
    const round = ok(await user.client.rpc('create_round_with_ends', {
      p_session_id: session.id, p_name: 'Fixture Round', p_division: 'Recurve',
      p_distance_metres: 70, p_face_diameter_cm: 122, p_face_type: 'full_face',
      p_planned_ends: 1, p_arrows_per_end: 6,
    }), 'Guarded round setup')[0];
    user.round = round.round_id;
    const end = ok(await user.client.from('session_ends').select('id').eq('session_round_id', user.round).single(), 'Read fixture end');
    user.end = end.id;
    const arrow = ok(await user.client.rpc('save_owned_arrow', {
      p_session_end_id: end.id, p_arrow_number: 1, p_score_points: 10, p_is_x: true,
      p_plot_x: null, p_plot_y: null, p_face_index: null, p_arrow_id: null,
    }), 'Guarded arrow setup')[0];
    user.arrow = arrow.id;
  }
  const [a, b, c, d, e] = users;
  organizationId = ok(await c.client.from('organizations').insert({
    name: `Deletion fixture ${randomUUID()}`, created_by: c.id,
  }).select('id').single(), 'Coach organization setup').id;
  ok(await admin.from('organization_members').insert([
    { organization_id: organizationId, user_id: a.id, role: 'archer', status: 'active' },
    { organization_id: organizationId, user_id: b.id, role: 'archer', status: 'active' },
    { organization_id: organizationId, user_id: d.id, role: 'archer', status: 'left', left_at: new Date().toISOString() },
  ]), 'Admin membership setup');
  const today = new Date().toISOString().slice(0, 10);
  const plan = ok(await admin.from('training_plans').insert({ organization_id: organizationId,
    created_by: c.id, title: 'Shared deletion fixture', start_date: today, end_date: today,
    weekly_arrow_target: 60, note: 'Preserve shared note',
  }).select('*').single(), 'Admin shared plan setup');
  ok(await admin.from('training_plan_days').insert({ training_plan_id: plan.id,
    date: today, arrow_target: 60, coach_note: 'Preserve shared day',
  }), 'Admin shared day setup');
  ok(await admin.from('training_plan_assignments').insert([a, b].map(user => ({
    training_plan_id: plan.id, athlete_user_id: user.id, assigned_by: c.id,
  }))), 'Admin assignment setup');
  const baseline = { org: await rows('organizations', 'id', organizationId),
    plan: await rows('training_plans', 'id', plan.id), days: await rows('training_plan_days', 'training_plan_id', plan.id),
    bProfile: await rows('profiles', 'id', b.id), bSession: await rows('sessions', 'id', b.scoringSession),
    bArrow: await rows('arrows', 'id', b.arrow) };

  const absent = await a.client.rpc('delete_own_account');
  assert(absent.error && absent.error.code === 'PGRST202', 'Legacy public deletion RPC must be missing');
  const denied = await a.client.auth.admin.deleteUser(e.id);
  assert(authorizationDenied(denied), 'Ordinary client Admin deletion must return 401/403');
  ok(await admin.auth.admin.getUserById(e.id), 'Denied Admin request preserves victim');
  assert.equal((await deleteThroughAction(a, { password: 'deliberately-wrong-password' })).status, 'error');
  assert.equal((await deleteThroughAction(a, { confirmation: 'delete' })).status, 'error');
  assert.equal((await deleteThroughAction(a, { confirmation: '' })).status, 'error');
  const validForm = new FormData();
  validForm.set('password', a.password); validForm.set('confirmation', 'DELETE');
  cookieClient = makeClient();
  assert.equal((await action.deleteAccount({ status: 'idle', message: '' }, validForm)).status, 'error', 'Real signed-out request denied');
  if (process.env.SUPABASE_TEST_WAIT_FOR_EXPIRY === '1') {
    // Only use naturally issued local tokens. Short expiry is test-stack config, not app behavior.
    const wait = Math.max(0, (a.session.expires_at + 1) * 1000 - Date.now());
    assert(wait <= 65000, 'Expiry test needs local jwt_expiry=60, never wait for a production-length token');
    console.log('Waiting for the locally issued short-lived access token to expire.');
    await new Promise(resolve => setTimeout(resolve, wait));
    cookieClient = sdk.createClient(endpoint.origin, publishableKey, {
      ...options, global: { headers: { Authorization: `Bearer ${a.session.access_token}` } },
    });
    assert(authorizationDenied(await cookieClient.auth.getUser()), 'Real expired JWT rejected by Auth');
    assert.equal((await action.deleteAccount({ status: 'idle', message: '' }, validForm)).status, 'error', 'Expired JWT cannot reach deletion');
    ok(await admin.auth.admin.getUserById(a.id), 'Expired-token attempt preserves user');
    // Refresh the baselines so subsequent stale-token checks use unexpired, signed tokens.
    for (const user of users) Object.assign(user, await login(user));
    console.log('PASS: naturally expired local JWT cannot delete an account.');
  }
  ok(await admin.auth.admin.getUserById(a.id), 'Failed checks preserve account');
  assert.equal((await rows('arrows', 'id', a.arrow)).length, 1, 'Failed checks preserve data');

  // Supplied victim fields are ignored: the real action deletes verified caller A.
  const oldSession = a.session;
  assert.equal((await deleteThroughAction(a, { userId: e.id, user_id: e.id, email: e.email })).status, 'success');
  deleted.add(a.id);
  assert(userMissing(await admin.auth.admin.getUserById(a.id)), 'Admin Auth explicitly confirms account absent');
  for (const [table, column, value] of [
    ['profiles', 'id', a.id], ['sessions', 'user_id', a.id], ['session_rounds', 'id', a.round],
    ['session_ends', 'id', a.end], ['arrows', 'id', a.arrow],
    ['organization_members', 'user_id', a.id], ['training_plan_assignments', 'athlete_user_id', a.id],
  ]) assert.equal((await rows(table, column, value)).length, 0, `Archer cascade ${table}`);
  ok(await admin.auth.admin.getUserById(e.id), 'Victim fields did not delete unrelated account');
  assert.deepEqual(await rows('organizations', 'id', organizationId), baseline.org);
  assert.deepEqual(await rows('training_plans', 'id', plan.id), baseline.plan);
  assert.deepEqual(await rows('training_plan_days', 'training_plan_id', plan.id), baseline.days);
  assert.deepEqual(await rows('profiles', 'id', b.id), baseline.bProfile);
  assert.deepEqual(await rows('sessions', 'id', b.scoringSession), baseline.bSession);
  assert.deepEqual(await rows('arrows', 'id', b.arrow), baseline.bArrow);
  assert.equal((await rows('training_plan_assignments', 'athlete_user_id', b.id)).length, 1);
  assert.equal((await deleteThroughAction(a)).status, 'error', 'Repeat action is rejected');
  const stale = sdk.createClient(endpoint.origin, publishableKey, {
    ...options, global: { headers: { Authorization: `Bearer ${oldSession.access_token}` } },
  });
  const forbidden = await stale.from('sessions').select('id').eq('id', b.scoringSession);
  assert(unreadable(forbidden), 'Deleted user old JWT must return authorization denial or empty RLS result');
  const staleWrite = await stale.rpc('save_owned_arrow', {
    p_session_end_id: b.end, p_arrow_number: 2, p_score_points: 9, p_is_x: false,
    p_plot_x: null, p_plot_y: null, p_face_index: null, p_arrow_id: null,
  });
  assert(authorizationDenied(staleWrite) || staleWrite.error?.code === '42501', 'Deleted user old JWT must be denied by guarded Arrow ownership');
  assert.deepEqual(await rows('arrows', 'id', b.arrow), baseline.bArrow);
  assert.equal((await rows('arrows', 'session_end_id', b.end)).length, 1, 'Stale write must not add an Arrow');
  assert((await makeClient().auth.refreshSession({ refresh_token: oldSession.refresh_token })).error, 'Deleted refresh token rejected');
  assert((await makeClient().auth.signInWithPassword({ email: a.email, password: a.password })).error, 'Deleted password sign-in rejected');
  await login(b);
  await login(e);

  assert.equal(ok(await c.client.from('sessions').select('id').eq('id', b.scoringSession),
    'Active Coach cross-user baseline').length, 1, 'Coach can read Archer before deletion');
  assert.equal((await deleteThroughAction(c)).status, 'success', 'Head Coach action deletion');
  deleted.add(c.id);
  assert.equal((await rows('organizations', 'id', organizationId))[0].created_by, null);
  assert.deepEqual(await rows('training_plans', 'id', plan.id), baseline.plan.map(row => ({ ...row, created_by: null })));
  assert.deepEqual(await rows('training_plan_days', 'training_plan_id', plan.id), baseline.days);
  assert.equal((await rows('training_plan_assignments', 'athlete_user_id', b.id))[0].assigned_by, null);
  const oldCoach = sdk.createClient(endpoint.origin, publishableKey, {
    ...options, global: { headers: { Authorization: `Bearer ${c.session.access_token}` } },
  });
  const coachRead = await oldCoach.from('sessions').select('id').eq('id', b.scoringSession);
  assert(unreadable(coachRead), 'Deleted Coach old JWT must return authorization denial or empty RLS result');
  assert.equal((await deleteThroughAction(d)).status, 'success', 'Former member action deletion');
  deleted.add(d.id);
  for (const user of [c, d]) {
    assert(userMissing(await admin.auth.admin.getUserById(user.id)), `${user.role} Auth deletion explicitly confirmed`);
    for (const [table, column, value] of [['profiles', 'id', user.id], ['sessions', 'user_id', user.id],
      ['session_rounds', 'id', user.round], ['session_ends', 'id', user.end], ['arrows', 'id', user.arrow],
      ['organization_members', 'user_id', user.id]]) {
      assert.equal((await rows(table, column, value)).length, 0, `${user.role} cascade ${table}`);
    }
  }
  await login(b);
  await login(e);
  console.log('PASS: real local Auth/Admin deletion, action verification, RPC/Admin bypass rejection, public cascades and shared preservation.');
  console.log('Limits: no browser cookie/CSRF QA, no private operation-budget/auth-session SQL inspection or injected Admin failure rollback.');
} catch (error) {
  primaryFailure = error;
  throw error;
} finally {
  const failures = [];
  for (const user of users) {
    if (deleted.has(user.id)) continue;
    const result = await admin.auth.admin.deleteUser(user.id, false);
    // A test may fail after deletion committed but before tracking it.
    if (result.error && !userMissing(await admin.auth.admin.getUserById(user.id))) failures.push('user cleanup');
  }
  if (organizationId) {
    const result = await admin.from('organizations').delete().eq('id', organizationId);
    if (result.error) failures.push('organization cleanup');
  }
  if (failures.length) {
    console.error('Fixture cleanup failed. Exact tracked fixture IDs:',
      JSON.stringify({ userIds: users.map(user => user.id), organizationId }));
    if (!primaryFailure) throw new Error('Exact fixture cleanup failed');
  }
}

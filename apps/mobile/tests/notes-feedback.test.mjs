import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import * as core from "@arc-track/core/notes-feedback";
import { getThemeColors } from "../src/theme.ts";
import { getCoachPalette } from "../src/coach-palette.ts";

// Native source is inspected below. Node supplies this isolated existing-Expo binding mock.
Object.defineProperty(globalThis, "expo", { configurable: true, value: { uuidv4: randomUUID } });

function load(relative, dependencies) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  new Function("require", "exports", outputText)((name) => {
    assert.ok(name in dependencies, `Unmocked dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
const stamp = "2026-10-21T10:00:00Z";
const requestId = "11111111-1111-4111-8111-111111111111";
const noteRow = (body = "Technical focus: release rhythm", updated = stamp) => ({ session_id: "session-a", body, technique_tags: ["release"], created_at: stamp, updated_at: updated });
const feedbackRow = (id = "feedback-a", changes = {}) => ({ id, organization_id: "org-a", athlete_user_id: "athlete-a", author_user_id: "coach-a", kind: "session", session_id: "session-a", body: "Maintain the same release rhythm.", created_at: stamp, updated_at: stamp, author_display_name: "Coach A", can_edit: true, ...changes });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function adapter({ userId = "athlete-a", rpc, read, roster = [{ userId: "athlete-a" }] } = {}) {
  const calls = [], queries = [];
  let accepted = { accountId: userId, epoch: 1, mode: "normal" };
  const client = {
    auth: { getUser: async () => ({ data: { user: accepted ? { id: accepted.accountId } : null }, error: null }) },
    rpc: async (name, args) => { calls.push({ name, args }); return rpc ? rpc(name, args) : { data: null, error: null }; },
    from(table) {
      const query = { table, filters: [] }; queries.push(query);
      const builder = { select(columns) { query.columns = columns; return builder; }, eq(key, value) { query.filters.push([key, value]); return builder; }, async maybeSingle() { return read ? read(query) : { data: table === "sessions" ? { id: "session-a" } : noteRow(), error: null }; } };
      return builder;
    },
  };
  const api = load("../src/notes-feedback.ts", {
    "@arc-track/core/notes-feedback": core,
    "./organizations": { readCoachAthletes: async () => roster },
    "./supabase": { supabase: client, sessionAuthority: { snapshot: () => ({ accepted, retiring: false }) } },
  });
  return { api, calls, queries, client, switchAccount(id) { accepted = id ? { accountId: id, epoch: (accepted?.epoch ?? 0) + 1, mode: "normal" } : null; } };
}

test("mobile note reads map persisted fields and refresh / re-login use the same record", async () => {
  const a = adapter();
  assert.deepEqual(await a.api.readMobileSessionNote("athlete-a", "session-a"), core.mapSessionNote(noteRow()));
  assert.equal((await a.api.readMobileSessionNote("athlete-a", "session-a")).sessionId, "session-a");
  a.switchAccount("athlete-a");
  assert.equal((await a.api.readMobileSessionNote("athlete-a", "session-a")).body, noteRow().body);
  assert.deepEqual(a.queries[0].filters, [["session_id", "session-a"]]);
});

test("mobile note create/edit/delete use guarded RPCs and original optimistic timestamps", async () => {
  const a = adapter({ rpc: async (name) => ({ data: name === "delete_session_notes" ? true : [noteRow()], error: null }) });
  await a.api.saveMobileSessionNote("athlete-a", "session-a", "  New note  ", ["release", "release"], null);
  await a.api.saveMobileSessionNote("athlete-a", "session-a", "Updated note", [], stamp);
  await a.api.deleteMobileSessionNote("athlete-a", "session-a", stamp);
  assert.deepEqual(a.calls.map(({ name }) => name), ["save_session_notes", "save_session_notes", "delete_session_notes"]);
  assert.equal(a.calls[0].args.p_expected_updated_at, null);
  assert.equal(a.calls[0].args.p_body, "New note");
  assert.deepEqual(a.calls[0].args.p_technique_tags, ["release"]);
  assert.equal(a.calls[1].args.p_expected_updated_at, stamp);
  assert.equal(a.calls[2].args.p_expected_updated_at, stamp);
  assert.equal(a.queries.length, 0);
});

test("invalid or empty notes fail before authenticated network operations", async () => {
  const a = adapter();
  await assert.rejects(a.api.saveMobileSessionNote("athlete-a", "session-a", "  ", [], null), /1 and 4,000/);
  await assert.rejects(a.api.saveMobileSessionNote("athlete-a", "session-a", "x".repeat(4001), [], null), /4,000/);
  await assert.rejects(a.api.saveMobileSessionNote("athlete-a", "session-a", "note", Array.from({ length: 9 }, (_, index) => `tag${index}`), null), /8 technique/);
  assert.equal(a.calls.length, 0);
});

test("schema unavailable, conflict, denied and unconfirmed mutations never become success", async () => {
  for (const [code, pattern] of [["PGRST202", /database update/], ["40001", /another device/], ["42501", /permission/]]) {
    const a = adapter({ rpc: async () => ({ data: null, error: { code } }) });
    await assert.rejects(a.api.saveMobileSessionNote("athlete-a", "session-a", "draft", [], stamp), pattern);
    await assert.rejects(a.api.readMobileFeedback("athlete-a", {}), pattern);
  }
  const a = adapter();
  await assert.rejects(a.api.saveMobileSessionNote("athlete-a", "session-a", "draft", [], null), /not confirmed/);
  await assert.rejects(a.api.deleteMobileSessionNote("athlete-a", "session-a", stamp), /not deleted/);
  await assert.rejects(a.api.readMobileFeedback("athlete-a", {}), /unexpected response/);
});

test("expired auth and stale accounts cannot publish notes or feedback responses", async () => {
  const pending = deferred();
  const a = adapter({ read: () => pending.promise });
  const result = a.api.readMobileSessionNote("athlete-a", "session-a");
  await new Promise(setImmediate);
  a.switchAccount("athlete-b"); pending.resolve({ data: noteRow(), error: null });
  await assert.rejects(result, /account changed/);
  await assert.rejects(a.api.readMobileFeedback("athlete-a", {}), /Sign in again/);
  a.switchAccount(null);
  await assert.rejects(a.api.saveMobileSessionNote("athlete-a", "session-a", "draft", [], null), /Sign in again/);
});

test("coach note reads require exact-organisation active roster and matching athlete Session", async () => {
  const a = adapter({ userId: "coach-a" });
  await a.api.readMobileSessionNote("coach-a", "session-a", { organizationId: "org-a", athleteId: "athlete-a" });
  assert.deepEqual(a.queries[0].filters, [["id", "session-a"], ["user_id", "athlete-a"]]);
  const denied = adapter({ userId: "coach-a", roster: [] });
  await assert.rejects(denied.api.readMobileSessionNote("coach-a", "session-a", { organizationId: "org-b", athleteId: "athlete-a" }), /no longer have access/);
  assert.equal(denied.queries.length, 0);
});

test("feedback reader scopes exact organisation and author and uses stable chronological cursor", async () => {
  const rows = Array.from({ length: 25 }, (_, index) => feedbackRow(`f${index}`));
  const a = adapter({ userId: "coach-a", rpc: async () => ({ data: rows, error: null }) });
  const page = await a.api.readMobileFeedback("coach-a", { organizationId: "org-a", athleteId: "athlete-a", kind: "session" });
  assert.deepEqual(page.next, { createdAt: stamp, id: "f24" });
  await a.api.readMobileFeedback("coach-a", { organizationId: "org-a", athleteId: "athlete-a", kind: "session" }, page.next);
  assert.deepEqual(a.calls[1].args, { p_athlete_user_id: "athlete-a", p_organization_id: "org-a", p_session_id: null, p_kind: "session", p_before_created_at: stamp, p_before_id: "f24", p_limit: 25 });
  for (const wrong of [{ organization_id: "org-b" }, { author_user_id: "coach-b" }, { athlete_user_id: "athlete-b" }]) {
    const denied = adapter({ userId: "coach-a", rpc: async () => ({ data: [feedbackRow("bad", wrong)], error: null }) });
    await assert.rejects(denied.api.readMobileFeedback("coach-a", { organizationId: "org-a", athleteId: "athlete-a" }), /access could not be verified/);
  }
});

test("reader retains deleted-session feedback without organisation membership", async () => {
  const rows = [feedbackRow("history", { organization_id: null, author_user_id: null, kind: "session", session_id: null, can_edit: false })];
  const a = adapter({ rpc: async () => ({ data: rows, error: null }) });
  const result = await a.api.readMobileFeedback("athlete-a", {});
  assert.equal(result.entries[0].kind, "session");
  assert.equal(result.entries[0].sessionId, null);
  assert.equal(a.calls[0].args.p_kind, "session");
  assert.equal(a.calls[0].args.p_organization_id, null);
  assert.equal(a.calls[0].args.p_athlete_user_id, "athlete-a");
});

test("a signed-in coach's own Sessions history filters by their recipient identity before pagination", async () => {
  const own = feedbackRow("received", { athlete_user_id: "coach-a", author_user_id: "coach-b", can_edit: false });
  const authoredForAnotherAthlete = feedbackRow("authored-for-athlete");
  const a = adapter({ userId: "coach-a", rpc: async (_name, args) => ({
    data: [own, authoredForAnotherAthlete].filter(row => !args.p_athlete_user_id || row.athlete_user_id === args.p_athlete_user_id), error: null,
  }) });
  const result = await a.api.readMobileFeedback("coach-a", {});
  assert.equal(a.calls[0].args.p_athlete_user_id, "coach-a");
  assert.equal(a.calls[0].args.p_organization_id, null);
  assert.deepEqual(result.entries.map(entry => entry.id), ["received"]);
  assert.equal(result.next, null);
});

test("feedback author mutations cannot impersonate another coach or move immutable context", async () => {
  const a = adapter({ userId: "coach-a", rpc: async (name) => ({ data: name === "delete_coach_feedback" ? true : "feedback-a", error: null }) });
  const entry = core.mapCoachFeedback(feedbackRow());
  await a.api.saveMobileCoachFeedback("coach-a", { organizationId: "org-a", athleteId: "athlete-a", sessionId: "session-a" }, "  Feedback  ", null, requestId);
  await a.api.saveMobileCoachFeedback("coach-a", { organizationId: "org-a", athleteId: "athlete-a" }, "Updated", entry);
  await a.api.deleteMobileCoachFeedback("coach-a", "org-a", entry);
  assert.equal(a.calls[0].args.p_feedback_id, null);
  assert.equal(a.calls[0].args.p_kind, "session");
  assert.equal(a.calls[0].args.p_body, "Feedback");
  assert.equal(a.calls[0].args.p_creation_request_id, requestId);
  assert.equal("p_author_user_id" in a.calls[0].args, false);
  assert.equal(a.calls[1].args.p_expected_updated_at, stamp);
  assert.equal(a.calls[1].args.p_creation_request_id, null);
  for (const invalid of [{ ...entry, authorUserId: "coach-b" }, { ...entry, organizationId: "org-b" }, { ...entry, canEdit: false }]) {
    await assert.rejects(a.api.saveMobileCoachFeedback("coach-a", { organizationId: "org-a", athleteId: "athlete-a" }, "Updated", invalid), /original authorised coach/);
    await assert.rejects(a.api.deleteMobileCoachFeedback("coach-a", "org-a", invalid), /original authorised coach/);
  }
  assert.equal(a.calls.length, 3);
});

test("retained Session feedback remains session-specific and standalone overview entry points are removed", async () => {
  const retained = feedbackRow("retained", { kind: "session", session_id: null });
  const a = adapter({ userId: "coach-a", rpc: async name => ({ data: name === "read_coach_feedback" ? [retained] : "retained", error: null }) });
  const scope = { organizationId: "org-a", athleteId: "athlete-a" };
  const history = await a.api.readMobileFeedback("coach-a", scope);
  assert.equal(a.calls[0].args.p_kind, "session");
  assert.equal(a.calls[0].args.p_session_id, null);
  await a.api.saveMobileCoachFeedback("coach-a", scope, "Updated retained feedback", history.entries[0]);
  assert.equal(a.calls[1].args.p_feedback_id, "retained");
  assert.equal(a.calls[1].args.p_kind, "session");
  assert.equal(a.calls[1].args.p_session_id, null);
  assert.equal(a.calls[1].args.p_expected_updated_at, stamp);
  for (const path of ["../app/(tabs)/sessions.tsx", "../app/(tabs)/organization/[organizationId]/athletes/[userId].tsx"]) {
    const screen = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(screen, /MobileSessionFeedbackHistory/);
    assert.doesNotMatch(screen, /Add general feedback/);
  }
  for (const path of ["../app/sessions/[sessionId].tsx", "../app/(tabs)/organization/[organizationId]/athletes/[userId]/sessions/[sessionId].tsx"]) {
    const screen = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(screen, /MobileSessionNotes/);
    assert.match(screen, /MobileCoachFeedback[^\n]*sessionId=\{sessionId\}/);
  }
});

function uiRuntime(component = "MobileSessionNotes", props = { userId: "athlete-a", sessionId: "session-a" }, apiOverrides = {}) {
  const api = adapter().api;
  const slots = [], alerts = [], dispatches = [];
  let cursor = 0, effects = [], guard, mode = "light";
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { fn, deps }; return slots[index].fn; },
    useEffect(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn(); }); } },
  };
  const actions = [], jsx = (type, props) => ({ type, props });
  const service = { ...api, readMobileSessionNote: async () => core.mapSessionNote(noteRow()), readMobileFeedback: async () => ({ entries: [], next: null }), ...apiOverrides };
  const ui = load("../src/notes-feedback-ui.tsx", {
    react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "@arc-track/core/notes-feedback": core, "./notes-feedback": service,
    "./appearance": { useAppearance: () => ({ colors: getThemeColors(mode), coachColors: getCoachPalette(mode) }) },
    "expo-router": { useNavigation: () => ({ dispatch: action => dispatches.push(action) }), useFocusEffect: fn => { actions[0] = fn; hooks.useEffect(fn, [fn]); } },
    "expo-router/react-navigation": { usePreventRemove: (dirty, callback) => { guard = { dirty, callback }; } },
    "react-native": { ActivityIndicator: "Spinner", Alert: { alert: (...args) => alerts.push(args) }, Pressable: "Button", ScrollView: "Scroll", Text: "Text", TextInput: "Input", View: "View", StyleSheet: { create: value => value } },
  });
  function render() {
    cursor = 0; const tree = ui[component](props), nodes = [];
    function visit(node) { if (Array.isArray(node)) node.forEach(visit); else if (node?.props) { if (typeof node.type === "function") visit(node.type(node.props)); else { nodes.push(node); visit(node.props.children); } } }
    visit(tree); const pending = effects; effects = []; pending.forEach(fn => fn());
    const texts = nodes.filter(node => node.type === "Text").map(node => Array.isArray(node.props.children) ? node.props.children.join("") : node.props.children);
    return {
      nodes, texts, inputs: nodes.filter(node => node.type === "Input"),
      button(label) { const button = nodes.find(node => node.type === "Button" && node.props.children?.props?.children === label); assert.ok(button, `Button missing: ${label}`); return button.props; },
    };
  }
  return { render, service, alerts, dispatches, get guard() { return guard; }, focus() { actions[0](); }, async settle() { await new Promise(setImmediate); return render(); }, theme(value) { mode = value; }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}

test("note editor keeps failed/conflicting drafts, refresh preserves draft and explicit rebase uses latest token", async () => {
  let savedArgs;
  const ui = uiRuntime(undefined, undefined, { saveMobileSessionNote: async (...args) => { savedArgs = args; throw new Error(core.notesFeedbackError({ code: "40001" })); } });
  ui.render(); let view = await ui.settle();
  view.button("Edit notes").onPress(); view = ui.render(); view.inputs[0].props.onChangeText("Unsaved draft");
  view = ui.render(); assert.equal(ui.guard.dirty, true);
  view.button("Save notes").onPress(); view = await ui.settle();
  assert.equal(view.inputs[0].props.value, "Unsaved draft");
  assert.ok(view.texts.some(text => String(text).includes("another device")));
  const newer = "2026-10-22T10:00:00Z";
  ui.service.readMobileSessionNote = async () => core.mapSessionNote(noteRow("Website edit", newer));
  ui.focus(); view = await ui.settle();
  assert.equal(view.inputs[0].props.value, "Unsaved draft");
  assert.ok(view.texts.some(text => String(text).includes("Website edit")));
  view.button("Use latest version as edit baseline").onPress(); view = ui.render();
  view.button("Save notes").onPress(); await ui.settle();
  assert.equal(savedArgs.at(-1), newer);
});

test("note editor requires explicit save, cancel restores note, delete requires confirmation", async () => {
  const calls = [];
  const ui = uiRuntime(undefined, undefined, { saveMobileSessionNote: async (...args) => { calls.push(args); return core.mapSessionNote(noteRow(args[2])); }, deleteMobileSessionNote: async (...args) => calls.push(args) });
  ui.render(); let view = await ui.settle();
  view.button("Edit notes").onPress(); view = ui.render(); view.inputs[0].props.onChangeText("Draft");
  assert.equal(calls.length, 0);
  view = ui.render(); view.button("Cancel").onPress(); view = ui.render();
  assert.ok(view.texts.includes(noteRow().body)); assert.equal(ui.guard.dirty, false);
  view.button("Edit notes").onPress(); view = ui.render(); view.inputs[0].props.onChangeText("Saved mobile note");
  view = ui.render(); view.button("Save notes").onPress(); view = await ui.settle();
  assert.ok(view.texts.includes("Saved mobile note")); assert.equal(calls.length, 1);
  view.button("Delete notes").onPress(); assert.equal(calls.length, 1);
  await ui.alerts.at(-1)[2].find(button => button.text === "Delete").onPress(); view = await ui.settle();
  assert.ok(view.texts.includes("No Session Notes yet.")); assert.equal(calls.length, 2);
});

test("failed note load shows an unavailable error without fake empty note or editable form", async () => {
  const ui = uiRuntime(undefined, undefined, { readMobileSessionNote: async () => { throw new Error(core.notesFeedbackError({ code: "42P01" })); } });
  ui.render(); const view = await ui.settle();
  assert.ok(view.texts.some(text => String(text).includes("database update")));
  assert.equal(view.texts.includes("No Session Notes yet."), false);
  assert.equal(view.texts.includes("Add notes"), false);
  assert.equal(view.inputs.length, 0);
});

test("dirty editor guards native removal and focus refresh retains draft through theme changes", async () => {
  const ui = uiRuntime(); ui.render(); let view = await ui.settle();
  view.button("Edit notes").onPress(); view = ui.render(); view.inputs[0].props.onChangeText("Draft"); view = ui.render();
  ui.guard.callback({ data: { action: { type: "GO_BACK" } } });
  assert.equal(ui.dispatches.length, 0);
  ui.alerts.at(-1)[2].find(button => button.text === "Keep editing").onPress();
  ui.focus(); ui.theme("dark"); view = await ui.settle();
  assert.equal(view.inputs[0].props.value, "Draft");
  assert.equal(view.inputs[0].props.style[0].color, getThemeColors("dark").text);
  ui.guard.callback({ data: { action: { type: "GO_BACK" } } });
  ui.alerts.at(-1)[2].find(button => button.text === "Discard").onPress();
  assert.deepEqual(ui.dispatches, [{ type: "GO_BACK" }]);
});

test("unmounted Session scopes ignore late reads and saving prevents duplicate submissions", async () => {
  const pending = deferred(), saved = deferred(); let count = 0;
  const stale = uiRuntime(undefined, undefined, { readMobileSessionNote: () => pending.promise });
  stale.render(); stale.unmount(); pending.resolve(core.mapSessionNote(noteRow("Late old-session note"))); await stale.settle();
  assert.equal(stale.render().texts.includes("Late old-session note"), false);
  const ui = uiRuntime(undefined, undefined, { saveMobileSessionNote: async () => { count++; return saved.promise; } });
  ui.render(); let view = await ui.settle(); view.button("Edit notes").onPress(); view = ui.render();
  const save = view.button("Save notes").onPress; save(); save(); assert.equal(count, 1);
  saved.resolve(core.mapSessionNote(noteRow("Confirmed"))); view = await ui.settle();
  assert.ok(view.texts.includes("Confirmed"));
});

test("coach notes stay read only and feedback history labels retained identity/session context", async () => {
  const note = uiRuntime("MobileSessionNotes", { userId: "coach-a", sessionId: "session-a", coach: { organizationId: "org-a", athleteId: "athlete-a" } });
  note.render(); const noteView = await note.settle();
  assert.equal(noteView.inputs.length, 0); assert.equal(noteView.texts.includes("Edit notes"), false);
  const history = uiRuntime("MobileCoachFeedback", { userId: "athlete-a", sessionId: "session-a" }, { readMobileFeedback: async () => ({ entries: [core.mapCoachFeedback(feedbackRow("history", { author_user_id: null, author_display_name: null, organization_id: null, kind: "session", session_id: null, can_edit: false }))], next: null }) });
  history.render(); const view = await history.settle();
  assert.ok(view.texts.includes("Former coach"));
  assert.ok(view.texts.some(text => String(text).includes("deleted session") && String(text).includes("Organisation unavailable")));
  assert.equal(view.texts.includes("Edit feedback"), false);
});

test("feedback pagination preserves multiple entries, only original coach controls appear, and draft survives refresh", async () => {
  const pages = [], saved = [];
  const ui = uiRuntime("MobileCoachFeedback", { userId: "coach-a", organizationId: "org-a", athleteId: "athlete-a", sessionId: "session-a" }, {
    readMobileFeedback: async (...args) => { pages.push(args); return { entries: [core.mapCoachFeedback(feedbackRow(args[2] ? "older" : "newest"))], next: args[2] ? null : { createdAt: stamp, id: "newest" } }; },
    saveMobileCoachFeedback: async (...args) => { saved.push(args); throw new Error("Offline. Your draft has been kept."); },
  });
  ui.render(); let view = await ui.settle();
  view.button("Add session feedback").onPress(); view = ui.render(); view.inputs[0].props.onChangeText("Coach draft");
  ui.focus(); view = await ui.settle(); assert.equal(view.inputs[0].props.value, "Coach draft");
  view.button("Load older feedback").onPress(); view = await ui.settle();
  assert.equal(view.texts.filter(text => text === feedbackRow().body).length, 2);
  assert.deepEqual(pages.at(-1)[2], { createdAt: stamp, id: "newest" });
  view.button("Save feedback").onPress(); view = await ui.settle();
  assert.equal(view.inputs[0].props.value, "Coach draft"); assert.equal(saved.length, 1);
  assert.equal(saved[0][1].organizationId, "org-a");
});

test("coach feedback edit saves its original entry and confirmed delete removes athlete-visible history", async () => {
  let rows = [core.mapCoachFeedback(feedbackRow())];
  const saves = [], deletes = [];
  const ui = uiRuntime("MobileCoachFeedback", { userId: "coach-a", organizationId: "org-a", athleteId: "athlete-a", sessionId: "session-a" }, {
    readMobileFeedback: async () => ({ entries: rows, next: null }),
    saveMobileCoachFeedback: async (...args) => { saves.push(args); rows = [{ ...rows[0], body: args[2], updatedAt: "2026-10-22T10:00:00Z" }]; return rows[0].id; },
    deleteMobileCoachFeedback: async (...args) => { deletes.push(args); rows = []; },
  });
  ui.render(); let view = await ui.settle(); view.button("Edit feedback").onPress(); view = ui.render();
  view.inputs[0].props.onChangeText("Updated from mobile"); view = ui.render(); view.button("Save feedback").onPress(); view = await ui.settle();
  assert.equal(saves[0][3].id, "feedback-a"); assert.equal(saves[0][3].updatedAt, stamp);
  assert.equal(view.inputs.length, 0); assert.ok(view.texts.includes("Updated from mobile"));
  view.button("Delete feedback").onPress(); assert.equal(deletes.length, 0);
  assert.match(ui.alerts.at(-1)[1], /athlete will also lose access/);
  await ui.alerts.at(-1)[2].find(button => button.text === "Delete").onPress(); view = await ui.settle();
  assert.equal(deletes[0][2].id, "feedback-a");
  assert.ok(view.texts.includes("You have not shared feedback in this view yet."));
});

test("coach feedback conflict needs an explicit rebase and keeps the typed draft", async () => {
  let entry = core.mapCoachFeedback(feedbackRow()), savedTarget;
  const ui = uiRuntime("MobileCoachFeedback", { userId: "coach-a", organizationId: "org-a", athleteId: "athlete-a", sessionId: "session-a" }, {
    readMobileFeedback: async () => ({ entries: [entry], next: null }),
    saveMobileCoachFeedback: async (...args) => { savedTarget = args[3]; throw new Error(core.notesFeedbackError({ code: "40001" })); },
  });
  ui.render(); let view = await ui.settle(); view.button("Edit feedback").onPress(); view = ui.render(); view.inputs[0].props.onChangeText("Keep this draft");
  view = ui.render(); view.button("Save feedback").onPress(); view = await ui.settle();
  entry = { ...entry, body: "Saved on website", updatedAt: "2026-10-22T12:00:00Z" };
  view.button("Refresh saved feedback").onPress(); view = await ui.settle();
  assert.equal(view.inputs[0].props.value, "Keep this draft"); assert.equal(savedTarget.updatedAt, stamp);
  view.button("Use latest entry as edit baseline").onPress(); view = ui.render(); view.button("Save feedback").onPress(); await ui.settle();
  assert.equal(savedTarget.updatedAt, entry.updatedAt);
});

test("feedback UI requires a Session and can only create Session feedback", async () => {
  const reads = [], writes = [];
  const missing = uiRuntime("MobileCoachFeedback", { userId: "coach-a", organizationId: "org-a", athleteId: "athlete-a" }, {
    readMobileFeedback: async (...args) => { reads.push(args); return { entries: [], next: null }; },
  });
  missing.render(); let view = await missing.settle();
  assert.equal(reads.length, 1);
  assert.equal(reads[0][1].sessionId, undefined);
  reads.length = 0;
  assert.equal(view.texts.includes("Add session feedback"), false);
  const ui = uiRuntime("MobileCoachFeedback", { userId: "coach-a", organizationId: "org-a", athleteId: "athlete-a", sessionId: "session-a" }, {
    readMobileFeedback: async (...args) => { reads.push(args); return { entries: [], next: null }; },
    saveMobileCoachFeedback: async (...args) => { writes.push(args); return "new-session"; },
  });
  ui.render(); view = await ui.settle();
  assert.equal(reads[0][1].sessionId, "session-a");
  view.button("Add session feedback").onPress(); view = ui.render(); view.inputs[0].props.onChangeText("New session feedback");
  view = ui.render(); view.button("Save feedback").onPress(); await ui.settle();
  assert.equal(writes[0][1].sessionId, "session-a");
  assert.equal(writes[0][3], null);
});

test("mobile request UUID uses existing Expo native randomness and fails closed without a secure source", () => {
  const a = adapter();
  const previousExpo = Object.getOwnPropertyDescriptor(globalThis, "expo");
  try {
    Object.defineProperty(globalThis, "expo", { configurable: true, value: { uuidv4: () => requestId } });
    assert.equal(a.api.createMobileFeedbackRequestId(), requestId);
    Object.defineProperty(globalThis, "expo", { configurable: true, value: { uuidv4: () => "unsafe" } });
    assert.throws(() => a.api.createMobileFeedbackRequestId(), /secure feedback request could not be prepared/);
    Object.defineProperty(globalThis, "expo", { configurable: true, value: undefined });
    assert.throws(() => a.api.createMobileFeedbackRequestId(), /secure feedback request could not be prepared/);
  } finally {
    if (previousExpo) Object.defineProperty(globalThis, "expo", previousExpo); else delete globalThis.expo;
  }
  const android = readFileSync(new URL("../../../node_modules/expo-modules-core/android/src/main/java/expo/modules/kotlin/defaultmodules/CoreModule.kt", import.meta.url), "utf8");
  const ios = readFileSync(new URL("../../../node_modules/expo-modules-core/ios/Core/Modules/CoreModule.swift", import.meta.url), "utf8");
  assert.match(android, /Function\("uuidv4"\)[\s\S]*UUID\.randomUUID\(\)/);
  assert.match(ios, /Function\("uuidv4"\)[\s\S]*UUID\(\)\.uuidString\.lowercased\(\)/);
});

test("prepared mobile creation retry requires the identical author, athlete, organisation, session and canonical body", () => {
  const a = adapter(), scope = { organizationId: "org-a", athleteId: "athlete-a", sessionId: "session-a" };
  const first = a.api.prepareMobileFeedbackCreation("coach-a", scope, "  Original payload  ", null);
  assert.equal(a.api.prepareMobileFeedbackCreation("coach-a", scope, "Original payload", first), first);
  for (const [actor, context, body] of [
    ["coach-b", scope, "Original payload"], ["coach-a", { ...scope, organizationId: "org-b" }, "Original payload"],
    ["coach-a", { ...scope, athleteId: "athlete-b" }, "Original payload"], ["coach-a", { ...scope, sessionId: "session-b" }, "Original payload"],
    ["coach-a", { organizationId: "org-a", athleteId: "athlete-a" }, "Original payload"], ["coach-a", scope, "Altered payload"],
  ]) assert.throws(() => a.api.prepareMobileFeedbackCreation(actor, context, body, first), /earlier submission may already be saved|Open a Session/);
  const separate = a.api.prepareMobileFeedbackCreation("coach-a", scope, "Original payload", null);
  assert.notEqual(separate.requestId, first.requestId);
});

test("mobile adapter requires UUID identity for creation and keeps edits separate", async () => {
  const a = adapter({ userId: "coach-a" }), scope = { organizationId: "org-a", athleteId: "athlete-a", sessionId: "session-a" };
  await assert.rejects(a.api.saveMobileCoachFeedback("coach-a", scope, "Feedback", null), /Prepare a new feedback submission/);
  await assert.rejects(a.api.saveMobileCoachFeedback("coach-a", scope, "Feedback", null, "not-a-uuid"), /Prepare a new feedback submission/);
  await assert.rejects(a.api.saveMobileCoachFeedback("coach-a", scope, "Feedback", core.mapCoachFeedback(feedbackRow()), requestId), /edit cannot use a creation/);
  assert.equal(a.calls.length, 0);
});

test("lost feedback response commits one entry, focus retry keeps its key, and subsequent new entry gets a fresh key", async () => {
  const committed = new Map(); let loseFirstResponse = true;
  const a = adapter({ userId: "coach-a", rpc: async (name, args) => {
    if (name === "read_coach_feedback") return { data: [...committed.values()], error: null };
    assert.equal(name, "save_coach_feedback");
    if (!committed.has(args.p_creation_request_id)) committed.set(args.p_creation_request_id, feedbackRow(`entry-${committed.size + 1}`, { body: args.p_body }));
    if (loseFirstResponse) { loseFirstResponse = false; return { data: null, error: { code: "08006" } }; }
    return { data: committed.get(args.p_creation_request_id).id, error: null };
  } });
  const ui = uiRuntime("MobileCoachFeedback", { userId: "coach-a", organizationId: "org-a", athleteId: "athlete-a", sessionId: "session-a" }, { readMobileFeedback: a.api.readMobileFeedback, saveMobileCoachFeedback: a.api.saveMobileCoachFeedback });
  ui.render(); let view = await ui.settle(); view.button("Add session feedback").onPress(); view = ui.render(); view.inputs[0].props.onChangeText("Same legitimate text");
  view = ui.render(); view.button("Save feedback").onPress(); view = await ui.settle();
  assert.equal(committed.size, 1); assert.equal(view.inputs[0].props.value, "Same legitimate text");
  ui.focus(); view = await ui.settle(); assert.equal(view.inputs[0].props.value, "Same legitimate text");
  view.button("Save feedback").onPress(); view = await ui.settle();
  assert.equal(committed.size, 1); assert.equal(view.inputs.length, 0);
  view.button("Add session feedback").onPress(); view = ui.render(); view.inputs[0].props.onChangeText("Same legitimate text");
  view = ui.render(); view.button("Save feedback").onPress(); await ui.settle();
  assert.equal(committed.size, 2);
  const writes = a.calls.filter(call => call.name === "save_coach_feedback");
  assert.equal(writes[0].args.p_creation_request_id, writes[1].args.p_creation_request_id);
  assert.notEqual(writes[2].args.p_creation_request_id, writes[0].args.p_creation_request_id);
});

test("changing a possibly committed mobile draft cannot reuse its key; explicit cancel starts a separate attempt", async () => {
  const writes = [];
  const ui = uiRuntime("MobileCoachFeedback", { userId: "coach-a", organizationId: "org-a", athleteId: "athlete-a", sessionId: "session-a" }, {
    saveMobileCoachFeedback: async (...args) => { writes.push(args); throw new Error("Response unavailable. Your draft has been kept."); },
  });
  ui.render(); let view = await ui.settle(); view.button("Add session feedback").onPress(); view = ui.render(); view.inputs[0].props.onChangeText("Original payload");
  view = ui.render(); view.button("Save feedback").onPress(); view = await ui.settle();
  view.inputs[0].props.onChangeText("Changed payload"); view = ui.render(); view.button("Save feedback").onPress(); view = await ui.settle();
  assert.equal(writes.length, 1); assert.equal(view.inputs[0].props.value, "Changed payload");
  assert.ok(view.texts.some(text => String(text).includes("earlier submission may already be saved")));
  view.inputs[0].props.onChangeText("Original payload"); view = ui.render(); view.button("Save feedback").onPress(); view = await ui.settle();
  assert.equal(writes.length, 2); assert.equal(writes[0][4], writes[1][4]);
  view.button("Cancel").onPress(); assert.match(ui.alerts.at(-1)[1], /may already have saved feedback/);
  ui.alerts.at(-1)[2].find(button => button.text === "Cancel draft").onPress(); view = ui.render();
  view.button("Add session feedback").onPress(); view = ui.render(); view.inputs[0].props.onChangeText("Changed payload");
  view = ui.render(); view.button("Save feedback").onPress(); await ui.settle();
  assert.notEqual(writes[2][4], writes[0][4]);
});

test("mobile creation attempts are isolated across account, organisation, athlete and Session screen scopes", async () => {
  const writes = [], contexts = [
    { userId: "coach-a", organizationId: "org-a", athleteId: "athlete-a", sessionId: "session-a" },
    { userId: "coach-b", organizationId: "org-a", athleteId: "athlete-a", sessionId: "session-a" },
    { userId: "coach-a", organizationId: "org-b", athleteId: "athlete-a", sessionId: "session-a" },
    { userId: "coach-a", organizationId: "org-a", athleteId: "athlete-b", sessionId: "session-a" },
    { userId: "coach-a", organizationId: "org-a", athleteId: "athlete-a", sessionId: "session-b" },
  ];
  for (const context of contexts) {
    const ui = uiRuntime("MobileCoachFeedback", context, { saveMobileCoachFeedback: async (...args) => { writes.push(args); throw new Error("Uncertain response"); } });
    ui.render(); let view = await ui.settle(); view.button("Add session feedback").onPress(); view = ui.render(); view.inputs[0].props.onChangeText("Same text across isolated contexts");
    view = ui.render(); view.button("Save feedback").onPress(); view = await ui.settle();
    view.inputs[0].props.onChangeText(""); ui.render();
    assert.equal(ui.guard.dirty, true, "an uncertain attempt stays guarded even if its text is cleared");
    ui.unmount();
  }
  assert.equal(new Set(writes.map(args => args[4])).size, contexts.length);
  assert.deepEqual(writes.map(args => ({ userId: args[0], ...args[1] })), contexts);
});

test("mobile creation budget error is understandable, retains its draft/key and never exposes arbitrary database messages", async () => {
  const a = adapter({ userId: "coach-a", rpc: async () => ({ data: null, error: { code: "P0001", message: core.FEEDBACK_BUDGET_MESSAGE } }) });
  const ui = uiRuntime("MobileCoachFeedback", { userId: "coach-a", organizationId: "org-a", athleteId: "athlete-a", sessionId: "session-a" }, { saveMobileCoachFeedback: a.api.saveMobileCoachFeedback });
  ui.render(); let view = await ui.settle(); view.button("Add session feedback").onPress(); view = ui.render(); view.inputs[0].props.onChangeText("Keep this feedback draft");
  view = ui.render(); view.button("Save feedback").onPress(); view = await ui.settle();
  assert.ok(view.texts.includes("Too many feedback entries. Try again shortly."));
  assert.equal(view.inputs[0].props.value, "Keep this feedback draft");
  view.button("Save feedback").onPress(); await ui.settle();
  assert.equal(a.calls[0].args.p_creation_request_id, a.calls[1].args.p_creation_request_id);
  const unsafe = adapter({ userId: "coach-a", rpc: async () => ({ data: null, error: { code: "P0001", message: "internal SQL budget identity details" } }) });
  await assert.rejects(unsafe.api.saveMobileCoachFeedback("coach-a", { organizationId: "org-a", athleteId: "athlete-a", sessionId: "session-a" }, "Feedback", null, requestId), error => !error.message.includes("internal SQL"));
});

test("Session-only history has no standalone create control", async () => {
 const ui=uiRuntime("MobileCoachFeedback", {userId:"coach-a",organizationId:"org-a",athleteId:"athlete-a"}, {readMobileFeedback:async()=>({entries:[],next:null})});
 ui.render(); const view=await ui.settle(); assert.equal(view.texts.includes("Add session feedback"),false); assert.equal(view.texts.some(t=>String(t).includes("general feedback")),false);
});

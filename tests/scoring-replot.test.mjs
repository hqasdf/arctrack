import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import * as scoring from "@arc-track/core/scoring";
import * as nativeState from "../apps/mobile/src/scoring-state.ts";
import * as nativeQueue from "../apps/mobile/src/arrow-save-queue.ts";
import { WebArrowQueue } from "../src/features/sessions/web-arrow-queue.ts";
import { createArrowPersistence } from "@arc-track/core/arrow-persistence";

const require = createRequire(import.meta.url);
const scripts = {};
for (const [platform, path] of Object.entries({
  web: "../src/features/sessions/components/scoring-workspace.tsx",
  expo: "../apps/mobile/app/rounds/[roundId]/score.tsx",
})) {
  scripts[platform] = ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const roundTemplate = { id: "round", roundNumber: 1, name: "Practice", division: "Recurve", distanceMetres: 70,
  faceDiameterCm: 122, faceType: "full_face", ends: 2, arrowsPerEnd: 3, arrows: [] };
const plotted = (end, arrow) => ({ id: `saved-${end}-${arrow}`, end, arrow, score: "9", plot: { x: .15, y: 0 }, syncState: "saved" });

// Exercise the actual screen handlers with persistent hooks and mocked I/O. No browser or database writes.
async function screen(platform, initial = {}, save = async entry => ({ ...entry, id: `saved-${entry.end}-${entry.arrow}` }), options = {}) {
  let round = { ...roundTemplate, ...initial }, cursor = 0, tree;
  const hooks = [], effects = [], calls = [];
  let user = { id: "owner" }, unmounted = false, lateUpdates = 0;
  const reads = [];
  const persisted = new Map(round.arrows.map(a=>[scoring.arrowKey(a.end,a.arrow),{revision:"00000000-0000-0000-0000-000000000000",arrow:a}]));
  const readSlot=async slot=>structuredClone(persisted.get(scoring.arrowKey(slot.end,slot.arrow))??{revision:"00000000-0000-0000-0000-000000000000",arrow:null});
  const writeSlot=async(slot,desired,intent)=>{
    const key=scoring.arrowKey(slot.end,slot.arrow),current=await readSlot(slot);
    assert.equal(current.revision,intent.expectedRevision);
    const saved=desired?await write(desired):null;
    const snapshot={revision:intent.requestId,arrow:saved};persisted.set(key,snapshot);return structuredClone(snapshot);
  };
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = { ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], value => { if (unmounted) lateUpdates++; hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) hooks[index] = { deps, callback };
      return hooks[index].callback;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) { const previous = hooks[index]; hooks[index] = { deps }; effects.push(() => { previous?.cleanup?.(); hooks[index].cleanup = effect(); }); }
    },
  };
  async function write(entry) { calls.push(structuredClone(entry)); return save(entry); }
  const modules = name => {
    if (name === "react") return react;
    if (name === "react-native") return { ActivityIndicator: "Spinner", Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View", StyleSheet: { create: value => value } };
    if (name === "react-native-safe-area-context") return { SafeAreaProvider: "SafeAreaProvider", SafeAreaView: "SafeAreaView" };
    if (name === "expo-router") return { useLocalSearchParams: () => ({ roundId: round.id }) };
    if (name === "../scoring-model" || name === "@arc-track/core/scoring") return scoring;
    if (name === "../web-arrow-queue") return { WebArrowQueue };
    if (name === "@arc-track/core/arrow-persistence") return {createArrowPersistence};
    if (name.endsWith("/scoring-state")) return nativeState;
    if (name.endsWith("/arrow-save-queue")) return nativeQueue;
    if (name.endsWith("/auth")) return { useAuth: () => ({ user }) };
    if (name.endsWith("/sessions")) return { readOwnRound: async (owner, id) => { reads.push([owner, id]); return options.read ? options.read(owner, id) : { session: { id: "session", title: "Practice", date: "2026-10-17" }, round }; } };
    if (name.endsWith("/arrow-writes")) return { readRoundEndIds: async () => new Map(Array.from({ length: round.ends }, (_, i) => [i + 1, `end-${i + 1}`])),
      createMobileArrowPersistence:initial=>createArrowPersistence({initial,read:readSlot,write:writeSlot,requestId:()=>crypto.randomUUID()}) };
    if (name.endsWith("/actions")) return { removeArrow: async () => ({ ok: true }) };
    if (name.endsWith("/target-face")) return { TargetFace: "Target" };
    if (name.endsWith("/native-target")) return { NativeTarget: "Target" };
    if (name.endsWith("/session-insights") || name.endsWith("/round-insights")) return { RoundInsights: "Insights", RoundGroupPosition: "GroupPosition" };
    if (name.endsWith("/grouping-export")) return { GroupingExportButton: "Export" };
    if (name.endsWith("/session-weather")) return { ScoringWeather: "Weather" };
    if (name.endsWith("/icons")) return { ArcIcon: "Icon" };
    if (name.endsWith("/round-update-model")) return { canConfigureRound: () => false };
    if (name.endsWith("/recent-round-configs")) return { RecentRoundConfigs: "RecentRoundConfigs" };
    if (name.endsWith("/writes")) return { roundUpdateEnabled: false };
    if (name.endsWith("/appearance")) return { useAppearance: () => ({ colors: {} }), createThemedStyles: factory => () => factory({}) };
    if (name.endsWith("/theme")) return { colors: {}, PAGE_TOP_SPACING: 0 };
    if (name === "@arc-track/core/analytics") return { targetFaceLabel: () => "Full face" };
    if (name === "@arc-track/core/presets") return { DIVISIONS: ["Recurve"] };
    if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, name) => name }) };
    return require(name);
  };
  const loaded = { exports: {} };
  const fetch = async (_url, options) => {
    if(!options?.body){const query=new URL(_url,"https://arc.example").searchParams;return {ok:true,json:async()=>({ok:true,snapshot:await readSlot({end:Number(query.get("end")),arrow:Number(query.get("arrow"))})})};}
    const input = JSON.parse(options.body);
    if(input.intent){try{return {ok:true,json:async()=>({ok:true,snapshot:await writeSlot({end:input.endNumber,arrow:input.arrowNumber},input.deleted?null:{id:"pending",end:input.endNumber,arrow:input.arrowNumber,score:input.score,plot:input.plot},input.intent)})};}catch{return {ok:false,json:async()=>({ok:false})};}}
    try { return { ok: true, json: async () => ({ ok: true, data: await write({ id: scoring.arrowKey(input.endNumber, input.arrowNumber), end: input.endNumber, arrow: input.arrowNumber, score: input.score, plot: input.plot }) }) }; }
    catch { return { ok: false, json: async () => ({ ok: false, message: "Offline" }) }; }
  };
  new Function("require", "module", "exports", "fetch", scripts[platform])(modules, loaded, loaded.exports, fetch);
  function render() {
    cursor = 0;
    tree = platform === "web" ? loaded.exports.ScoringWorkspace({ sessionId: "session", sessionTitle: "Practice", sessionDate: "2026-10-17", round,
      onChange: update => { round = update(round); }, onBack() {}, onConfigure() {} }) : loaded.exports.default();
    while (effects.length) effects.shift()();
    return tree;
  }
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(item => nodes(item));
    return [node, ...nodes(node.props?.children)];
  }
  const target = () => { render(); return nodes(tree).find(node => node.type === "Target").props; };
  function text(node) { return Array.isArray(node) ? node.map(text).join("") : typeof node === "object" && node ? text(node.props?.children) : String(node ?? ""); }
  function press(label) {
    render();
    const node = nodes(tree).find(node => (node.props?.onClick || node.props?.onPress) && ((node.props?.[platform === "web" ? "aria-label" : "accessibilityLabel"] ?? "").startsWith(label) || text(node.props.children) === label));
    assert.ok(node, `Missing ${platform} control: ${label}`);
    (node.props.onClick ?? node.props.onPress)();
  }
  render(); await tick(); render();
  return { target, press, calls, reads, refreshToken() { user = { ...user }; render(); },
    changeUser(next) { user = next; render(); }, changeRound(next) { round = { ...roundTemplate, ...next }; render(); },
    unmount() { hooks.forEach(hook => hook?.cleanup?.()); unmounted = true; }, lateUpdates: () => lateUpdates,
    settle: async () => { await tick(); await tick(); render(); } };
}

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
test('Expo same-account token refresh preserves pending per-slot saves and the latest repeated correction', async () => {
  const gate = deferred(); let count = 0;
  const ui = await screen('expo', {}, async entry => { if (++count === 1) await gate.promise; return { ...entry, id: 'saved' }; });
  ui.target().onPlot({ x: .15, y: 0 }); await ui.settle();
  ui.refreshToken(); assert.equal(ui.reads.length, 1); assert.equal(ui.target().arrows.length, 1);
  ui.press('End 1, Arrow 1,'); ui.target().onPlot({ x: .05, y: 0 });
  ui.press('End 1, Arrow 1,'); ui.target().onPlot({ x: .01, y: 0 });
  assert.equal(ui.calls.length, 1, 'corrections serialize behind the first save');
  gate.resolve(); await ui.settle();
  assert.equal(ui.calls.length, 3); assert.equal(ui.target().arrows[0].plot.x, .01); assert.equal(ui.target().arrows[0].syncState, 'saved');
});
test('Expo different-slot responses may finish out of order without replacing newer local plots', async () => {
  const gate = deferred(); const ui = await screen('expo', {}, async entry => { if (entry.arrow === 1) await gate.promise; return { ...entry, id: 'saved-' + entry.arrow }; });
  ui.target().onPlot({ x: .1, y: 0 }); ui.target().onPlot({ x: .2, y: 0 }); await ui.settle();
  assert.equal(ui.target().arrows[1].syncState, 'saved'); gate.resolve(); await ui.settle();
  assert.deepEqual(ui.target().arrows.map(a => a.plot.x), [.1, .2]);
});
test('Expo stale Round loads cannot replace the newly selected Round', async () => {
  const old = deferred(), fresh = deferred();
  const result = id => ({ session: { id: 'session', date: '2026-10-25' }, round: { ...roundTemplate, id, arrows: [plotted(1, id === 'new' ? 2 : 1)] } });
  const ui = await screen('expo', {}, undefined, { read: (_owner, id) => id === 'new' ? fresh.promise : old.promise });
  ui.changeRound({ id: 'new' }); fresh.resolve(result('new')); await ui.settle();
  assert.equal(ui.target().arrows[0].arrow, 2); old.resolve(result('round')); await ui.settle(); assert.equal(ui.target().arrows[0].arrow, 2);
});
test('Expo unmount drains the existing save chain without updating a retired screen', async () => {
  const gate = deferred(); const ui = await screen('expo', {}, async entry => { await gate.promise; return { ...entry, id: 'saved' }; });
  ui.target().onPlot({ x: .1, y: 0 }); await ui.settle(); ui.unmount(); gate.resolve(); await tick(); await tick();
  assert.equal(ui.lateUpdates(), 0); assert.equal(ui.calls.length, 1);
});
test('Expo logout and account switching invalidate late save results and load by the new owner', async () => {
  const gate = deferred(); const ui = await screen('expo', {}, async entry => { await gate.promise; return { ...entry, id: 'old-owner-save' }; });
  ui.target().onPlot({ x: .1, y: 0 }); await ui.settle();
  ui.changeUser(null); await ui.settle(); ui.changeUser({ id: 'other-owner' }); await ui.settle();
  gate.resolve(); await ui.settle(); assert.deepEqual(ui.reads.at(-1), ['other-owner', 'round']);
  assert.equal(ui.target().arrows.some(a => a.id === 'old-owner-save'), false);
});

for (const platform of ["web", "expo"]) {
  test(`${platform}: sequential plotting, final save, repeated completion taps and one-shot explicit replot`, async () => {
    const ui = await screen(platform);
    for (let i = 0; i < 6; i++) {
      ui.target().onPlot({ x: .15, y: 0 });
      assert.equal(ui.target().arrows.length, i + 1);
      assert.ok(ui.target().arrows.some(item => item.end === Math.floor(i / 3) + 1 && item.arrow === i % 3 + 1));
      assert.equal(ui.target().selectedId, null);
    }
    await ui.settle();
    assert.equal(ui.calls.length, 6);
    assert.equal(scoring.roundTotal(ui.target().arrows), 54);
    const complete = structuredClone(ui.target().arrows);
    for (let i = 0; i < 3; i++) ui.target().onPlot({ x: .9, y: 0 });
    await ui.settle();
    assert.deepEqual(ui.target().arrows, complete);
    assert.equal(ui.calls.length, 6);
    for (const [end, arrow] of [[1, 1], [1, 2], [2, 3]]) {
      const before = structuredClone(ui.target().arrows);
      ui.press(`End ${end}, Arrow ${arrow}${platform === "web" ? ":" : ","}`);
      const selected = ui.target();
      assert.equal(selected.selectedId, before.find(item => item.end === end && item.arrow === arrow).id);
      selected.onPlot({ x: .01, y: 0 });
      selected.onPlot({ x: .9, y: 0 }); // Same handler before the next render must not reuse the edit permission.
      await ui.settle();
      assert.equal(ui.target().selectedId, null);
      for (const item of ui.target().arrows) {
        if (item.end === end && item.arrow === arrow) { assert.equal(item.score, "X"); assert.deepEqual(item.plot, { x: .01, y: 0 }); }
        else assert.deepEqual(item, before.find(old => old.end === item.end && old.arrow === item.arrow));
      }
    }
    assert.equal(ui.calls.length, 9);
    assert.equal(scoring.roundTotal(ui.target().arrows), 57);
  });

  test(`${platform}: reopening and End navigation never authorize editing an occupied slot`, async () => {
    const ui = await screen(platform, { arrows: [plotted(1, 1), plotted(1, 2), plotted(1, 3), plotted(2, 1), plotted(2, 2), plotted(2, 3)] });
    assert.equal(ui.target().selectedId, null);
    ui.target().onPlot({ x: .8, y: 0 });
    ui.press("End 2, Arrow 3");
    assert.ok(ui.target().selectedId);
    ui.press("Previous");
    assert.equal(ui.target().currentEnd, 1);
    assert.equal(ui.target().selectedId, null);
    ui.target().onPlot({ x: .8, y: 0 });
    ui.press("End 1, Arrow 2");
    ui.press("Next");
    assert.equal(ui.target().currentEnd, 2);
    assert.equal(ui.target().selectedId, null);
    ui.target().onPlot({ x: .8, y: 0 });
    await ui.settle();
    assert.equal(ui.calls.length, 0);
  });

  test(`${platform}: failed replot stays visible and requires reselection for another move`, async () => {
    let fail = true;
    const ui = await screen(platform, { ends: 1, arrowsPerEnd: 1, arrows: [plotted(1, 1)] }, async entry => { if (fail) throw new Error("Offline"); return entry; });
    ui.press("End 1, Arrow 1");
    ui.target().onPlot({ x: .01, y: 0 });
    await ui.settle();
    assert.equal(ui.target().selectedId, null);
    assert.equal(ui.target().arrows[0].syncState, "failed");
    assert.deepEqual(ui.target().arrows[0].plot, { x: .01, y: 0 });
    ui.target().onPlot({ x: .8, y: 0 });
    await ui.settle();
    assert.equal(ui.calls.length, 1);
    ui.press("End 1, Arrow 1");
    assert.ok(ui.target().selectedId);
    fail = false;
    ui.press("Retry save");
    await ui.settle();
    assert.equal(ui.target().arrows[0].syncState, "saved");
    assert.deepEqual(ui.target().arrows[0].plot, { x: .01, y: 0 });
  });

  test(`${platform}: a pending final save cannot reuse implicit or consumed edit selection`, async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const ui = await screen(platform, { ends: 1, arrowsPerEnd: 1 }, async entry => {
      await pending;
      return { ...entry, id: "saved-1-1" };
    });
    ui.target().onPlot({ x: .15, y: 0 });
    await ui.settle();
    ui.target().onPlot({ x: .8, y: 0 });
    assert.equal(ui.target().selectedId, null);
    assert.equal(ui.calls.length, 1);
    ui.press("End 1, Arrow 1");
    const selected = ui.target();
    selected.onPlot({ x: .01, y: 0 });
    selected.onPlot({ x: .8, y: 0 });
    assert.equal(ui.target().selectedId, null);
    release();
    await ui.settle();
    assert.equal(ui.calls.length, 2);
    assert.deepEqual(ui.target().arrows[0].plot, { x: .01, y: 0 });
    assert.equal(ui.target().arrows[0].syncState, "saved");
  });
}

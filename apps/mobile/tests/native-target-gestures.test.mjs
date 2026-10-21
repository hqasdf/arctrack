import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as insights from "@arc-track/core/insights";
import * as scoring from "@arc-track/core/scoring";
import * as geometry from "../src/native-target-geometry.ts";
import * as scoringState from "../src/scoring-state.ts";

function load(path, dependencies, getPalette = () => ({})) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    if (name.endsWith("/appearance")) return { useAppearance: () => ({ colors: getPalette() }), createThemedStyles: factory => () => factory(getPalette()) };
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

function hooks() {
  const slots = [];
  let cursor = 0, pending = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return {
    react: {
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useCallback(callback, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
      useMemo: callback => callback(),
      useEffect(callback, deps) {
        const index = cursor++;
        if (!same(slots[index]?.deps, deps)) {
          const previous = slots[index]; slots[index] = { deps };
          pending.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback(); });
        }
      },
    },
    render(component) { cursor = 0; const tree = component(); const effects = pending; pending = []; effects.forEach(effect => effect()); return tree; },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

function nodes(node) { return !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }
const point = (x, y, identifier = 0) => ({ locationX: x, locationY: y, identifier });
const event = (touches, changedTouches = touches) => ({ nativeEvent: { touches, changedTouches, ...(changedTouches[0] ?? point(160, 160)) } });
const native = { View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", Modal: "Modal", TextInput: "TextInput", ActivityIndicator: "Spinner", StyleSheet: { create: value => value, absoluteFill: {} } };

// Real target and real scoring-page callback, mocked native scrolling only.
// These assertions verify event/command ordering, not Android/iOS touch physics.
async function runtime(faceType = "full_face") {
  let palette = { background: "#fbfaf8", accent: "#73513d", onPrimary: "#ffffff" };
  const io = { roundReads: 0, endReads: 0, saves: [], deletes: 0 };
  const pageHooks = hooks();
  const round = { id: "round", name: "Practice", roundNumber: 1, division: "Recurve", distanceMetres: 70, faceDiameterCm: 122, faceType, ends: 1, arrowsPerEnd: 3, arrows: [] };
  const user = { id: "owner" };
  const page = load("../app/rounds/[roundId]/score.tsx", {
    react: pageHooks.react, "react-native": native,
    "react-native-safe-area-context": { SafeAreaProvider: "SafeAreaProvider", SafeAreaView: "SafeAreaView" },
    "expo-router": { useLocalSearchParams: () => ({ roundId: "round" }) },
    "@arc-track/core/analytics": { targetFaceLabel: () => "Target" }, "@arc-track/core/presets": { DIVISIONS: ["Recurve"] }, "@arc-track/core/scoring": scoring,
    "../../../src/auth": { useAuth: () => ({ user }) }, "../../../src/scoring-state": scoringState,
    "../../../src/sessions": { readOwnRound: async () => { io.roundReads++; return { session: { id: "session", title: "Practice", date: "2026-10-20" }, round }; } },
    "../../../src/arrow-writes": { readRoundEndIds: async () => { io.endReads++; return new Map([[1, "end"]]); }, saveArrowRecord: async entry => { io.saves.push(structuredClone(entry)); return "saved"; }, deleteArrowRecord: async () => { io.deletes++; } },
    "../../../src/icons": { ArcIcon: "Icon" }, "../../../src/grouping-export": { GroupingExportButton: "Export" }, "../../../src/session-weather": { ScoringWeather: "Weather" },
    "../../../src/native-target": { NativeTarget: "Target" }, "../../../src/round-insights": { RoundInsights: "Insights", RoundGroupPosition: "GroupPosition" },
    "../../../src/round-update-model": { canConfigureRound: () => false }, "../../../src/writes": { roundUpdateEnabled: false }, "../../../src/theme": { colors: {}, PAGE_TOP_SPACING: 0 },
  }, () => palette);
  const renderPage = () => pageHooks.render(() => page.default());
  renderPage(); await new Promise(setImmediate);
  const pageTree = renderPage();
  assert.equal(pageTree.type, "ScrollView");
  let enabled = true, offset = 0, appListener;
  const commands = [], plots = [];
  pageTree.props.ref.current = {
    setNativeProps(props) { commands.push(["props", props]); if (props.scrollEnabled !== undefined) enabled = props.scrollEnabled; },
    scrollTo(props) { commands.push(["scrollTo", props]); offset = props.y; },
  };
  const targetProps = nodes(pageTree).find(node => node.type === "Target").props;
  const targetHooks = hooks();
  const target = load("../src/native-target.tsx", {
    react: targetHooks.react, "react-native": { ...native, AppState: { addEventListener: (_name, listener) => { appListener = listener; return { remove() { appListener = null; } }; } } },
    "react-native-svg": { __esModule: true, default: "Svg", Circle: "Circle", G: "G", Polygon: "Polygon" },
    "@arc-track/core/insights": insights, "./native-target-geometry": geometry,
  });
  const render = () => targetHooks.render(() => target.NativeTarget({ ...targetProps, onPlot: plot => plots.push(plot) }));
  const surface = () => nodes(render()).find(node => node.props?.accessibilityLabel === "Scoring target").props;
  return {
    commands, plots, renderPage, render, surface, io,
    setPalette(next) { palette = next; },
    enabled: () => enabled, offset: () => offset,
    scroll(y) { if (enabled) { offset = y; pageTree.props.onScroll(eventWithOffset(y)); } },
    start(touches) { const e = event(touches); const props = surface(); props.onStartShouldSetResponderCapture?.(e); props.onResponderGrant(e); props.onTouchStart?.(e); },
    addFinger(touches) { const e = event(touches); const props = surface(); props.onStartShouldSetResponderCapture?.(e); props.onTouchStart?.(e); props.onResponderStart?.(e); },
    move(touches) { const e = event(touches); const props = surface(); (props.onTouchMove ?? props.onResponderMove)?.(e); },
    end(touches = [], changed = [point(160, 160)]) { const e = event(touches, changed); if (!touches.length) surface().onResponderRelease(e); surface().onTouchEnd?.(e); },
    background() { appListener("background"); },
    dispose() { targetHooks.dispose(); pageHooks.dispose(); },
    size() { return nodes(render()).find(node => node.type === "Svg").props; },
  };
}
function eventWithOffset(y) { return { nativeEvent: { contentOffset: { x: 0, y } } }; }

test("single target taps still plot; single-finger swipes yield to page scrolling", async () => {
  const r = await runtime();
  try {
    r.start([point(160, 160)]); r.end();
    assert.deepEqual(r.plots, [{ x: 0, y: 0 }]);
    r.start([point(160, 160)]); r.move([point(160, 190)]);
    assert.equal(r.surface().onResponderTerminationRequest(event([point(160, 190)])), true);
    r.surface().onResponderTerminate();
    r.scroll(90); assert.equal(r.offset(), 90); assert.equal(r.enabled(), true);
    assert.equal(r.plots.length, 1);
  } finally { r.dispose(); }
});

test("second touch locks native scrolling immediately and stops momentum at the current offset", async () => {
  const r = await runtime();
  try {
    r.scroll(240);
    r.start([point(120, 160)]);
    r.addFinger([point(120, 160), point(200, 160, 1)]);
    assert.equal(r.enabled(), false, "Lock must not wait for a React render");
    assert.deepEqual(r.commands.slice(0, 2), [["props", { scrollEnabled: false }], ["scrollTo", { x: 0, y: 240, animated: false }]]);
    assert.equal(r.surface().onResponderTerminationRequest(event([point(120, 160), point(200, 160, 1)])), false);
    for (let i = 0; i < 6; i++) { r.move([point(110 - i, 180 + i), point(210 + i, 180 + i, 1)]); r.scroll(300 + i); }
    assert.equal(r.offset(), 240);
    r.renderPage(); assert.equal(r.enabled(), false);
    assert.equal(r.commands.length, 2, "Pinch updates must not repeatedly write parent scroll props");
    r.end();
    assert.equal(r.enabled(), true); assert.equal(r.offset(), 240); assert.equal(r.plots.length, 0);
    r.scroll(310); assert.equal(r.offset(), 310);
  } finally { r.dispose(); }
});

test("two fingers moving vertically pan only the target and keep its focal-point mapping", async () => {
  const r = await runtime();
  try {
    r.scroll(175);
    const pair = [point(100, 110), point(160, 110, 1)];
    r.start([pair[0]]);
    const props = r.surface();
    assert.equal(props.onStartShouldSetResponderCapture(event(pair)), true);
    assert.equal(r.enabled(), false, "Capture must lock before any render or move");
    props.onTouchStart(event(pair));
    r.move([point(100, 150), point(160, 150, 1)]);
    r.scroll(240);
    assert.equal(r.offset(), 175);
    const matrix = nodes(r.render()).find(node => node.type === "G" && node.props.transform?.startsWith("matrix")).props.transform;
    const values = matrix.slice(7, -1).split(" ").map(Number);
    assert.equal(values[0], 1);
    assert.equal(values[5], 40 * geometry.targetViews.full_face.height / r.size().height);
    r.end();
    r.start([point(130, 150)]); r.end([], [point(130, 150)]);
    assert.deepEqual(r.plots, [geometry.plotFromNativeTouch(130, 110, 320, 320, "full_face")]);
  } finally { r.dispose(); }
});

test("a replacement second finger rebases the pinch without releasing page ownership", async () => {
  const r = await runtime();
  try {
    r.start([point(120, 160), point(200, 160, 1)]);
    r.move([point(80, 160), point(240, 160, 1)]);
    r.end([point(80, 160)], [point(240, 160, 1)]);
    r.addFinger([point(80, 160), point(200, 160, 2)]);
    r.move([point(50, 160), point(230, 160, 2)]);
    const matrix = nodes(r.render()).find(node => node.type === "G" && node.props.transform?.startsWith("matrix")).props.transform;
    assert.equal(Number(matrix.match(/matrix\(([^ ]+)/)[1]), 3);
    assert.equal(r.enabled(), false);
    assert.equal(r.commands.length, 2);
    r.end();
    assert.equal(r.enabled(), true); assert.equal(r.plots.length, 0);
  } finally { r.dispose(); }
});

for (const lifted of [0, 1]) test(`lifting finger ${lifted} keeps the whole multi-touch sequence locked until all touches finish`, async () => {
  const r = await runtime();
  try {
    const touches = [point(120, 160), point(200, 160, 1)];
    r.start(touches);
    r.end([touches[1 - lifted]], [touches[lifted]]);
    r.move([point(180, 210, 1 - lifted)]); r.scroll(200);
    assert.equal(r.enabled(), false); assert.equal(r.offset(), 0); assert.equal(r.plots.length, 0);
    r.end([], [point(180, 210, 1 - lifted)]);
    assert.equal(r.enabled(), true); assert.equal(r.plots.length, 0);
    r.start([point(160, 160)]); r.end(); assert.equal(r.plots.length, 1);
  } finally { r.dispose(); }
});

test("cancel, forced responder termination, backgrounding and unmount always release the scroll lock without plotting", async () => {
  for (const cancel of [r => r.surface().onTouchCancel(event([])), r => r.surface().onResponderTerminate(), r => r.background(), r => r.dispose()]) {
    const r = await runtime();
    r.start([point(120, 160), point(200, 160, 1)]);
    assert.equal(r.enabled(), false);
    cancel(r);
    assert.equal(r.enabled(), true); assert.equal(r.plots.length, 0);
    r.end(); assert.equal(r.plots.length, 0);
    r.dispose();
  }
});

for (const face of ["full_face", "six_ring", "triple_face"]) test(`${face}: repeated pinches preserve zoom limits, anchor coordinates and later scoring`, async () => {
  const r = await runtime(face);
  try {
    const { width, height } = r.size();
    const centre = { x: width / 2, y: face === "triple_face" ? height * 58 / 336 : height / 2 };
    const pair = distance => [point(centre.x - distance / 2, centre.y), point(centre.x + distance / 2, centre.y, 1)];
    for (const [ratio, expectedScale] of [[2, 2], [3, 4], [.1, 1], [2, 2]]) {
      r.start(pair(20)); r.move(pair(20 * ratio)); r.end();
      assert.equal(r.enabled(), true);
      const transform = nodes(r.render()).find(node => node.type === "G" && node.props.transform?.startsWith("matrix")).props.transform;
      assert.equal(Number(transform.match(/matrix\(([^ ]+)/)[1]), expectedScale);
    }
    const matrix = nodes(r.render()).find(node => node.type === "G" && node.props.transform?.startsWith("matrix")).props.transform;
    const scale = Number(matrix.match(/matrix\(([^ ]+)/)[1]);
    assert.equal(scale, 2);
    r.start([point(centre.x, centre.y)]); r.end([], [point(centre.x, centre.y)]);
    const plot = r.plots.at(-1);
    assert.ok(Math.abs(plot.x) < 1e-12 && Math.abs(plot.y) < 1e-12);
    if (face === "triple_face") assert.equal(plot.faceIndex, 0);
    assert.equal(r.plots.length, 1, "Multi-touch must never place an Arrow");
  } finally { r.dispose(); }
});


test("theme changes preserve active scoring positions, values, current slot and explicit edit selection without data IO", async () => {
  const r = await runtime();
  const target = tree => nodes(tree).find(node => node.type === "Target").props;
  const current = tree => nodes(tree).find(node => node.type === "Text" && Array.isArray(node.props?.children) && node.props.children[0] === "End " && node.props.children[2] === " · Arrow ").props.children;
  const arrowButton = tree => nodes(tree).find(node => node.props?.accessibilityLabel === "Arrow 1, 10X");
  try {
    target(r.renderPage()).onPlot({ x: 0, y: 0 });
    await new Promise(setImmediate);
    let before = r.renderPage();
    assert.deepEqual(current(before), ["End ", 1, " · Arrow ", 2]);
    assert.equal(target(before).arrows[0].score, "X");
    const recorded = structuredClone(target(before).arrows);
    const io = structuredClone(r.io);
    r.setPalette({ background: "#191714", accent: "#e2bc9c", onPrimary: "#261c14" });
    let after = r.renderPage();
    await new Promise(setImmediate);
    assert.equal(after.props.style.backgroundColor, "#191714");
    assert.deepEqual(target(after).arrows, recorded);
    assert.deepEqual(current(after), current(before));
    assert.deepEqual(r.io, io);

    arrowButton(after).props.onPress();
    before = r.renderPage();
    assert.deepEqual(current(before), ["End ", 1, " · Arrow ", 1]);
    assert.equal(target(before).selectedId, recorded[0].id);
    assert.equal(arrowButton(before).props.accessibilityState.selected, true);
    r.setPalette({ background: "#fbfaf8", accent: "#73513d", onPrimary: "#ffffff" });
    after = r.renderPage();
    await new Promise(setImmediate);
    assert.equal(after.props.style.backgroundColor, "#fbfaf8");
    assert.deepEqual(target(after).arrows, recorded);
    assert.deepEqual(current(after), current(before));
    assert.equal(target(after).selectedId, recorded[0].id);
    assert.equal(arrowButton(after).props.accessibilityState.selected, true);
    assert.deepEqual(r.io, io);
  } finally { r.dispose(); }
});

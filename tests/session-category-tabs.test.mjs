import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import * as scoring from "@arc-track/core/scoring";
import * as presets from "@arc-track/core/presets";
import { newestRoundsFirst } from "@arc-track/core/round-order";

const require = createRequire(import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : String(node ?? "");
async function load(path, mocks = {}) {
  let cursor = 0;
  const hooks = [], effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = { ...React,
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial; return [hooks[index], value => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }]; },
    useRef(initial) { return hooks[cursor++] ??= { current: initial }; },
    useId() { return react.useRef("session-tabs").current; },
    useMemo(fn, deps) { const index = cursor++; if (!hooks[index] || !same(hooks[index].deps, deps)) hooks[index] = { deps, value: fn() }; return hooks[index].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const index = cursor++; if (!hooks[index] || !same(hooks[index].deps, deps)) { hooks[index] = { deps }; effects.push(fn); } },
  };
  const script = ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} };
  const imports = name => name === "react" ? react : mocks[name] ?? (name.includes("notes-feedback") ? { SessionNotesPanel: () => null, CoachFeedbackPanel: () => null, AthleteFeedbackHistory: () => null, confirmDraftNavigation: () => true } : name === "expo-router" ? { useFocusEffect: fn => react.useEffect(fn, [fn]) } : name.endsWith(".css") ? { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) } : require(name));
  new Function("require", "module", "exports", "getComputedStyle", script)(imports, compiled, compiled.exports, node => ({ overflowX: node.overflowX ?? "visible" }));
  return { exports: compiled.exports, render(fn) { cursor = 0; const tree = fn(compiled.exports); while (effects.length) effects.shift()(); return tree; } };
}

test("web tabs switch by click and keyboard, keep both panels mounted, and consume only deliberate safe horizontal swipes", async () => {
  const ui = await load("../src/features/sessions/components/session-category-tabs.tsx");
  let category = "training", focused = -1;
  const training = React.createElement("input", { defaultValue: "draft" }), competition = React.createElement("p", null, "Competition record");
  const render = () => ui.render(({ SessionCategoryTabs }) => SessionCategoryTabs({ category, onCategoryChange: value => { category = value; }, training, competition, toolbar: "New Session" }));
  const tabs = () => nodes(render()).filter(node => node.props?.role === "tab");
  const panels = () => nodes(render()).filter(node => node.props?.role === "tabpanel");
  assert.equal(tabs()[0].props["aria-selected"], true);
  tabs()[1].props.onClick(); assert.equal(panels()[1].props.hidden, false); assert.equal(panels()[0].props.children, training);
  tabs()[0].props.onClick(); assert.equal(panels()[0].props.hidden, false);
  const list = nodes(render()).find(node => node.props?.role === "tablist");
  let prevented = false;
  list.props.onKeyDown({ key: "ArrowRight", preventDefault() { prevented = true; }, currentTarget: { querySelectorAll: () => [0, 1].map(i => ({ focus() { focused = i; } })) } });
  assert.equal(category, "competition"); assert.equal(focused, 1); assert.equal(prevented, true);
  function swipe(dx, dy = 0, target = { closest: () => null }) {
    const area = nodes(render()).find(node => node.props?.onTouchStart).props;
    area.onTouchStart({ target, currentTarget: {}, touches: [{ clientX: 100, clientY: 100 }] });
    area.onTouchMove({ touches: [{ clientX: 100 + dx, clientY: 100 + dy }] });
    area.onTouchEnd({ changedTouches: [{ clientX: 100 + dx, clientY: 100 + dy }] });
  }
  swipe(80); assert.equal(category, "training");
  swipe(-80); assert.equal(category, "competition");
  swipe(3, 80); assert.equal(category, "competition");
  swipe(20); assert.equal(category, "competition");
  swipe(80, 0, { closest: () => ({ tagName: "BUTTON" }) }); assert.equal(category, "competition");
  swipe(80, 0, { closest: () => null, scrollWidth: 300, clientWidth: 100, overflowX: "auto" }); assert.equal(category, "competition");
  const area = nodes(render()).find(node => node.props?.onTouchStart).props;
  area.onTouchStart({ target: { closest: () => null }, currentTarget: {}, touches: [{ clientX: 100, clientY: 100 }] });
  area.onTouchMove({ touches: [{ clientX: 101, clientY: 140 }] });
  area.onTouchEnd({ changedTouches: [{ clientX: 180, clientY: 140 }] });
  assert.equal(category, "competition", "a vertical scroll cannot turn into a tab swipe");
});

test("Expo tabs support taps and horizontal swipes while yielding vertical scroll, short drags and multiple touches", async () => {
  const native = { View: "View", Text: "Text", Pressable: "Pressable", StyleSheet: { create: value => value }, PanResponder: { create: value => ({ panHandlers: value }) } };
  const ui = await load("../apps/mobile/src/session-category-tabs.tsx", { "react-native": native, "./theme": { colors: {} }, "./appearance": { createThemedStyles: factory => () => factory({}) } });
  const render = () => ui.render(({ SessionCategoryTabs }) => SessionCategoryTabs({ children: category => React.createElement("Content", { category }) }));
  const category = () => nodes(render()).find(node => node.type === "Content").props.category;
  const tabs = () => nodes(render()).filter(node => node.props?.accessibilityRole === "tab");
  assert.equal(category(), "training");
  tabs()[1].props.onPress(); assert.equal(category(), "competition");
  function swipe(dx, dy = 0, touches = 1, startVertical = false) {
    const gesture = nodes(render()).find(node => node.props?.onPanResponderRelease).props;
    gesture.onStartShouldSetPanResponderCapture();
    if (startVertical) gesture.onMoveShouldSetPanResponderCapture({}, { dx: 1, dy: 40, numberActiveTouches: 1 });
    const claimed = gesture.onMoveShouldSetPanResponderCapture({}, { dx, dy, numberActiveTouches: touches });
    gesture.onPanResponderRelease({}, { dx, dy });
    return claimed;
  }
  assert.equal(swipe(80), true); assert.equal(category(), "training");
  assert.equal(swipe(-80), true); assert.equal(category(), "competition");
  assert.equal(swipe(2, 80), false); assert.equal(category(), "competition");
  assert.equal(swipe(20), false); assert.equal(category(), "competition");
  assert.equal(swipe(80, 0, 2), false); assert.equal(category(), "competition");
  assert.equal(swipe(80, 40, 1, true), false); assert.equal(category(), "competition");
  tabs()[0].props.onPress(); assert.equal(category(), "training");
});

test("web categories preserve classification, Session actions and an unsubmitted Session draft", async () => {
  const sessions = ["training", "competition"].map((sessionType, i) => ({ id: `session-${i}`, title: sessionType, date: "2026-10-17", sessionType, arrowCount: 72, rounds: [] }));
  const created = [];
  const ui = await load("../src/features/sessions/components/sessions-workspace.tsx", {
    "next/navigation": { useRouter: () => ({ refresh() {} }) }, "@arc-track/core/round-order": { newestRoundsFirst },
    "../scoring-model": scoring, "../round-presets": presets,
    "../actions": { createSession: async input => { created.push(input); return { ok: true, data: { ...sessions[0], ...input, id: "new" } }; } },
    "./recent-round-configs": { RecentRoundConfigs: "RecentRoundConfigs" },
    "./session-category-tabs": { SessionCategoryTabs: "CategoryTabs" }, "./round-presets-panel": { RoundPresetsPanel: "Presets" }, "./scoring-workspace": { ScoringWorkspace: "Scoring" },
    "@/features/weather/components/session-weather": { SessionWeatherHistory: "Weather" },
    "@/features/live-coaching/presence": {LivePresence:()=>null},
    "@/features/session-health/garmin-session-health": { GarminSessionHealth: "SessionHealth" },
  });
  const plan = React.createElement("Plan", { id: "plan" });
  const render = () => ui.render(({ SessionsWorkspace }) => SessionsWorkspace({ initialSessions: sessions, trainingPlanContent: plan }));
  const categories = () => nodes(render()).find(node => node.type === "CategoryTabs").props;
  assert.equal(categories().category, "training");
  assert.ok(nodes(categories().training).includes(plan));
  for (const value of ["training", "competition"]) {
    const section = nodes(categories()[value]).find(node => node.props?.sessions);
    assert.deepEqual(section.props.sessions.map(item => item.sessionType), [value]);
  }
  categories().onCategoryChange("competition");
  categories().toolbar.props.children[1].props.onClick();
  let tree = render();
  nodes(tree).find(node => node.type === "input" && node.props.type === "text").props.onChange({ target: { value: "Draft competition" } });
  tree = render();
  nodes(tree).find(node => node.type === "input" && node.props.value === "competition").props.onChange();
  tree = render();
  nodes(tree).find(node => node.type === "button" && text(node.props.children).endsWith("Sessions")).props.onClick();
  categories().onCategoryChange("training"); categories().onCategoryChange("competition");
  categories().toolbar.props.children[1].props.onClick(); tree = render();
  assert.equal(nodes(tree).find(node => node.type === "input" && node.props.type === "text").props.value, "Draft competition");
  await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(created.length, 1); assert.equal(created[0].sessionType, "competition");
  assert.equal(created[0].title, "Draft competition");
});

test("Expo filters the existing loaded list and keeps Plan content and navigation without refetching on category changes", async () => {
  const sessions = ["training", "competition"].map((type, i) => ({ id: `session-${i}`, title: type, date: "2026-10-17", type, arrowCount: 72 }));
  let reads = 0, planReads = 0;
  const routes = [], user = { id: "owner" };
  const ui = await load("../apps/mobile/app/(tabs)/sessions.tsx", {
    "react-native": { View: "View", Text: "Text", Pressable: "Pressable", FlatList: "FlatList", ActivityIndicator: "Loading", StyleSheet: { create: value => value } },
    "expo-router": { router: { push: value => routes.push(value) }, useFocusEffect: fn => { uiHooks(fn); } },
    "../../src/auth": { useAuth: () => ({ user }) }, "../../src/sessions": { readOwnSessions: async () => { reads++; return sessions; } },
    "../../src/appearance": { useAppearance: () => ({ colors: {} }), createThemedStyles: factory => () => factory({}) },
    "../../src/theme": { colors: {}, PAGE_TOP_SPACING: 0 }, "../../src/session-category-tabs": { SessionCategoryTabs: "CategoryTabs" },
    "../../src/offline-rounds": { OfflineRounds: "OfflineRounds" },
    "../../src/mobile-analytics": { singaporeToday: () => "2026-10-17" },
    "../../src/training-plans-read": { readMobileOwnTrainingPlanProgress: async () => { planReads++; return []; } },
    "../../src/training-plans-ui": { TrainingGoalRing: "Ring", visibleTrainingWeek: () => ({}) },
  });
  // Run each focus callback once, matching an already focused Sessions screen.
  const focused = new Set();
  function uiHooks(fn) { if (!focused.has(fn)) { focused.add(fn); fn(); } }
  const render = () => ui.render(module => module.default());
  render(); await tick();
  const categoryView = nodes(render()).find(node => node.type === "CategoryTabs").props.children;
  for (const category of ["training", "competition", "training"]) {
    const body = nodes(categoryView(category)), list = body.find(node => node.type === "FlatList").props;
    assert.deepEqual(list.data.map(item => item.type), [category]);
    assert.equal(nodes(list.ListHeaderComponent).find(node => node.props?.style?.display === "none")?.props.style?.display === "none", category === "competition");
    list.renderItem({ item: list.data[0] }).props.onPress();
    assert.equal(routes.at(-1).params.sessionId, list.data[0].id);
  }
  const button = nodes(categoryView("competition")).find(node => node.type === "Pressable");
  button.props.onPress(); assert.equal(routes.at(-1), "/sessions/new");
  assert.equal(reads, 1); assert.equal(planReads, 1);
});

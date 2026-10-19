import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as model from "../src/counter-model.ts";
import * as wheelModel from "../src/counter-wheel-model.ts";

// Run the real screen with persistent hooks. Native measurements are supplied,
// not calculated: physical clipping, keyboard and gestures still need device QA.
function counterRuntime() {
  let dimensions = { width: 390, height: 844 };
  let insets = { top: 24, right: 0, bottom: 34, left: 0 };
  let cursor = 0;
  let effects = [];
  let reads = 0;
  let ticks = 0;
  const slots = [];
  const writes = [];
  const alerts = [];
  const same = (left, right) => left && right && left.length === right.length && left.every((value, i) => Object.is(value, right[i]));
  const dependencies = {
    "react/jsx-runtime": jsx,
    react: {
      useState(initial) {
        const slot = cursor++;
        if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
        return [slots[slot], next => { slots[slot] = typeof next === "function" ? next(slots[slot]) : next; }];
      },
      useRef(initial) { const slot = cursor++; return slots[slot] ??= { current: initial }; },
      useCallback(callback, dependencies) {
        const slot = cursor++;
        if (!same(slots[slot]?.dependencies, dependencies)) slots[slot] = { callback, dependencies };
        return slots[slot].callback;
      },
      useEffect(callback, dependencies) {
        const slot = cursor++;
        if (!same(slots[slot]?.dependencies, dependencies)) {
          const previous = slots[slot];
          slots[slot] = { dependencies };
          effects.push(() => { previous?.cleanup?.(); slots[slot].cleanup = callback(); });
        }
      },
    },
    "react-native": {
      Alert: { alert: (...args) => alerts.push(args) }, FlatList: "FlatList", Pressable: "Pressable",
      ScrollView: "ScrollView", Text: "Text", View: "View", StyleSheet: { create: value => value },
      useWindowDimensions: () => dimensions,
    },
    "react-native-safe-area-context": { useSafeAreaInsets: () => insets },
    "@react-native-async-storage/async-storage": { __esModule: true, default: {
      getItem: async () => { reads++; return JSON.stringify({ version: 2, totalArrows: 190, increment: 15, history: [] }); },
      setItem: async (key, value) => { writes.push([key, JSON.parse(value)]); },
    } },
    "expo-haptics": { selectionAsync: async () => { ticks++; } },
    "../../src/counter-model": model,
    "../../src/counter-wheel-model": wheelModel,
    "../../src/theme": { colors: {}, PAGE_TOP_SPACING: 40 },
  };
  const source = readFileSync(new URL("../app/(tabs)/counter.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  const render = () => {
    cursor = 0;
    const tree = exports.default();
    const pending = effects;
    effects = [];
    pending.forEach(effect => effect());
    return tree;
  };
  return {
    render, writes, alerts, reads: () => reads, ticks: () => ticks,
    resize(width, height, nextInsets = insets) { dimensions = { width, height }; insets = nextInsets; },
    async settle() { await new Promise(setImmediate); return render(); },
  };
}

function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
const button = (tree, label) => nodes(tree).find(node => node.props?.accessibilityLabel === label);
const wheel = tree => nodes(tree).find(node => typeof node.type === "function");
const style = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
const measure = (tree, viewport, content) => {
  tree.props.onLayout({ nativeEvent: { layout: { height: viewport } } });
  tree.props.onContentSizeChange(390, content);
};

test("Counter uses measured height, compacts short windows and scrolls only for measured overflow", async () => {
  const runtime = counterRuntime();
  runtime.render();
  let tree = await runtime.settle();
  measure(tree, 736, 736);
  tree = runtime.render();
  assert.equal(tree.props.scrollEnabled, false);
  assert.equal(style(tree.props.contentContainerStyle).minHeight, 736);
  assert.equal(style(button(tree, "Add 15 Arrows").props.style({ pressed: false })).minHeight, 160);
  const wheelType = wheel(tree).type;
  for (const [width, height, viewport] of [[320, 480, 390], [375, 320, 232], [390, 360, 272], [430, 390, 302], [820, 430, 342]]) {
    runtime.resize(width, height, { top: 0, right: 44, bottom: 34, left: 44 });
    tree = runtime.render();
    measure(tree, viewport, 440);
    tree = runtime.render();
    assert.equal(style(button(tree, "Add 15 Arrows").props.style({ pressed: false })).minHeight, 88);
    assert.equal(tree.props.scrollEnabled, true);
    const padding = style(tree.props.contentContainerStyle);
    assert.equal(padding.paddingLeft, 56);
    assert.equal(padding.paddingRight, 56);
    assert.equal(padding.padding, 12); // Bottom inset is already owned by the tab bar.
    assert.equal(padding.paddingBottom, undefined);
    assert.equal(wheel(tree).type, wheelType);
    assert.equal(wheel(tree).props.value, 15);
  }
  runtime.resize(820, 1180);
  tree = runtime.render();
  measure(tree, 1060, 1060);
  tree = runtime.render();
  assert.equal(tree.props.scrollEnabled, false);
  assert.equal(style(button(tree, "Add 15 Arrows").props.style({ pressed: false })).minHeight, 160);
  measure(tree, 1060, 1061);
  assert.equal(runtime.render().props.scrollEnabled, false);
  await runtime.settle();
  assert.equal(runtime.reads(), 1);
  assert.equal(runtime.ticks(), 0);
  assert.equal(runtime.writes.length, 0);
});

test("Counter resize preserves total/increment/Undo/reset and does not reload or persist without an action", async () => {
  const runtime = counterRuntime();
  runtime.render();
  let tree = await runtime.settle();
  const wheelType = wheel(tree).type;
  assert.equal(wheel(tree).props.value, 15);
  button(tree, "Add 15 Arrows").props.onPress();
  tree = await runtime.settle();
  assert.equal(runtime.writes.at(-1)[1].totalArrows, 205);
  runtime.resize(844, 390);
  measure(tree, 300, 440);
  tree = runtime.render();
  assert.equal(wheel(tree).type, wheelType);
  assert.equal(wheel(tree).props.value, 15);
  assert.ok(nodes(tree).some(node => node.type === "Text" && node.props.children === 205));
  button(tree, "Undo last addition").props.onPress();
  tree = await runtime.settle();
  assert.equal(runtime.writes.at(-1)[1].totalArrows, 190);
  const beforeReset = runtime.writes.length;
  button(tree, "Reset counter").props.onPress();
  assert.equal(runtime.writes.length, beforeReset);
  assert.equal(runtime.alerts.at(-1)[2][0].style, "cancel");
  runtime.alerts.at(-1)[2].find(action => action.text === "Reset").onPress();
  tree = await runtime.settle();
  assert.equal(runtime.writes.at(-1)[1].totalArrows, 0);
  assert.deepEqual(runtime.writes.at(-1)[1].history, []);
  assert.equal(runtime.writes.at(-1)[1].increment, 15);
  wheel(tree).props.onChange(16);
  tree = await runtime.settle();
  assert.equal(wheel(tree).props.value, 16);
  assert.equal(runtime.ticks(), 1);
  const afterChange = runtime.writes.length;
  wheel(tree).props.onChange(16);
  await runtime.settle();
  assert.equal(runtime.writes.length, afterChange);
  assert.equal(runtime.ticks(), 1);
  assert.equal(runtime.reads(), 1);
});

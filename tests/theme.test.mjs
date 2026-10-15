import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../src/components/theme/theme-preference.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function runtime({ initial = {}, blocked = false, server = false } = {}) {
  const storage = new Map(Object.entries(initial));
  const events = new EventTarget();
  const browser = server ? undefined : {
    localStorage: {
      getItem(key) { if (blocked) throw new Error("Storage blocked"); return storage.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw new Error("Storage blocked"); storage.set(key, value); },
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  const loadedModule = { exports: {} };
  new Function("module", "exports", "require", "window", "Event", javascript)(loadedModule, loadedModule.exports, require, browser, Event);
  return { ...loadedModule.exports, storage, events };
}

test("theme preferences accept only Light, Dark and System; SSR is deterministic", () => {
  const model = runtime({ server: true });
  for (const value of [undefined, null, "invalid", {}, 1]) assert.equal(model.parseThemePreference(value), "system");
  for (const value of ["light", "dark", "system"]) assert.equal(model.parseThemePreference(value), value);
  assert.equal(model.readThemePreference(), "system");
  assert.equal(model.serverThemePreference(), "system");
  assert.doesNotThrow(() => model.setThemePreference("dark"));
});

test("theme persistence is isolated from authentication, scoring and counter storage", () => {
  const model = runtime({ initial: { "arc-track:counter:v2": "existing counter", "auth-session": "existing session" } });
  let changes = 0;
  const stop = model.subscribeThemePreference(() => changes++);
  for (const value of ["dark", "light", "system"]) {
    model.setThemePreference(value);
    assert.equal(model.readThemePreference(), value);
    assert.equal(model.storage.get(model.THEME_STORAGE_KEY), value);
  }
  assert.equal(changes, 3);
  assert.equal(model.storage.get("arc-track:counter:v2"), "existing counter");
  assert.equal(model.storage.get("auth-session"), "existing session");
  stop();
  model.setThemePreference("light");
  assert.equal(changes, 3);
  assert.equal(runtime({ initial: Object.fromEntries(model.storage) }).readThemePreference(), "light");
});

test("blocked browser storage still allows theme changes without throwing", () => {
  const model = runtime({ blocked: true });
  assert.equal(model.readThemePreference(), "system");
  model.setThemePreference("dark");
  assert.equal(model.readThemePreference(), "dark");
});

test("other tabs update the preference; unrelated storage changes are ignored", () => {
  const model = runtime();
  let changes = 0;
  const stop = model.subscribeThemePreference(() => changes++);
  model.setThemePreference("light");
  const event = key => Object.assign(new Event("storage"), { key });
  model.events.dispatchEvent(event("unrelated"));
  assert.equal(changes, 1);
  model.storage.set(model.THEME_STORAGE_KEY, "dark");
  model.events.dispatchEvent(event(model.THEME_STORAGE_KEY));
  assert.equal(changes, 2);
  assert.equal(model.readThemePreference(), "dark");
  model.storage.clear();
  model.events.dispatchEvent(event(null));
  assert.equal(model.readThemePreference(), "system");
  stop();
});

test("System uses OS CSS and explicit Light overrides a dark OS", async () => {
  const css = await readFile(new URL("../src/styles/theme.css", import.meta.url), "utf8");
  assert.match(css, /:root:has\(\[data-authenticated-theme\]\)\[data-theme="dark"\]/);
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  assert.match(css, /:root:has\(\[data-authenticated-theme\]\)\[data-theme="system"\]/);
  const darkDeclarations = [...css.matchAll(/--([\w-]+):\s*([^;]+);/g)];
  const half = darkDeclarations.length / 2;
  assert.deepEqual(darkDeclarations.slice(0, half).map(match => match[0]), darkDeclarations.slice(half).map(match => match[0]));
});

test("theme UI remains a leaf and contains no navigation, authentication or data operations", async () => {
  const ui = await readFile(new URL("../src/components/theme/theme-control.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  assert.match(ui, /aria-label="Color theme"/);
  for (const value of ["light", "dark", "system"]) assert.ok(ui.includes(`value: "${value}"`));
  assert.match(ui, /root\.dataset\.theme = readThemePreference\(\)/);
  assert.doesNotMatch(layout, /ThemeControl|ThemeSelector/);
  assert.match(ui, /delete root\.dataset\.theme/);
  assert.doesNotMatch(ui + source, /fetch\(|router\.|supabase|cookies\(|getUser\(|location\.|\.Provider|sessionStorage/);
});

test("scoring target accents and ring colors remain independent of page themes", async () => {
  const css = await readFile(new URL("../src/features/sessions/components/sessions.module.css", import.meta.url), "utf8");
  assert.match(css, /\.target\{--color-primary:#563d30;--color-peach:#f5dfcd\}/);
});


test("only the existing authenticated shell mounts theme application and selectors", async () => {
  const shell = await readFile(new URL("../src/components/layout/app-shell.tsx", import.meta.url), "utf8");
  const nav = await readFile(new URL("../src/components/layout/navigation.tsx", import.meta.url), "utf8");
  const auth = await readFile(new URL("../src/app/(auth)/layout.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/styles/theme.css", import.meta.url), "utf8");
  assert.match(shell, /data-authenticated-theme=\{authenticated \|\| undefined\}/);
  assert.match(shell, /\{authenticated && <ThemeControl \/>\}/);
  assert.equal((nav.match(/\{authenticated && <ThemeSelector/g) ?? []).length, 2);
  assert.doesNotMatch(auth, /ThemeControl|ThemeSelector|data-authenticated-theme/);
  for (const selector of css.matchAll(/([^{}]+)\{[^{}]*color-scheme: dark/g)) {
    assert.ok(selector[1].includes(":has([data-authenticated-theme])"));
  }
  const controlCss = await readFile(new URL("../src/components/theme/theme-control.module.css", import.meta.url), "utf8");
  assert.doesNotMatch(controlCss, /floating|position:fixed/);
});

test("authenticated theme lifecycle restores saved preference before paint, cleans up on logout and preserves it for login", async () => {
  const source = await readFile(new URL("../src/components/theme/theme-control.tsx", import.meta.url), "utf8");
  const script = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const model = runtime({ initial: { "arc-track:theme:v1": "dark" } });
  const root = { dataset: {} };
  let mount;
  const loadedModule = { exports: {} };
  const mocks = name => {
    if (name === "react") return { useLayoutEffect(effect) { mount = effect; }, useSyncExternalStore() {} };
    if (name === "./theme-preference") return model;
    if (name === "@/components/ui/icon") return { Icon: () => null };
    if (name.endsWith(".css")) return {};
    return require(name);
  };
  new Function("module", "exports", "require", "document", script)(loadedModule, loadedModule.exports, mocks, { documentElement: root });
  const fallback = loadedModule.exports.ThemeControl();
  assert.equal(fallback.type, "noscript");
  assert.match(fallback.props.children.props.children, /visibility: visible/);
  assert.equal(root.dataset.theme, undefined); // Public SSR never reads or applies the saved value.
  const unmount = mount(); // React layout effect runs before paint.
  assert.equal(root.dataset.theme, "dark");
  for (const theme of ["light", "system", "dark"]) {
    model.setThemePreference(theme);
    assert.equal(root.dataset.theme, theme);
  }
  unmount();
  assert.equal(root.dataset.theme, undefined);
  assert.equal(model.storage.get(model.THEME_STORAGE_KEY), "dark");
  const logoutSnapshot = { ...root.dataset };
  model.setThemePreference("dark");
  assert.deepEqual(root.dataset, logoutSnapshot); // Unmounted public screens do not apply stored appearance.
  const unmountAgain = mount();
  assert.equal(root.dataset.theme, "dark");
  unmountAgain();
});


async function selectorRuntime(initial = "system", expanded = false) {
  const source = await readFile(new URL("../src/components/theme/theme-control.tsx", import.meta.url), "utf8");
  const script = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const model = runtime({ initial: { "arc-track:theme:v1": initial } });
  const listeners = new Map();
  const doc = {
    activeElement: null,
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name, handler) { if (listeners.get(name) === handler) listeners.delete(name); },
  };
  class Element {
    constructor(name, inside = true) { this.name = name; this.inside = inside; }
    focus() { doc.activeElement = this; }
  }
  const trigger = new Element("trigger");
  const items = ["light", "dark", "system"].map(value => new Element(value));
  const control = { contains: target => Boolean(target?.inside) };
  const menu = { querySelector: () => items.find(item => item.name === model.readThemePreference()), querySelectorAll: () => items };
  const refs = [control, trigger, menu].map(current => ({ current }));
  let open = false, previousOpen, refIndex, effect, cleanup;
  const mocks = name => {
    if (name === "react") return {
      useState: () => [open, value => { open = typeof value === "function" ? value(open) : value; }],
      useRef: () => refs[refIndex++], useId: () => "theme-test",
      useSyncExternalStore: () => model.readThemePreference(), useEffect: callback => { effect = callback; },
    };
    if (name === "./theme-preference") return model;
    if (name === "@/components/ui/icon") return { Icon: () => null };
    if (name.endsWith(".css")) return {};
    return require(name);
  };
  const loadedModule = { exports: {} };
  new Function("module", "exports", "require", "document", "Node", script)(loadedModule, loadedModule.exports, mocks, doc, Element);
  function render() {
    refIndex = 0;
    const tree = loadedModule.exports.ThemeSelector({ expanded });
    if (open !== previousOpen) { cleanup?.(); cleanup = effect(); previousOpen = open; }
    return tree;
  }
  return { render, model, doc, trigger, items, Element, listeners };
}
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...elements(tree.props?.children)];
}
function keyEvent(key, extra = {}) {
  return { key, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
}

test("premium selector uses a button and three complete clickable rows with selected checkmark", async () => {
  const view = await selectorRuntime("dark");
  let tree = view.render();
  const trigger = elements(tree).find(element => element.props?.["aria-haspopup"] === "menu");
  assert.equal(trigger.type, "button");
  assert.equal(trigger.props.type, "button");
  assert.equal(trigger.props["aria-expanded"], false);
  assert.equal(elements(tree).filter(element => element.type === "select").length, 0);
  trigger.props.onClick();
  tree = view.render();
  const menu = elements(tree).find(element => element.props?.role === "menu");
  assert.equal(menu.props.id, trigger.props["aria-controls"]);
  const rows = elements(tree).filter(element => element.props?.role === "menuitemradio");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.props["aria-checked"]), [false, true, false]);
  assert.equal(elements(rows[1]).filter(element => element.props?.name === "check").length, 1);
  assert.equal(elements(rows[0]).filter(element => element.props?.name === "check").length, 0);
  assert.equal(view.doc.activeElement, view.items[1]);
  for (const text of ["Light", "Dark", "System", "Bright and clean", "Comfortable in low light", "Match your device"]) {
    assert.ok(JSON.stringify(tree).includes(text));
  }
});

test("each theme row updates the existing preference, closes, returns focus and restores on reload", async () => {
  const view = await selectorRuntime();
  for (const [index, preference] of ["light", "dark", "system"].entries()) {
    let tree = view.render();
    elements(tree).find(element => element.props?.["aria-haspopup"] === "menu").props.onClick();
    tree = view.render();
    elements(tree).filter(element => element.props?.role === "menuitemradio")[index].props.onClick();
    tree = view.render();
    assert.equal(view.model.readThemePreference(), preference);
    assert.equal(view.model.storage.get(view.model.THEME_STORAGE_KEY), preference);
    assert.equal(elements(tree).filter(element => element.props?.role === "menu").length, 0);
    assert.equal(view.doc.activeElement, view.trigger);
    assert.equal(runtime({ initial: Object.fromEntries(view.model.storage) }).readThemePreference(), preference);
  }
});

test("keyboard supports opening, wrapped arrows, Home/End, Escape and normal Tab exit", async () => {
  const view = await selectorRuntime();
  let tree = view.render();
  const trigger = elements(tree).find(element => element.props?.["aria-haspopup"] === "menu");
  const opening = keyEvent("ArrowDown");
  trigger.props.onKeyDown(opening);
  assert.equal(opening.prevented, true);
  tree = view.render();
  const menu = elements(tree).find(element => element.props?.role === "menu");
  assert.equal(view.doc.activeElement, view.items[2]);
  for (const [key, index] of [["ArrowDown", 0], ["ArrowUp", 2], ["Home", 0], ["End", 2]]) {
    const event = keyEvent(key);
    menu.props.onKeyDown(event);
    assert.equal(event.prevented, true);
    assert.equal(view.doc.activeElement, view.items[index]);
  }
  const escape = keyEvent("Escape");
  menu.props.onKeyDown(escape);
  assert.equal(escape.stopped, true); // Escape closes appearance without closing the parent mobile navigation.
  assert.equal(view.doc.activeElement, view.trigger);
  tree = view.render();
  assert.equal(elements(tree).filter(element => element.props?.role === "menu").length, 0);
  trigger.props.onClick();
  tree = view.render();
  const tab = keyEvent("Tab");
  elements(tree).find(element => element.props?.role === "menu").props.onKeyDown(tab);
  assert.equal(tab.prevented, false);
  assert.equal(view.doc.activeElement, view.trigger);
  tree = view.render();
  assert.equal(elements(tree).filter(element => element.props?.role === "menu").length, 0);
});

test("outside pointer and focus dismiss the selector; inside gestures do not; listeners clean up", async () => {
  const view = await selectorRuntime("light", true);
  let tree = view.render();
  elements(tree).find(element => element.props?.["aria-haspopup"] === "menu").props.onClick();
  tree = view.render();
  assert.equal(view.listeners.size, 1);
  view.listeners.get("pointerdown")({ target: new view.Element("inside") });
  assert.equal(elements(view.render()).filter(element => element.props?.role === "menu").length, 1);
  const outside = new view.Element("outside", false);
  outside.focus();
  view.listeners.get("pointerdown")({ target: outside });
  tree = view.render();
  assert.equal(view.listeners.size, 0);
  assert.equal(view.doc.activeElement, outside);
  assert.equal(elements(tree).filter(element => element.props?.role === "menu").length, 0);
  elements(tree).find(element => element.props?.["aria-haspopup"] === "menu").props.onClick();
  tree = view.render();
  tree.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: outside });
  tree = view.render();
  assert.equal(view.listeners.size, 0);
  assert.equal(view.model.readThemePreference(), "light");
});

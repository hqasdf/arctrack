import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
export function loadSessionModule(path, dependencies = {}, hooks = React, globals = {}, source) {
  const code = ts.transpileModule(source ?? readFileSync(new URL('../../' + path, import.meta.url), 'utf8'), {
    fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', ...Object.keys(globals), code)(name => {
    if (name in dependencies) return dependencies[name];
    if (name === '@/features/sessions/training-navigation') return loadSessionModule('src/features/sessions/training-navigation.ts',{},hooks,globals);
    if (name === 'react') return hooks;
    if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => 'sessionHealth_' + key }) };
    if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a', props) };
    return require(name);
  }, exports, ...Object.values(globals));
  return exports;
}
export const sessionModel = loadSessionModule('src/features/session-health/model.ts');
export const treeNodes = tree => Array.isArray(tree) ? tree.flatMap(treeNodes) : tree && typeof tree === 'object' ? [tree, ...treeNodes(tree.props?.children)] : [];
export const treeText = tree => Array.isArray(tree) ? tree.map(treeText).join('') : tree && typeof tree === 'object' ? treeText(tree.props?.children) : String(tree ?? '');
export const settle = () => new Promise(resolve => setImmediate(resolve));

export function createSessionUI(responder) {
  const slots = [], effects = [], listeners = new Map(), timers = new Set(), calls = [];
  let cursor = 0, tree;
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set('document:' + name, fn), removeEventListener: name => listeners.delete('document:' + name) };
  const window = { addEventListener: (name, fn) => listeners.set('window:' + name, fn), removeEventListener: name => listeners.delete('window:' + name) };
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) { const i=cursor++; if (!slots[i] || !deps.every((v,n)=>Object.is(v,slots[i].deps[n]))) slots[i]={deps,value:fn()}; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(()=>fn,deps); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !deps.every((v, n) => Object.is(v, slots[i].deps[n]))) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const compiled = loadSessionModule('src/features/session-health/garmin-session-health.tsx', {
    './model': sessionModel, './heart-rate-timeline': { HeartRateTimeline: () => React.createElement('div', null, 'Recorded HR timeline') },
  }, hooks, { document, window, setInterval: fn => { timers.add(fn); return fn; }, clearInterval: fn => timers.delete(fn), fetch: async (url, options) => { calls.push({ url, options }); return responder(url, options); } });
  const props = { sessionId: 'synthetic-session' };
  return {
    render() { cursor = 0; tree = compiled.GarminSessionHealth(props); while (effects.length) effects.shift()(); return tree; },
    calls, listeners, timers, nodes: () => treeNodes(tree), text: () => treeText(tree),
    async click(label) { const button = treeNodes(tree).find(n => n.type === 'button' && treeText(n) === label); if (!button) throw Error('Missing button: ' + label); await button.props.onClick?.(); },
    visibility(state) { document.visibilityState = state; listeners.get('document:visibilitychange')?.(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}


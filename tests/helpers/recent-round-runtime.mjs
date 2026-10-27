import React from 'react';
import { loadSessionModule, treeNodes, treeText, settle } from './session-layout-runtime.mjs';
export function recentRuntime(path, dependencies) {
  const slots = [], effects = [], listeners = new Map(), timers = new Map(); let cursor = 0, tree, now = 0, nextTimer = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const schedule = (fn, delay = 0) => { const id = ++nextTimer; timers.set(id, { fn, due: now + delay }); return id; };
  const cancel = id => timers.delete(id);
  const runDue = () => { for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.fn(); } };
  const window = { setTimeout: schedule, clearTimeout: cancel, addEventListener: (n, fn) => listeners.set('window:' + n, fn), removeEventListener: n => listeners.delete('window:' + n) };
  const document = { visibilityState: 'visible', addEventListener: (n, fn) => listeners.set('document:' + n, fn), removeEventListener: n => listeners.delete('document:' + n) };
  const compiled = loadSessionModule(path, typeof dependencies === 'function' ? dependencies(hooks, listeners) : dependencies, hooks, { window, document, setTimeout: schedule, clearTimeout: cancel });
  let component = compiled.RecentRoundConfigs, props;
  return { listeners, timers, document, exports: compiled,
    setProps(next) { props = next; }, setComponent(next) { component = next; },
    render() { cursor = 0; tree = component(props); while (effects.length) effects.shift()(); return tree; },
    async settle() { runDue(); await settle(); this.render(); await settle(); this.render(); },
    async advance(milliseconds) { now += milliseconds; await this.settle(); },
    nodes: () => treeNodes(tree), text: () => treeText(tree),
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

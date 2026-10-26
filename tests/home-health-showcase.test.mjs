import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/features/home/health-performance-showcase.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
function showcase() {
  let selected = 0; const focus = [], refs = { current: [] };
  const hooks = { ...React, useId: () => 'showcase-test', useState: () => [selected, value => { selected = value; }], useRef: () => refs };
  const exports = {};
  new Function('require', 'exports', code)(name => {
    if (name === 'react') return hooks;
    if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a', props) };
    if (name === '@/components/ui/icon') return { Icon: ({ name }) => React.createElement('svg', { 'aria-hidden': true, 'data-icon': name }) };
    if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    if (name === 'react/jsx-runtime') return require(name);
    throw Error('Public showcase must not load backend dependencies: ' + name);
  }, exports);
  const tree = () => exports.HealthPerformanceShowcase();
  const tabs = () => nodes(tree()).filter(n => n.props.role === 'tab');
  return { tree, tabs, focus, html: () => renderToStaticMarkup(tree()), select(index) { tabs()[index].props.onClick(); }, key(index, key) { tabs().forEach((button, n) => button.props.ref({ focus: () => focus.push(n) })); let prevented = false; tabs()[index].props.onKeyDown({ key, preventDefault() { prevented = true; } }); return prevented; } };
}

for (const [index, label] of ['Overview', 'Sleep', 'Daily health', 'Activities', 'Session HR'].entries()) test('Public ' + label + ' preview is labelled illustrative and accessible', () => {
  const h = showcase(); h.select(index); const html = h.html();
  assert.match(html, /Illustrative data · not your measurements/);
  assert.equal(h.tabs().filter(t => t.props['aria-selected']).length, 1);
  assert.equal(h.tabs().filter(t => t.props.tabIndex === 0).length, 1);
  assert.match(html, new RegExp('role="tabpanel"[^>]*aria-labelledby="showcase-test-tab-' + index + '"'));
  assert.match(html, /href="\/health"/); assert.match(html, /href="\/privacy#garmin"/); assert.match(html, /href="\/sign-up"/);
});
test('Tab keyboard navigation wraps, supports Home/End and moves focus', () => {
  const h = showcase(); assert.equal(h.key(0, 'ArrowLeft'), true); assert.equal(h.tabs()[4].props['aria-selected'], true); assert.deepEqual(h.focus, [4]);
  h.key(4, 'Home'); assert.equal(h.tabs()[0].props['aria-selected'], true); h.key(0, 'End'); assert.equal(h.tabs()[4].props['aria-selected'], true);
  h.key(4, 'ArrowRight'); assert.equal(h.tabs()[0].props['aria-selected'], true); assert.equal(h.key(0, 'Tab'), false);
});
test('Sleep example is internally consistent and missing scores retain chart gaps', () => {
  const h = showcase(); h.select(1); const html = h.html();
  for (const text of ['7h ', '42m', '4h 10m', '1h 32m', '2h 00m', '18m', 'Good · example qualifier', '22:30', '06:30']) assert.ok(html.includes(text), text);
  assert.equal(250 + 92 + 120, 7 * 60 + 42); assert.equal(250 + 92 + 120 + 18, 8 * 60);
  assert.match(html, /Awake is excluded from total time asleep/); assert.equal((html.match(/<polyline/g) ?? []).length, 2); assert.match(html, /0–100/);
});
test('Session HR is a qualified preview, not a claim of verified live delivery or coaching access', () => {
  const h = showcase(); h.select(4); const html = h.html();
  assert.match(html, /detailed activity delivery verification pending/); assert.match(html, /lower resolution/); assert.match(html, /No live streaming or historical backfill/);
  assert.match(html, /does not share your Garmin heart rate with coaches/); assert.match(html, /Garmin originals remain with Garmin/);
  assert.equal((html.match(/<polyline/g) ?? []).length, 2);
});
test('Demonstrations stay independent of account data, persistence and automatic synchronization', () => {
  assert.doesNotMatch(source, /\bfetch\s*\(|supabase|localStorage|sessionStorage|useEffect|setInterval|setTimeout/);
  assert.doesNotMatch(source, /from ["'][^"']*(?:features\/health|features\/garmin|\.server)/);
  const css = readFileSync(new URL('../src/features/home/health-performance.module.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion:reduce/); assert.match(css, /animation:none/); assert.match(css, /focus-visible/);
});
test('Homepage keeps the scoring story, coaching, metadata and final CTA around the new section', () => {
  const page = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  for (const part of ['<CinematicScene />', '<PrecisionDemo />', '<CoachShowcase />', 'publicPageMetadata(', 'Get started with Arc Track', 'aria-label="Footer"']) assert.ok(page.includes(part));
  assert.ok(page.indexOf('<CoachShowcase />') < page.indexOf('<HealthPerformanceShowcase />'));
  assert.ok(page.indexOf('<HealthPerformanceShowcase />') < page.indexOf('aria-labelledby="final-heading"'));
});

test('SVG tooltip titles use a single server-rendered text node for stable hydration',()=>{const html=renderToString(showcase().tree());assert.match(html,/<title>Illustrative value: 57<\/title>/);assert.doesNotMatch(html,/<title>[^<]*<!--/);});

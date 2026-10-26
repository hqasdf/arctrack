import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadSessionModule } from './helpers/session-layout-runtime.mjs';

for (const [path, selected] of [['/analytics', 'Archery'], ['/analytics/health', 'Health']]) {
  test(`Analytics section navigation selects ${selected} at ${path}`, () => {
    const { AnalyticsNavigation } = loadSessionModule('src/features/analytics/components/analytics-navigation.tsx', {
      'next/navigation': { usePathname: () => path },
    });
    const tree = AnalyticsNavigation(), links = tree.props.children;
    assert.deepEqual(links.map(link => link.props.href), ['/analytics', '/analytics/health']);
    assert.equal(links.filter(link => link.props['aria-current'] === 'page').length, 1);
    assert.equal(links.find(link => link.props['aria-current'] === 'page').props.children, selected);
    assert.ok(links.every(link => link.props.prefetch === false));
    assert.match(renderToStaticMarkup(tree), /aria-label="Analytics sections"/);
  });
}

for (const [query, expected] of [
  [{}, '/analytics/health'],
  [{ garmin: 'connected', date: ['2026-10-25', '2026-10-26'], empty: '', missing: undefined }, '/analytics/health?garmin=connected&date=2026-10-25&date=2026-10-26&empty='],
  [{ next: 'https://other.example/#private', garmin: 'cancelled' }, '/analytics/health?next=https%3A%2F%2Fother.example%2F%23private&garmin=cancelled'],
]) test('Legacy Health redirect preserves query data on a fixed local destination: '+expected, async () => {
  const page = loadSessionModule('src/app/(platform)/health/page.tsx', {
    'next/navigation': { redirect: destination => { throw new Error('REDIRECT:'+destination); } },
  });
  await assert.rejects(page.default({ searchParams: Promise.resolve(query) }), error => error.message === 'REDIRECT:'+expected);
});

test('Analytics layout only composes section navigation and route content', () => {
  const Navigation = () => null;
  const layout = loadSessionModule('src/app/(platform)/analytics/layout.tsx', {
    '@/features/analytics/components/analytics-navigation': { AnalyticsNavigation: Navigation },
  });
  const content = React.createElement('p', null, 'Existing route content');
  const tree = layout.default({ children: content });
  assert.equal(tree.props.children[0].type, Navigation);
  assert.equal(tree.props.children[1], content);
  const archery = readFileSync(new URL('../src/app/(platform)/analytics/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(archery, /HealthDashboard|readHealthDashboard/);
  const health = readFileSync(new URL('../src/app/(platform)/analytics/health/page.tsx', import.meta.url), 'utf8');
  assert.match(health, /await requireUser\(\)/);
  assert.match(health, /readHealthDashboard\(user.id\)/);
  assert.doesNotMatch(health, /readAnalyticsSessions/);
});

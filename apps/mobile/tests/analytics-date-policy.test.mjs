import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileAnalyticsView, singaporeToday} from '../src/mobile-analytics.ts';
import {singaporeDate as webDate} from '../../../src/lib/date.ts';
import {filterAnalyticsRounds, calculateOverview, calculateTrend, calculateArrowVolume, getAvailableFilters} from '../../../src/features/analytics/analytics-model.ts';
import {buildCoachTeamAnalytics, DEFAULT_COACH_FILTERS} from '@arc-track/core/coach-analytics';
import {coachHistoryFixture} from '../../../packages/core/tests/helpers/coach-analytics-fixtures.mjs';

for(const [instant,day] of [
 ['2026-10-31T15:59:59.999Z','2026-10-31'],['2026-10-31T16:00:00.000Z','2026-11-01'],
 ['2026-12-31T16:00:00Z','2027-01-01'],['2028-02-28T16:00:00Z','2028-02-29'],
 ['2026-03-08T07:00:00Z','2026-03-08'],['2026-11-01T06:00:00Z','2026-11-01'],
])test(`web and Android Singapore calendar parity: ${instant}`,()=>{
 assert.equal(webDate(new Date(instant)),day);assert.equal(singaporeToday(new Date(instant)),day);
});

for(const dateRange of ['all','7','30'])for(const sessionType of ['all','training','competition'])test(`web / Android Analytics and Coach use identical dates: ${dateRange}, ${sessionType}`,()=>{
 const f=coachHistoryFixture(16,3);f.sessions.forEach((s,i)=>{if(i%3===0)s.date='2026-11-01';});
 const filters={dateRange,sessionType,distance:'all',division:'all',targetFace:'all'};
 for(const instant of ['2026-10-31T15:59:59.999Z','2026-10-31T16:00:00Z']){
  const today=singaporeToday(new Date(instant));
  const native=mobileAnalyticsView(f.sessions,filters,today,'daily');
  const rounds=filterAnalyticsRounds(f.sessions,filters,today);
  assert.deepEqual(native.rounds,rounds);assert.deepEqual(native.overview,calculateOverview(rounds));
  assert.deepEqual(native.trend,calculateTrend(rounds));
  assert.deepEqual(native.volume,calculateArrowVolume(f.sessions,filters,today,'daily'));
  assert.deepEqual(native.available,getAvailableFilters(f.sessions,filters,today));
  const coach=buildCoachTeamAnalytics(f.athletes,f.sessions,{...DEFAULT_COACH_FILTERS,period:dateRange,sessionType},today);
  assert.deepEqual(coach.filteredRounds.map(r=>r.round),rounds.map(r=>r.round));
  assert.equal(coach.summary.scoredArrowCount,native.overview.totalArrows);
 }
});

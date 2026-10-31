import test from 'node:test';
import assert from 'node:assert/strict';
import {filterAnalyticsRounds, calculateOverview, getAvailableFilters, calculateArrowVolume} from '../src/analytics-model.ts';
import {buildCoachTeamAnalytics, buildCoachAthleteInsights, coachFilterOptions, DEFAULT_COACH_FILTERS} from '../src/coach-analytics-model.ts';
import {coachHistoryFixture} from './helpers/coach-analytics-fixtures.mjs';
import * as legacy from './fixtures/coach-analytics-before-phase3d3.ts';

const today='2026-10-31';
function fixture(){
 const f=coachHistoryFixture(7,2);
 const dates=['2026-07-01','2026-08-02','2026-10-01','2026-10-25',today,'2026-11-01','2027-01-01'];
 f.sessions.forEach((s,i)=>{s.date=dates[i];s.rounds.forEach(r=>{r.distanceMetres=10+i;r.division=i%2?'Compound':'Recurve';});});
 return f;
}
for(const period of ['all','7','30','90'])for(const sessionType of ['all','training','competition'])test(`personal / Coach date parity: ${period}, ${sessionType}`,()=>{
 const f=fixture();
 const filters={...DEFAULT_COACH_FILTERS,period,sessionType};
 const result=buildCoachTeamAnalytics(f.athletes,f.sessions,filters,today);
 const cutoff={7:'2026-10-25',30:'2026-10-02',90:'2026-08-03'}[period];
 const expected=f.sessions.filter(s=>(sessionType==='all'||s.sessionType===sessionType)&&(period==='all'||s.date>=cutoff&&s.date<=today));
 assert.deepEqual(result.filteredSessions,expected);
 const rounds=expected.flatMap(s=>s.rounds.map(round=>({sessionId:s.id,sessionTitle:s.title,sessionType:s.sessionType,date:s.date,round})));
 assert.deepEqual(result.filteredRounds.map(r=>r.round),rounds.map(r=>r.round));
 const options=coachFilterOptions(f.sessions,today,filters);
 assert.deepEqual(options.distances,[...new Set(rounds.map(r=>r.round.distanceMetres))].sort((a,b)=>a-b));
 if(period!=='90'){
  const personal={sessionType,dateRange:period,distance:'all',division:'all',targetFace:'all'};
  assert.deepEqual(filterAnalyticsRounds(f.sessions,personal,today),rounds);
  assert.deepEqual(getAvailableFilters(f.sessions,personal,today),options);
  assert.equal(calculateArrowVolume(f.sessions,personal,today,'daily').reduce((n,p)=>n+p.arrowCount,0),result.summary.arrowCount);
 }
 for(const athlete of f.athletes){
  const own=buildCoachAthleteInsights(athlete,f.sessions,filters,today);
  assert.deepEqual(own.overview,calculateOverview(rounds.filter(r=>expected.find(s=>s.id===r.sessionId).userId===athlete.userId)));
 }
 assert.ok(result.recent.every(({session})=>session.date<=today),'Recent Activity remains historical');
});

test('unaffected histories retain exact Phase 3D-3 results for every period',()=>{
 const f=coachHistoryFixture(40,4);
 for(const period of ['all','7','30','90']){
  const filters={...DEFAULT_COACH_FILTERS,period};
  assert.deepEqual(buildCoachTeamAnalytics(f.athletes,f.sessions,filters,today),legacy.buildCoachTeamAnalytics(f.athletes,f.sessions,filters,today));
 }
});

test('bounded periods include both calendar endpoints and exclude neighbouring days',()=>{
 for(const [period,start,previous] of [['7','2026-10-25','2026-10-24'],['30','2026-10-02','2026-10-01'],['90','2026-08-03','2026-08-02']]){
  const f=coachHistoryFixture(4,1);f.sessions.forEach((s,i)=>s.date=[previous,start,today,'2026-11-01'][i]);
  assert.deepEqual(buildCoachTeamAnalytics(f.athletes,f.sessions,{...DEFAULT_COACH_FILTERS,period},today).filteredSessions.map(s=>s.date),[start,today]);
 }
});

test('future-only Round formats appear in All Time options but not bounded options',()=>{
 const f=fixture();const filters={...DEFAULT_COACH_FILTERS,period:'all'};
 assert.ok(coachFilterOptions(f.sessions,today,filters).distances.includes(16));
 assert.ok(!coachFilterOptions(f.sessions,today,{...filters,period:'30'}).distances.includes(16));
 const r=buildCoachTeamAnalytics(f.athletes,f.sessions,{...filters,distance:16},today);
 assert.equal(r.summary.sessionCount,1);assert.equal(r.recent.length,0);
});

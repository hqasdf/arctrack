import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as original from './fixtures/coach-analytics-before-phase3d3.ts';
import * as current from '../src/coach-analytics-model.ts';
import {coachHistoryFixture} from './helpers/coach-analytics-fixtures.mjs';
const filters=[{period:'all'},{},{period:'7',sessionType:'competition'},{period:'90',distance:70},{period:'all',division:'Compound'},{period:'all',targetFace:'40:triple_face'},{period:'all',distance:999},{period:'all',sessionType:'training',distance:18,division:'Recurve'}];
function parity(fixture,filter){
 // Phase 3D-4 intentionally extends All Time to future Sessions. Compare the
 // unchanged historical domain to the frozen reference; date-policy tests cover the extension.
 const sessions=filter.period==='all'?fixture.sessions.filter(s=>s.date<=fixture.today):fixture.sessions;
 const args=[fixture.athletes,sessions,filter,fixture.today];
 assert.deepStrictEqual(current.buildCoachTeamAnalytics(...args),original.buildCoachTeamAnalytics(...args));
 const athlete=fixture.athletes[0]??{userId:'missing',name:'No athlete'};
 assert.deepStrictEqual(current.buildCoachAthleteInsights(athlete,sessions,filter,fixture.today),original.buildCoachAthleteInsights(athlete,sessions,filter,fixture.today));
}
test('frozen oracle reconstructs the exact original source checksum',()=>{
 const text=readFileSync(new URL('./fixtures/coach-analytics-before-phase3d3.ts',import.meta.url),'utf8');
 const source=text.slice(text.indexOf('\n')+1).replaceAll('"../../src/','"./').replaceAll('\r\n','\n');
 assert.equal(createHash('sha256').update(source).digest('hex').toUpperCase(),'FC45A2E9C38DE7010F1E541DC54D3A890F606BF01A193142005A634109691C7E');
});
for(let seed=0;seed<10;seed++)for(const [index,update] of filters.entries())test(`exact parity: seed ${seed}, filter ${index}`,()=>{
 const fixture=coachHistoryFixture(seed*8,seed%8+1,20261031+seed);
 // Intentional future-date inclusion is verified in analytics-date-policy.
 if(fixture.sessions.length){fixture.sessions.push({...fixture.sessions[0],id:'future',date:'2026-11-01'},{...fixture.sessions[0],id:'former',userId:'former-athlete'});}
 parity(fixture,{...current.DEFAULT_COACH_FILTERS,...update});
});
for(const size of [500,2000,5000])for(const athleteCount of [1,32])test(`large-history exact parity: ${size} Sessions, ${athleteCount} athletes`,()=>{
 parity(coachHistoryFixture(size,athleteCount),{...current.DEFAULT_COACH_FILTERS,period:'all'});
});
test('equal dates, duplicate IDs/references and duplicate roster entries preserve legacy semantics',()=>{
 const f=coachHistoryFixture(8,1);f.sessions[1].id=f.sessions[0].id;for(const s of f.sessions)s.date=f.today;
 f.sessions.push(f.sessions[0]);f.athletes.push({...f.athletes[0],name:'Second roster label'});
 parity(f,{...current.DEFAULT_COACH_FILTERS,period:'all'});
});
test('zero scores, X, floating-point plots and unassigned Triple-face plots have bit-exact parity',()=>{
 const f=coachHistoryFixture(6,1);
 for(const [i,s] of f.sessions.entries())for(const r of s.rounds){r.faceType='triple_face';r.arrows=Array.from({length:36},(_,k)=>({id:`${r.id}-${k}`,end:Math.floor(k/9)+1,arrow:k%9+1,score:i%2?'M':k%2?'X':'10',plot:{x:k===0?-0:k/1000+1e-12,y:k/9999,...(k%4?{faceIndex:k%3}:{})}}));r.arrowsPerEnd=9;r.ends=4;}
 parity(f,{...current.DEFAULT_COACH_FILTERS,period:'all'});
});
test('inputs are immutable and public Session/Round references are retained',()=>{
 const f=coachHistoryFixture(18,4);
 function freeze(v){if(v&&typeof v==='object'){Object.freeze(v);for(const child of Object.values(v))freeze(child);}}freeze(f);
 const filter={...current.DEFAULT_COACH_FILTERS,period:'all'};parity(f,filter);
 const result=current.buildCoachTeamAnalytics(f.athletes,f.sessions,filter,f.today);
 assert.ok(result.filteredSessions.every(s=>f.sessions.includes(s)));
 assert.ok(result.filteredRounds.every(({session,round})=>f.sessions.includes(session)&&session.rounds.includes(round)));
});
test('athlete trends no longer perform a full record scan per Session',()=>{
 const f=coachHistoryFixture(200,1);let reads=0;
 for(const s of f.sessions){const id=s.id;Object.defineProperty(s,'id',{get(){reads++;return id;}});}
 const filter={...current.DEFAULT_COACH_FILTERS,period:'all'};
 original.buildCoachAthleteInsights(f.athletes[0],f.sessions,filter,f.today);const before=reads;reads=0;
 current.buildCoachAthleteInsights(f.athletes[0],f.sessions,filter,f.today);const after=reads;
 assert.ok(before>200*200);assert.ok(after<200*15,`Expected bounded ID reads, observed ${after}`);
});

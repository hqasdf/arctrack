import test from 'node:test';
import assert from 'node:assert/strict';
import {mapSessionSummary,mapCompleteSummaryBatch} from '../src/session-contracts.ts';
const row={id:'00000000-0000-4000-8000-000000000001',title:'Practice',session_date:'2026-10-31',created_at:'2026-10-31T03:00:00.123456Z',session_type:'training',arrow_count:180,session_rounds:[{count:3}]};
for(const type of ['training','competition'])test(`summary preserves ${type} and recorded count independently of scored rows`,()=>{
 const summary=mapSessionSummary({...row,session_type:type,arrows:[{score:10}]});assert.equal(summary.arrowCount,180);assert.equal(summary.roundCount,3);assert.equal(summary.sessionType,type);assert.equal(summary.createdAt,row.created_at);assert.equal('rounds' in summary,false);assert.equal('arrows' in summary,false);
});
test('empty Session has explicit zero counts',()=>{const summary=mapSessionSummary({...row,arrow_count:0,session_rounds:[{count:0}]});assert.equal(summary.roundCount,0);assert.equal(summary.arrowCount,0);assert.deepEqual(mapCompleteSummaryBatch([],0),[]);});
for(const [key,value] of [['session_rounds',null],['session_rounds',[]],['session_rounds',[{count:null}]],['arrow_count',-1],['arrow_count','180'],['session_date','2026-02-30'],['created_at',null],['session_type','other'],['id','missing']])test(`malformed summary ${key} ${JSON.stringify(value)} fails explicitly`,()=>assert.throws(()=>mapSessionSummary({...row,[key]:value})));
test('capped, missing or unknown-count responses cannot masquerade as complete history',()=>{for(const [data,count] of [[[row],2],[null,0],[[row],null]])assert.throws(()=>mapCompleteSummaryBatch(data,count));assert.equal(mapCompleteSummaryBatch([row],1).length,1);});

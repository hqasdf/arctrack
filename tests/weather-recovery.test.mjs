import test from 'node:test';
import assert from 'node:assert/strict';
import {WeatherIssue,weatherFailureState,weatherHttpIssue,weatherRetryAt} from '../packages/core/src/weather-model.ts';
for(const code of ['database_read','provider_unavailable','provider_rate_limit','persistence'])test(`weather ${code} preserves same-scope saved values including zero`,()=>{
  const previous={readings:[{sessionId:'one',temperatureC:0,windSpeedKph:0}],status:'ready'};
  const failed=weatherFailureState(previous,new WeatherIssue(code,500));assert.equal(failed.readings,previous.readings);assert.equal(failed.status,'unavailable');
});
for(const code of ['unauthenticated','forbidden'])test(`weather ${code} clears protected readings`,()=>{assert.deepEqual(weatherFailureState({readings:[{}]},new WeatherIssue(code,403,true)).readings,[]);});
test('retry metadata accepts seconds and HTTP dates but ignores malformed or expired values',()=>{
 const now=Date.parse('2026-10-31T00:00:00Z');assert.equal(weatherRetryAt('120',now),'2026-10-31T00:02:00.000Z');assert.equal(weatherRetryAt('bad',now),undefined);assert.equal(weatherRetryAt('Fri, 30 Oct 2026 00:00:00 GMT',now),undefined);
 assert.equal(weatherHttpIssue(503,null,null).noRetry,false);assert.equal(weatherHttpIssue(400,null,null).noRetry,true);
});

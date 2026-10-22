import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as model from "@arc-track/core/notes-feedback";

const require = createRequire(import.meta.url);
const actor="11111111-1111-4111-8111-111111111111", session="22222222-2222-4222-8222-222222222222", org="33333333-3333-4333-8333-333333333333", athlete="44444444-4444-4444-8444-444444444444", feedback="55555555-5555-4555-8555-555555555555";
const stamp="2026-10-22T00:00:00.000001Z";
const requestId="66666666-6666-4666-8666-666666666666";
const note={session_id:session,body:"Saved note",technique_tags:["Release"],created_at:stamp,updated_at:stamp};
const script=ts.transpileModule(readFileSync(new URL("../src/features/notes-feedback/actions.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

function runtime(options={}) {
  const rpcCalls=[], reads=[], refreshes=[];
  const client={auth:{getUser:async()=>({data:{user:options.user===null?null:{id:options.user??actor}},error:null})},
    from(table){const read={table,filters:[]};reads.push(read);const chain={select(value){read.select=value;return chain;},eq(key,value){read.filters.push([key,value]);return chain;},async maybeSingle(){if(table==="sessions")return {data:options.sessionMissing?null:{id:session},error:null};return {data:options.note??note,error:options.noteError??null};}};return chain;},
    async rpc(name,args){rpcCalls.push({name,args});if(options.rpcError)return {data:null,error:options.rpcError};if(name==="read_coach_feedback"&&options.visibleFeedback)return {data:options.visibleFeedback.filter(row=>!args.p_athlete_user_id||row.athlete_user_id===args.p_athlete_user_id),error:null};return {data:options.rpcData??(name==="save_session_notes"?[note]:name==="read_coach_feedback"?[]:name==="save_coach_feedback"?feedback:true),error:null};},
  };
  const exports={};
  new Function("require","exports",script)(name=>name==="@arc-track/core/notes-feedback"?model:name==="next/cache"?{revalidatePath:value=>refreshes.push(value)}:name==="@/lib/supabase/server"?{createAuthClient:async options=>{assert.equal(options.writable,true);return client;}}:name==="@/features/organizations/coach-read.server"?{readCoachAthletes:async id=>{assert.equal(id,org);return options.noRoster?[]:[{userId:athlete}];}}:require(name),exports);
  return {actions:exports,rpcCalls,reads,refreshes};
}

test("website notes reader checks exact signed-in actor and authoritative own Session before note lookup",async()=>{
  const h=runtime();const result=await h.actions.loadSessionNote({viewerId:actor,sessionId:session});assert.equal(result.ok,true);assert.deepEqual(h.reads[0].filters,[["id",session],["user_id",actor]]);assert.equal(h.reads[1].table,"session_notes");assert.equal(result.data.body,"Saved note");
});

test("account switch, signed-out identity and unavailable Session fail closed without feature reads or writes",async()=>{
  for(const options of [{user:athlete},{user:null},{sessionMissing:true}]){const h=runtime(options);const result=await h.actions.loadSessionNote({viewerId:actor,sessionId:session});assert.equal(result.ok,false);assert.equal(h.reads.some(read=>read.table==="session_notes"),false);assert.equal(h.rpcCalls.length,0);}
});

test("coach note reads validate the active exact-organisation roster and correct Session athlete",async()=>{
  const h=runtime();assert.equal((await h.actions.loadSessionNote({viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session})).ok,true);assert.deepEqual(h.reads[0].filters,[["id",session],["user_id",athlete]]);
  const missing=runtime({noRoster:true});assert.equal((await missing.actions.loadSessionNote({viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session})).ok,false);assert.equal(missing.reads.length,0);
});

test("note writes use guarded RPC, trimmed bounded values and original microsecond revision without direct table mutation",async()=>{
  const h=runtime();const context={viewerId:actor,sessionId:session};const result=await h.actions.saveSessionNote(context,"  Note  ",[" Release ","Release"],stamp);assert.equal(result.ok,true);assert.deepEqual(h.rpcCalls,[{name:"save_session_notes",args:{p_session_id:session,p_body:"Note",p_technique_tags:["Release"],p_expected_updated_at:stamp}}]);assert.deepEqual(h.refreshes,["/sessions"]);
});

test("coaches cannot invoke note save/delete and blank/oversize notes never reach RPC",async()=>{
  const h=runtime();const coach={viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session};assert.equal((await h.actions.saveSessionNote(coach,"Note",[],stamp)).ok,false);assert.equal((await h.actions.removeSessionNote(coach,stamp)).ok,false);
  for(const body of [" ","x".repeat(4001)]) assert.equal((await h.actions.saveSessionNote({viewerId:actor,sessionId:session},body,[],null)).ok,false);assert.equal(h.rpcCalls.length,0);
});

test("missing schema and optimistic conflict are visible failures with no fake write success",async()=>{
  for(const code of ["PGRST202","40001","42501"]){const h=runtime({rpcError:{code,message:"unsafe internal detail"}});const result=await h.actions.saveSessionNote({viewerId:actor,sessionId:session},"Note",[],null);assert.equal(result.ok,false);assert.equal(result.message,model.notesFeedbackError({code}));assert.doesNotMatch(result.message,/unsafe internal detail/);assert.equal(h.refreshes.length,0);}
});

test("feedback history explicitly filters the signed-in recipient, with stable cursor and fixed page bound",async()=>{
  const h=runtime();assert.equal((await h.actions.loadCoachFeedback({viewerId:actor},{createdAt:stamp,id:feedback})).ok,true);assert.deepEqual(h.rpcCalls[0],{name:"read_coach_feedback",args:{p_athlete_user_id:actor,p_organization_id:null,p_session_id:null,p_kind:"session",p_before_created_at:stamp,p_before_id:feedback,p_limit:25}});assert.equal(h.reads.length,0);
});

test("a coach opening their own Sessions history cannot mix authored feedback addressed to other athletes into recipient history",async()=>{
  const base={organization_id:org,author_user_id:actor,kind:"session",session_id:session,created_at:stamp,updated_at:stamp,author_display_name:"Coach",can_edit:true};
  const h=runtime({visibleFeedback:[{...base,id:feedback,athlete_user_id:athlete,body:"Authored for another athlete"},{...base,id:session,athlete_user_id:actor,body:"Addressed to this actor"}]});
  const history=await h.actions.loadCoachFeedback({viewerId:actor});
  await h.actions.loadCoachFeedback({viewerId:actor,sessionId:session,kind:"session"});
  const coachView=await h.actions.loadCoachFeedback({viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session});
  assert.equal(history.ok,true);assert.deepEqual(history.data.entries.map(entry=>entry.body),["Addressed to this actor"]);
  assert.equal(coachView.ok,true);assert.deepEqual(coachView.data.entries.map(entry=>entry.body),["Authored for another athlete"]);
  assert.equal(h.rpcCalls[0].args.p_athlete_user_id,actor);
  assert.equal(h.rpcCalls[1].args.p_athlete_user_id,actor);
  assert.equal(h.rpcCalls[2].args.p_athlete_user_id,athlete);
  assert.equal(h.rpcCalls[2].args.p_organization_id,org);
});

test("coach feedback writes preserve exact immutable context and derive authorship only in guarded RPC",async()=>{
  const h=runtime();const context={viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session,kind:"session"};assert.equal((await h.actions.saveCoachFeedback(context,feedback," Feedback ",stamp)).ok,true);assert.deepEqual(h.rpcCalls[0],{name:"save_coach_feedback",args:{p_feedback_id:feedback,p_organization_id:org,p_athlete_user_id:athlete,p_kind:"session",p_session_id:session,p_body:"Feedback",p_expected_updated_at:stamp,p_creation_request_id:null}});assert.equal("p_author_user_id" in h.rpcCalls[0].args,false);assert.ok(h.refreshes.includes(`/organization/${org}/athletes/${athlete}/sessions/${session}`));
});

test("Session feedback requires a Session; feedback deletion confirms true and retains revision",async()=>{
  const h=runtime();const context={viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session};assert.equal((await h.actions.saveCoachFeedback(context,null,"Session feedback",null,requestId)).ok,true);assert.equal(h.rpcCalls[0].args.p_session_id,session);assert.equal(h.rpcCalls[0].args.p_creation_request_id,requestId);assert.equal(h.reads.length,0);
  assert.equal((await h.actions.removeCoachFeedback(context,feedback,stamp)).ok,true);assert.deepEqual(h.rpcCalls[1],{name:"delete_coach_feedback",args:{p_feedback_id:feedback,p_expected_updated_at:stamp}});
  const failed=runtime({rpcData:false});assert.equal((await failed.actions.removeCoachFeedback(context,feedback,stamp)).ok,false);assert.equal(failed.refreshes.length,0);
});

test("editing retained Session feedback passes Session kind with null Session reference rather than converting it to general",async()=>{
  const h=runtime();const context={viewerId:actor,organizationId:org,athleteUserId:athlete,kind:"session"};
  assert.equal((await h.actions.saveCoachFeedback(context,feedback,"Updated retained feedback",stamp)).ok,true);
  assert.equal(h.rpcCalls[0].args.p_kind,"session");assert.equal(h.rpcCalls[0].args.p_session_id,null);assert.equal(h.rpcCalls[0].args.p_feedback_id,feedback);assert.equal(h.rpcCalls[0].args.p_expected_updated_at,stamp);
});

test("coach feedback requires both exact organisation and active athlete roster even for direct server-action calls",async()=>{
  const h=runtime({noRoster:true});assert.equal((await h.actions.saveCoachFeedback({viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session},null,"Shared",null,requestId)).ok,false);assert.equal((await h.actions.removeCoachFeedback({viewerId:actor},feedback,stamp)).ok,false);assert.equal(h.rpcCalls.length,0);
});

test("feedback creation requires a valid request UUID and edits cannot adopt a creation identity",async()=>{
  const context={viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session};const h=runtime();
  for(const key of [undefined,null,"","invalid-id",123])assert.equal((await h.actions.saveCoachFeedback(context,null,"Shared",null,key)).ok,false);
  assert.equal((await h.actions.saveCoachFeedback(context,feedback,"Edited",stamp,requestId)).ok,false);assert.equal(h.rpcCalls.length,0);
});

test("retry creates retain request identity and exact context; database scope rejection is safe",async()=>{
  const context={viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session};const h=runtime();
  await h.actions.saveCoachFeedback(context,null,"Same submission",null,requestId);await h.actions.saveCoachFeedback(context,null,"Same submission",null,requestId);assert.deepEqual(h.rpcCalls[0],h.rpcCalls[1]);
  const mismatch=runtime({rpcError:{code:"22023",message:"private mismatched request body detail"}});const result=await mismatch.actions.saveCoachFeedback(context,null,"Changed payload",null,requestId);assert.equal(result.ok,false);assert.doesNotMatch(result.message,/private mismatched/);assert.equal(mismatch.refreshes.length,0);
  const switched=runtime({user:athlete});assert.equal((await switched.actions.saveCoachFeedback(context,null,"Same submission",null,requestId)).ok,false);assert.equal(switched.rpcCalls.length,0);
});

test("feedback operation-budget exhaustion displays the exact safe message without masking other backend errors",async()=>{
  const context={viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session};const h=runtime({rpcError:{code:"P0001",message:"Too many feedback entries. Try again shortly."}});const result=await h.actions.saveCoachFeedback(context,null,"Shared",null,requestId);assert.equal(result.ok,false);assert.equal(result.message,"Too many feedback entries. Try again shortly.");assert.equal(h.refreshes.length,0);
  const unexpected=runtime({rpcError:{code:"P0001",message:"private unrelated database details"}});const hidden=await unexpected.actions.saveCoachFeedback(context,null,"Shared",null,requestId);assert.equal(hidden.ok,false);assert.doesNotMatch(hidden.message,/private unrelated database details/);
});

test("new feedback without a Session is rejected before RPC", async()=>{const h=runtime();const result=await h.actions.saveCoachFeedback({viewerId:actor,organizationId:org,athleteUserId:athlete},null,"Not linked",null,requestId);assert.equal(result.ok,false);assert.equal(h.rpcCalls.length,0);});

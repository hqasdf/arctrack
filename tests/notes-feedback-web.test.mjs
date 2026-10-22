import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import * as model from "@arc-track/core/notes-feedback";

const require = createRequire(import.meta.url);
const actor = "11111111-1111-4111-8111-111111111111", session = "22222222-2222-4222-8222-222222222222", org = "33333333-3333-4333-8333-333333333333", athlete = "44444444-4444-4444-8444-444444444444";
const stamp = "2026-10-22T00:00:00.000001Z";
const note = { sessionId: session, body: "Saved observation", techniqueTags: ["Release"], createdAt: stamp, updatedAt: stamp };
const entry = { id: "55555555-5555-4555-8555-555555555555", organizationId: org, athleteUserId: athlete, authorUserId: actor, authorDisplayName: "Test coach", kind: "session", sessionId: session, body: "Keep a steady rhythm.", createdAt: stamp, updatedAt: stamp, canEdit: true };
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : String(node ?? "");

function ui(file, actions, opts = {}) {
  const slots = []; let cursor = 0, queue = [], dirty = false, confirm = true, entropy = 0;
  const same = (a,b) => a && b && a.length === b.length && a.every((item,i) => Object.is(item,b[i]));
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useId() { return hooks.useRef("notes-test").current; },
    useTransition() { return [false, fn => { void fn(); }]; },
    useEffect(fn,deps) { const i = cursor++; if (!same(slots[i]?.deps,deps)) { const previous = slots[i]; slots[i] = {deps}; queue.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL(`../src/features/notes-feedback/${file}`,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports = {};
  new Function("require","exports","window",compiled)(name => name === "react" ? hooks : name === "./actions" ? actions : name === "@arc-track/core/notes-feedback" ? model : name === "./draft-guard" ? { useDraftGuard: value => { dirty = value; }, confirmDraftNavigation: value => !value || confirm } : name.endsWith(".css") ? {__esModule:true,default:new Proxy({},{get:(_,key)=>key})} : require(name),exports,{confirm:()=>confirm,crypto:opts.noCrypto?undefined:{getRandomValues:bytes=>bytes.fill(++entropy)}});
  let tree;
  const render = (props = opts.props) => { cursor=0; let result = file.startsWith("session") ? exports.SessionNotesPanel(props) : exports.CoachFeedbackPanel(props); tree = result.type(result.props); const pending = queue; queue=[]; pending.forEach(fn=>fn()); return tree; };
  return {render, nodes:()=>nodes(tree), text:()=>text(tree), dirty:()=>dirty, confirm:value=>{confirm=value;}, click(label){const button=nodes(tree).find(node=>node.type==="button" && text(node)===label);assert.ok(button,`Missing ${label}`);button.props.onClick?.();}, change(value){const field=nodes(tree).find(node=>node.type==="textarea");assert.ok(field);field.props.onChange({target:{value}});}, dispose(){slots.forEach(slot=>slot?.cleanup?.());}};
}

test("notes load and edit persists exact optimistic revision, with only one pending save", async () => {
  const writes=[], gate=deferred();
  const h=ui("session-notes-panel.tsx",{loadSessionNote:async()=>({ok:true,data:note}),saveSessionNote:(...args)=>{writes.push(args);return gate.promise;}},{props:{context:{viewerId:actor,sessionId:session}}});
  h.render();await tick();h.render();assert.match(h.text(),/Saved observation/);h.click("Edit notes");h.render();h.change("Updated observation");h.render();assert.equal(h.dirty(),true);h.click("Save notes");h.click("Save notes");assert.equal(writes.length,1);assert.equal(writes[0][3],stamp);
  gate.resolve({ok:true,data:{...note,body:"Updated observation",updatedAt:"later"}});await tick();h.render();assert.match(h.text(),/Session Notes saved/);assert.equal(h.dirty(),false);h.dispose();
});

test("notes failed and conflicting saves preserve the draft and expose deliberate latest reload", async () => {
  const h=ui("session-notes-panel.tsx",{loadSessionNote:async()=>({ok:true,data:note}),saveSessionNote:async()=>({ok:false,message:model.notesFeedbackError({code:"40001"})})},{props:{context:{viewerId:actor,sessionId:session}}});
  h.render();await tick();h.render();h.click("Edit notes");h.render();h.change("Unsaved corrected rhythm");h.render();h.click("Save notes");await tick();h.render();assert.equal(h.nodes().find(n=>n.type==="textarea").props.value,"Unsaved corrected rhythm");assert.match(h.text(),/another device/);assert.match(h.text(),/Discard draft and reload latest note/);h.dispose();
});

test("missing migration load is an error, never a fabricated empty note or enabled create", async () => {
  const h=ui("session-notes-panel.tsx",{loadSessionNote:async()=>({ok:false,message:model.notesFeedbackError({code:"42P01"})})},{props:{context:{viewerId:actor,sessionId:session}}});
  h.render();await tick();h.render();assert.match(h.text(),/database update has not been applied/);assert.doesNotMatch(h.text(),/No Session Notes yet|Add notes/);h.dispose();
});

test("coach note view has neither edit nor delete controls", async () => {
  const h=ui("session-notes-panel.tsx",{loadSessionNote:async()=>({ok:true,data:note})},{props:{context:{viewerId:actor,sessionId:session,organizationId:org,athleteUserId:athlete},readOnly:true}});
  h.render();await tick();h.render();assert.match(h.text(),/Saved observation/);assert.doesNotMatch(h.text(),/Edit notes|Delete notes/);h.dispose();
});

test("cancel and delete confirmations protect a dirty note and delete its exact revision only", async () => {
  const deletes=[];
  const h=ui("session-notes-panel.tsx",{loadSessionNote:async()=>({ok:true,data:note}),removeSessionNote:async(...args)=>{deletes.push(args);return {ok:true,data:null};}},{props:{context:{viewerId:actor,sessionId:session}}});
  h.render();await tick();h.render();h.click("Edit notes");h.render();h.change("Draft");h.render();h.confirm(false);h.click("Cancel");h.render();assert.equal(h.nodes().find(n=>n.type==="textarea").props.value,"Draft");h.confirm(true);h.click("Cancel");h.render();h.confirm(false);h.click("Delete notes");assert.equal(deletes.length,0);h.confirm(true);h.click("Delete notes");await tick();h.render();assert.equal(deletes[0][1],stamp);assert.match(h.text(),/Session Notes deleted/);h.dispose();
});

test("late note responses after disposal never update another editor", async () => {
  const gate=deferred(); const h=ui("session-notes-panel.tsx",{loadSessionNote:()=>gate.promise},{props:{context:{viewerId:actor,sessionId:session}}});
  h.render();await tick();h.dispose();gate.resolve({ok:true,data:note});await tick();h.render();assert.doesNotMatch(h.text(),/Saved observation/);
});

test("feedback recipient sees attribution, edited dates, retained Session kind and unavailable organisation", async () => {
  const h=ui("coach-feedback-panel.tsx",{loadCoachFeedback:async()=>({ok:true,data:{entries:[{...entry,sessionId:null,organizationId:null,authorUserId:null,updatedAt:"2026-10-23T00:00:00Z"}],hasMore:false}})},{props:{context:{viewerId:athlete},history:true}});
  h.render();await tick();h.render();assert.match(h.text(),/Former coach/);assert.match(h.text(),/original Session deleted/);assert.match(h.text(),/Organisation no longer available/);assert.match(h.text(),/Edited/);assert.doesNotMatch(h.text(),/Edit feedback|Delete feedback|Add feedback/);h.dispose();
});

test("coach can edit own exact-organisation entries, cannot edit another author's entries even if malformed capability says yes", async () => {
  const h=ui("coach-feedback-panel.tsx",{loadCoachFeedback:async()=>({ok:true,data:{entries:[entry,{...entry,id:"other",authorUserId:"other"},{...entry,id:"otherorg",organizationId:"other"}],hasMore:false}})},{props:{context:{viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session,kind:"session"}}});
  h.render();await tick();h.render();assert.equal(h.nodes().filter(n=>n.type==="button"&&text(n)==="Edit feedback").length,1);assert.match(h.text(),/Other coaches cannot read/);h.dispose();
});

test("feedback save preserves draft on network failure and uses original revision for edits", async () => {
  const writes=[];const h=ui("coach-feedback-panel.tsx",{loadCoachFeedback:async()=>({ok:true,data:{entries:[entry],hasMore:false}}),saveCoachFeedback:async(...args)=>{writes.push(args);throw new Error("offline");}},{props:{context:{viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session,kind:"session"}}});
  h.render();await tick();h.render();h.click("Edit feedback");h.render();h.change("Changed feedback");h.render();h.nodes().find(n=>n.type==="form").props.onSubmit({preventDefault(){}});await tick();h.render();assert.equal(writes[0][3],stamp);assert.equal(h.nodes().find(n=>n.type==="textarea").props.value,"Changed feedback");assert.match(h.text(),/draft is preserved/);h.dispose();
});

test("Coach Athlete history reads all own feedback and edits deleted-Session feedback with its immutable Session kind",async()=>{
  const reads=[],writes=[];const deleted={...entry,sessionId:null};
  const context={viewerId:actor,organizationId:org,athleteUserId:athlete};
  const h=ui("coach-feedback-panel.tsx",{loadCoachFeedback:async(...args)=>{reads.push(args);return {ok:true,data:{entries:[deleted],hasMore:false}};},saveCoachFeedback:async(...args)=>{writes.push(args);return {ok:false,message:"Conflict"};}},{props:{context,history:true}});
  h.render();await tick();h.render();assert.equal(reads[0][0].kind,undefined);assert.equal(reads[0][0].athleteUserId,athlete);assert.match(h.text(),/original Session deleted/);assert.doesNotMatch(h.text(),/New entries here|New general/);
  h.click("Edit feedback");h.render();h.change("Revised historical feedback");h.render();h.nodes().find(n=>n.type==="form").props.onSubmit({preventDefault(){}});await tick();h.render();
  assert.equal(writes[0][0].sessionId,undefined);assert.equal(writes[0][1],entry.id);assert.equal(writes[0][3],stamp);h.dispose();
});

test("Session history has no standalone composer and Session Review keeps its exact filter",async()=>{
  const reads=[];const actions={loadCoachFeedback:async(...args)=>{reads.push(args);return {ok:true,data:{entries:[],hasMore:false}};}};
  const history=ui("coach-feedback-panel.tsx",actions,{props:{context:{viewerId:actor,organizationId:org,athleteUserId:athlete},history:true}});history.render();await tick();history.render();assert.doesNotMatch(history.text(),/Add feedback|New general/);history.dispose();
  const review=ui("coach-feedback-panel.tsx",actions,{props:{context:{viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session}}});review.render();await tick();review.render();assert.equal(reads.at(-1)[0].sessionId,session);assert.match(review.text(),/Add feedback/);review.dispose();
});

test("feedback history pagination uses stable created-at and id cursor and removes duplicate page entries", async () => {
  const reads=[];const h=ui("coach-feedback-panel.tsx",{loadCoachFeedback:async(...args)=>{reads.push(args);return {ok:true,data:{entries:reads.length===1?[entry]:[entry,{...entry,id:"older",body:"Older entry"}],hasMore:reads.length===1}};}},{props:{context:{viewerId:athlete},history:true}});
  h.render();await tick();h.render();h.click("Load older feedback");await tick();h.render();assert.deepEqual(reads[1][1],{createdAt:stamp,id:entry.id});assert.equal(h.nodes().filter(n=>n.type==="article").length,2);assert.match(h.text(),/Older entry/);h.dispose();
});

test("integrations key Session and actor lifecycles, guard in-page exits, and expose only Session feedback history", () => {
  const source=readFileSync(new URL("../src/features/sessions/components/sessions-workspace.tsx",import.meta.url),"utf8");
  assert.match(source,/key=\{`notes:\$\{viewerId\}:\$\{session.id\}`\}/);assert.match(source,/if\(!mayLeaveNotes\(\)\)return;setActiveRoundId/);assert.match(source,/if\(mayLeaveNotes\(\)\)setView\("sessions"\)/);assert.match(source,/async function startRound\(\) \{ if \(!mayLeaveNotes\(\)\) return/);
  const coach=readFileSync(new URL("../src/features/organizations/components/coach-athlete-detail.tsx",import.meta.url),"utf8");assert.doesNotMatch(coach,/kind: "general"/);assert.match(coach,/Scoring records are read only/);
});

test("dirty-draft guard covers links, refresh/close, modern traversal and legacy history restoration", () => {
  const compiled=ts.transpileModule(readFileSync(new URL("../src/features/notes-feedback/draft-guard.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  for(const modern of [true,false]){
    const windowEvents=new Map(), documentEvents=new Map(), navigationEvents=new Map(), restores=[];let cleanup,confirmed=false;
    const win={confirm:()=>confirmed,location:{href:"https://example.test/sessions"},history:{state:{route:"sessions"},pushState:(...args)=>restores.push(args)},addEventListener:(name,fn)=>windowEvents.set(name,fn),removeEventListener:name=>windowEvents.delete(name)};
    if(modern)win.navigation={addEventListener:(name,fn)=>navigationEvents.set(name,fn),removeEventListener:name=>navigationEvents.delete(name)};
    const doc={addEventListener:(name,fn)=>documentEvents.set(name,fn),removeEventListener:name=>documentEvents.delete(name)};
    const exports={};new Function("require","exports","window","document",compiled)(name=>name==="react"?{useEffect:fn=>{cleanup=fn();}}:require(name),exports,win,doc);
    exports.useDraftGuard(true);let prevented=false,stopped=false;
    windowEvents.get("beforeunload")({preventDefault(){prevented=true;}});assert.equal(prevented,true);
    prevented=false;documentEvents.get("click")({button:0,target:{closest:()=>({href:"https://example.test/profile",target:"",hasAttribute:()=>false})},preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});assert.equal(prevented,true);assert.equal(stopped,true);
    if(modern){prevented=false;navigationEvents.get("navigate")({navigationType:"traverse",cancelable:true,preventDefault(){prevented=true;}});assert.equal(prevented,true);}
    else {stopped=false;windowEvents.get("popstate")({stopImmediatePropagation(){stopped=true;}});assert.equal(stopped,true);assert.equal(restores[0][2],win.location.href);}
    confirmed=true;assert.equal(exports.confirmDraftNavigation(true),true);cleanup();assert.equal(windowEvents.size,0);assert.equal(documentEvents.size,0);assert.equal(navigationEvents.size,0);
  }
});

test("note validation shows useful bounds, keeps text and never invokes saving for an empty body",async()=>{
  let saves=0;const h=ui("session-notes-panel.tsx",{loadSessionNote:async()=>({ok:true,data:null}),saveSessionNote:async()=>{saves++;}},{props:{context:{viewerId:actor,sessionId:session}}});
  h.render();await tick();h.render();h.click("Add notes");h.render();h.change(" ");h.render();h.click("Save notes");h.render();assert.match(h.text(),/between 1 and 4,000 characters/);assert.equal(saves,0);assert.equal(h.nodes().find(n=>n.type==="textarea").props.value," ");h.dispose();
});

test("response-lost creation retries the same request and original body after refreshing history, without a duplicate",async()=>{
  const rows=new Map(),writes=[];let loseResponse=true;
  const context={viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session};
  const actions={loadCoachFeedback:async()=>({ok:true,data:{entries:[...rows.values()],hasMore:false}}),saveCoachFeedback:async(...args)=>{
    writes.push(args);const [scope,,body,,key]=args;assert.ok(key);const previous=rows.get(key);
    if(previous){assert.equal(previous.body,body);assert.equal(previous.organizationId,scope.organizationId);}
    else rows.set(key,{...entry,id:key,body,kind:"session",sessionId:null});
    if(loseResponse){loseResponse=false;throw new Error("response lost after commit");}return {ok:true,data:key};
  }};
  const h=ui("coach-feedback-panel.tsx",actions,{props:{context,history:true}});const submit=()=>h.nodes().find(node=>node.type==="form").props.onSubmit({preventDefault(){}});
  h.render();await tick();h.render();h.click("Add feedback");h.render();h.change("First submission");h.render();submit();await tick();h.render();assert.match(h.text(),/Retry original submission/);assert.equal(rows.size,1);assert.equal(h.nodes().find(n=>n.type==="textarea").props.value,"First submission");
  h.click("Refresh history, keep draft");h.render();await tick();h.render();submit();await tick();h.render();assert.equal(rows.size,1);assert.equal(writes[0][4],writes[1][4]);assert.equal(writes[0][2],writes[1][2]);assert.match(h.text(),/Feedback saved and shared/);
  h.click("Add feedback");h.render();h.change("First submission");h.render();submit();await tick();h.render();assert.equal(rows.size,2);assert.notEqual(writes[2][4],writes[0][4]);h.dispose();
});

test("changed text after uncertain creation cannot silently reuse its key for a different payload",async()=>{
  const writes=[];const context={viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session};
  const h=ui("coach-feedback-panel.tsx",{loadCoachFeedback:async()=>({ok:true,data:{entries:[],hasMore:false}}),saveCoachFeedback:async(...args)=>{writes.push(args);throw new Error("response lost");}},{props:{context}});const submit=()=>h.nodes().find(n=>n.type==="form").props.onSubmit({preventDefault(){}});
  h.render();await tick();h.render();h.click("Add feedback");h.render();h.change("Original payload");h.render();submit();await tick();h.render();h.change("Changed payload");h.render();h.confirm(false);submit();await tick();assert.equal(writes.length,1);
  h.confirm(true);submit();await tick();h.render();assert.equal(writes[1][2],"Original payload");assert.equal(writes[1][4],writes[0][4]);assert.equal(h.nodes().find(n=>n.type==="textarea").props.value,"Changed payload");
  h.click("Start a different entry");h.render();submit();await tick();h.render();assert.equal(writes[2][2],"Changed payload");assert.notEqual(writes[2][4],writes[0][4]);h.dispose();
});

test("secure entropy absence fails visibly without submitting or fabricating a request identity",async()=>{
  let writes=0;const h=ui("coach-feedback-panel.tsx",{loadCoachFeedback:async()=>({ok:true,data:{entries:[],hasMore:false}}),saveCoachFeedback:async()=>{writes++;}},{props:{context:{viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session}},noCrypto:true});
  h.render();await tick();h.render();h.click("Add feedback");h.render();h.change("Keep this draft");h.render();h.nodes().find(n=>n.type==="form").props.onSubmit({preventDefault(){}});h.render();assert.equal(writes,0);assert.match(h.text(),/HTTPS in a supported browser/);assert.equal(h.nodes().find(n=>n.type==="textarea").props.value,"Keep this draft");h.dispose();
});

test("feedback budget errors remain visible with both retry identity and draft intact",async()=>{
  const writes=[];const h=ui("coach-feedback-panel.tsx",{loadCoachFeedback:async()=>({ok:true,data:{entries:[],hasMore:false}}),saveCoachFeedback:async(...args)=>{writes.push(args);return {ok:false,message:model.notesFeedbackError({code:"P0001",message:"Too many feedback entries. Try again shortly."})};}},{props:{context:{viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session}}});
  h.render();await tick();h.render();h.click("Add feedback");h.render();h.change("Preserved feedback");h.render();h.nodes().find(n=>n.type==="form").props.onSubmit({preventDefault(){}});await tick();h.render();assert.match(h.text(),/Too many feedback entries\. Try again shortly\./);assert.equal(h.nodes().find(n=>n.type==="textarea").props.value,"Preserved feedback");h.nodes().find(n=>n.type==="form").props.onSubmit({preventDefault(){}});await tick();h.render();assert.equal(writes[0][4],writes[1][4]);h.dispose();
});

test("an in-flight creation identity cannot be reused after the actor or athlete scope changes",async()=>{
  const writes=[];const props={context:{viewerId:actor,organizationId:org,athleteUserId:athlete,sessionId:session}};
  const h=ui("coach-feedback-panel.tsx",{loadCoachFeedback:async()=>({ok:true,data:{entries:[],hasMore:false}}),saveCoachFeedback:async(...args)=>{writes.push(args);throw new Error("uncertain response");}},{props});
  h.render();await tick();h.render();h.click("Add feedback");h.render();h.change("Original athlete");h.render();h.nodes().find(n=>n.type==="form").props.onSubmit({preventDefault(){}});await tick();h.render();assert.equal(writes.length,1);
  // Real React remounts the keyed editor. Deliberately retain hooks here to
  // exercise the additional scope check before a retained key can be sent.
  props.context={...props.context,athleteUserId:actor};h.render();await tick();h.render();h.nodes().find(n=>n.type==="form").props.onSubmit({preventDefault(){}});h.render();assert.equal(writes.length,1);assert.match(h.text(),/account or feedback context changed/);h.dispose();
});

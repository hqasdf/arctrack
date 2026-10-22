import assert from "node:assert/strict";
import test from "node:test";
import { createFeedbackRequestId, FEEDBACK_BUDGET_MESSAGE, FEEDBACK_REQUEST_CONFLICT_MESSAGE, prepareSessionNote, prepareFeedbackBody, parseTechniqueTags, mapSessionNote, mapCoachFeedback, notesFeedbackError } from "../src/notes-feedback.ts";
test("notes validate trimmed Unicode text and optional bounded deduplicated tags", () => {
  assert.deepEqual(prepareSessionNote(" Release focus ", [" release ", "release", "tempo"]), { body: "Release focus", techniqueTags: ["release", "tempo"] });
  assert.equal(prepareFeedbackBody("\u{1F3F9}".repeat(4000)).length, 8000);
  assert.equal(prepareSessionNote("A", ["\u{1F3F9}".repeat(40)]).techniqueTags.length, 1);
  assert.deepEqual(parseTechniqueTags("release, tempo,,"), ["release", "tempo"]);
  for (const body of ["", " \n ", "x".repeat(4001), "a\0b"]) assert.throws(() => prepareFeedbackBody(body));
  assert.throws(() => prepareSessionNote("A", Array.from({ length: 9 }, (_, i) => String(i))));
  assert.throws(() => prepareSessionNote("A", ["x".repeat(41)]));
});
test("mapping preserves author, subject, deleted context, timestamps and plain text", () => {
  assert.deepEqual(mapSessionNote({ session_id: "s", body: "<not HTML>", technique_tags: [], created_at: "created", updated_at: "edited" }), { sessionId: "s", body: "<not HTML>", techniqueTags: [], createdAt: "created", updatedAt: "edited" });
  const feedback = mapCoachFeedback({ id: "f", organization_id: null, athlete_user_id: "athlete", author_user_id: null, kind: "session", session_id: null, body: "Preserved history", created_at: "created", updated_at: "edited", author_display_name: null, can_edit: false });
  assert.equal(feedback.kind, "session"); assert.equal(feedback.sessionId, null); assert.equal(feedback.authorUserId, null); assert.equal(feedback.canEdit, false); assert.equal(feedback.athleteUserId, "athlete");
});
test("unavailable migrations, conflicts and revoked access never become empty/success", () => {
  assert.match(notesFeedbackError({ code: "42P01", message: "secret db message" }), /not been applied/);
  assert.match(notesFeedbackError({ code: "PGRST202" }), /not available/);
  assert.match(notesFeedbackError({ code: "40001" }), /draft is kept/);
  assert.match(notesFeedbackError({ code: "42501" }), /permission/);
  assert.doesNotMatch(notesFeedbackError({ message: "private db details" }), /private db details/);
});
test("feedback mapping rejects the removed standalone kind without rejecting retained Session Feedback", () => {
  const row = { id: "f", organization_id: null, athlete_user_id: "athlete", author_user_id: null, kind: "session", session_id: null, body: "Preserved history", created_at: "created", updated_at: "edited", author_display_name: null, can_edit: false };
  assert.equal(mapCoachFeedback(row).sessionId, null);
  assert.throws(() => mapCoachFeedback({ ...row, kind: "general" }), /Only Session Feedback/);
});
test("shared creation IDs use supplied platform entropy, RFC 4122 v4 and do not modify the source", () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);
  assert.equal(createFeedbackRequestId(size => { assert.equal(size, 16); return bytes; }), "00010203-0405-4607-8809-0a0b0c0d0e0f");
  assert.equal(bytes[6], 6);
  assert.equal(bytes[8], 8);
  assert.notEqual(createFeedbackRequestId(() => new Uint8Array(16)), createFeedbackRequestId(() => new Uint8Array(16).fill(255)));
  for (const source of [() => new Uint8Array(15), () => [], () => { throw new Error("native secret details"); }]) {
    assert.throws(() => createFeedbackRequestId(source), error => /secure feedback request/.test(error.message) && !/secret/.test(error.message));
  }
});
test("only audited feedback budget and request-conflict errors expose their safe messages", () => {
  assert.equal(notesFeedbackError({ code: "P0001", message: FEEDBACK_BUDGET_MESSAGE }), FEEDBACK_BUDGET_MESSAGE);
  assert.equal(notesFeedbackError({ code: "22023", message: FEEDBACK_REQUEST_CONFLICT_MESSAGE }), FEEDBACK_REQUEST_CONFLICT_MESSAGE);
  assert.doesNotMatch(notesFeedbackError({ code: "P0001", message: "private SQL details" }), /private SQL details/);
  assert.doesNotMatch(notesFeedbackError({ code: "22023", message: "private SQL details" }), /private SQL details/);
});

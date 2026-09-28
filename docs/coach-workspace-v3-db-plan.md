# Coach Workspace persistence proposal — not applied

The current Coach Workspace remains read-only. Its **Needs Review** list is derived from recent completed or Competition Sessions; it does not imply an unread or reviewed state. Coach Notes and Saved Views are not shown as saved controls because they need cross-device persistence.

The exact proposed SQL is in [`supabase/proposals/coach_workspace_v3_future.sql`](../supabase/proposals/coach_workspace_v3_future.sql). The rollback fixture is in [`supabase/proposals/coach_workspace_v3_fixture.sql`](../supabase/proposals/coach_workspace_v3_fixture.sql). Neither has been run or applied.

| Future feature | Schema | RLS and grant boundary | Indexes | Reason |
| --- | --- | --- | --- | --- |
| Organisation review state | `coach_session_reviews`, one row per organisation and Session; reviewer and review time | Active Head Coach of the selected organisation and active Archer owner of the Session; no Archer access; authenticated CRUD only | `(organization_id, reviewed_at desc)` plus unique `(organization_id, session_id)` | Shared cross-device review status, independent of athlete scoring |
| Coach Notes | `coach_notes`, Session-level text with author and timestamps | Active Head Coaches may read; only the author may edit/delete while still an active Head Coach; no Archer access | `(organization_id, session_id, created_at desc)` | Persistent Coach observations without editing Arrow data |
| Saved Views | `coach_saved_views`, Coach-owned name and JSON filter object | Only the owning active Head Coach may see or mutate their preset; no other Coach or Archer access | `(coach_user_id, organization_id, created_at desc)` plus unique name per Coach and organisation | Reusable cross-device filters; no localStorage substitute |

`private.coach_can_access_session(organization_id, session_id)` is the narrow SECURITY DEFINER helper for review and note policies. It checks the current authenticated user is an active Head Coach of the specified organisation, the Session belongs to an active Archer member of that *same* organisation, and the Session ID matches. It uses an empty `search_path`, schema-qualified table/function references, revokes EXECUTE from PUBLIC/anon, and grants it only to authenticated. The saved-view policies use the existing `private.is_active_head_coach` helper. No service-role client is involved.

Before any production application, run the rollback fixture in a disposable database and verify: Coach access, Archer/anonymous/nonmember denial, cross-organisation isolation, owner-only saved views, leaving and rejoining access changes, review uniqueness, note author permissions, and no fixture rows after ROLLBACK. Review the proposed cascades (organisation or Session deletion removes corresponding Coach workflow records). The proposal does not alter existing Session, Round, End, Arrow, membership, or scoring policies.

After approval and application, the UI can add: Mark Reviewed/Unreviewed in Reviews, persistent notes in Session Review, and Save View in Analytics. Those controls should be implemented only after the SQL and its security fixture pass.

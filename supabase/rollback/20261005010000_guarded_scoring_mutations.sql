-- Emergency recovery approved for the guarded scoring mutation cutover.
-- Restore exactly the previous authenticated write grants. Keep SELECT, RLS,
-- and all new RPCs unchanged so new and old clients can coexist during recovery.
begin;
grant insert, delete on table public.sessions to authenticated;
grant update (arrow_count) on table public.sessions to authenticated;
grant insert, delete on table public.session_rounds to authenticated;
grant insert on table public.session_ends to authenticated;
grant insert, update, delete on table public.arrows to authenticated;
commit;

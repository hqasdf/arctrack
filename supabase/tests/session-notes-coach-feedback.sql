-- DISPOSABLE DATABASE ONLY, after all migrations. No live project execution authorized.
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/session-notes-coach-feedback.sql
-- Real authenticated/anon PostgreSQL roles; all fixture changes roll back.
begin;
select set_config('notes_test.passed', '0', true);
create function pg_temp.notes_id(p_name text) returns uuid language sql as $$
  select pg_catalog.current_setting('notes_test.' || p_name)::uuid;
$$;
create function pg_temp.notes_as(p_name text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.notes_id(p_name)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub',pg_temp.notes_id(p_name),'role','authenticated')::text, true);
end;
$$;
create function pg_temp.notes_assert(p_query text, p_label text)
returns void language plpgsql security invoker as $$
declare v_ok boolean;
begin
  execute p_query into v_ok;
  if v_ok is distinct from true then raise exception 'FAIL: %', p_label; end if;
  perform set_config('notes_test.passed', (current_setting('notes_test.passed')::integer + 1)::text, true);
end;
$$;
create function pg_temp.notes_expect(p_query text, p_state text, p_label text, p_message text default null)
returns void language plpgsql security invoker as $$
declare v_state text;
begin
  begin execute p_query;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> p_state then raise exception 'FAIL: %: expected %, got % (%)', p_label, p_state, v_state, sqlerrm; end if;
    if p_message is not null and sqlerrm <> p_message then raise exception 'FAIL: %: unsafe/unexpected error: %', p_label, sqlerrm; end if;
    perform set_config('notes_test.passed', (current_setting('notes_test.passed')::integer + 1)::text, true);
    return;
  end;
  raise exception 'FAIL: %: expected rejection %', p_label, p_state;
end;
$$;
do $$ declare v_name text;
begin
  foreach v_name in array array['athlete','other','coach_a','coach_a2','coach_b','session','other_session','org_a','org_b','request_primary','request_linked','request_b','request_invalid',
    'coach_budget','coach_budget2','athlete_budget','athlete_budget2','org_budget','org_budget2','budget_session',
    'request_budget','request_same_text','request_budget2','request_budget_session','request_budget_hour','request_rejected'] loop
    perform set_config('notes_test.' || v_name, gen_random_uuid()::text, true);
  end loop;
end;
$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
select pg_temp.notes_id(n), 'authenticated','authenticated','notes-' || pg_temp.notes_id(n) || '@example.invalid',now(),now(),now()
from unnest(array['athlete','other','coach_a','coach_a2','coach_b','coach_budget','coach_budget2','athlete_budget','athlete_budget2']) n;
update public.profiles set display_name = 'Example Coach A' where id = pg_temp.notes_id('coach_a');
insert into public.organizations(id,name,created_by) values
  (pg_temp.notes_id('org_a'),'Notes fixture A',pg_temp.notes_id('coach_a')),
  (pg_temp.notes_id('org_b'),'Notes fixture B',pg_temp.notes_id('coach_b'));
insert into public.organization_members(organization_id,user_id,role,status) values
  (pg_temp.notes_id('org_a'),pg_temp.notes_id('coach_a2'),'head_coach','active'),
  (pg_temp.notes_id('org_a'),pg_temp.notes_id('athlete'),'archer','active'),
  (pg_temp.notes_id('org_b'),pg_temp.notes_id('athlete'),'archer','active');
insert into public.sessions(id,user_id,title,session_date,session_type) values
  (pg_temp.notes_id('session'),pg_temp.notes_id('athlete'),'Example notes session',current_date,'training'),
  (pg_temp.notes_id('other_session'),pg_temp.notes_id('other'),'Other athlete session',current_date,'training');

select set_config('notes_test.feedback_session',gen_random_uuid()::text,true);
insert into public.sessions(id,user_id,title,session_date,session_type) values(pg_temp.notes_id('feedback_session'),pg_temp.notes_id('athlete'),'Feedback context',current_date,'training');

select pg_temp.notes_as('athlete');
set local role authenticated;
select pg_temp.notes_assert('select count(*) = 0 from public.session_notes where session_id = pg_temp.notes_id(''session'')','Notes initially absent');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''session''), '''', ''{}'', null)','22023','Empty note rejected');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''session''), E'' \n\t '', ''{}'', null)','22023','Whitespace note rejected');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''session''), repeat(''x'',4001), ''{}'', null)','22023','Oversize body rejected');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''session''), ''Valid'', array[repeat(''x'',41)], null)','22023','Oversize tag rejected');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''session''), ''Valid'', array[''''], null)','22023','Empty tag rejected');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''session''), ''Valid'', array[null]::text[], null)','22023','Null tag rejected');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''session''), ''Valid'', array[''1'',''2'',''3'',''4'',''5'',''6'',''7'',''8'',''9''], null)','22023','Ninth tag rejected');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''session''), ''Valid'', array[[''1'',''2'']], null)','22023','Multidimensional tags rejected');
select set_config('notes_test.note_version',updated_at::text,true) from public.save_session_notes(
  pg_temp.notes_id('session'),' Example technical focus ',array[' Release ','Release','release'],null);
select pg_temp.notes_assert('select body = ''Example technical focus'' and technique_tags = array[''Release'',''release''] and created_at = updated_at from public.session_notes where session_id = pg_temp.notes_id(''session'')','Create trims and deduplicates case-sensitive tags');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''session''), ''Overwrite'', ''{}'', null)','40001','Concurrent create cannot overwrite existing');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''session''), ''Stale'', ''{}'', now()-interval ''1 day'')','40001','Stale edit rejected');
select pg_temp.notes_expect('select public.delete_session_notes(pg_temp.notes_id(''session''), null)','40001','Delete requires edit version');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''other_session''), ''Forged'', ''{}'', null)','42501','Owner cannot write other session');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''session''), U&''\00A0\FEFF'', ''{}'', null)','22023','ECMAScript Unicode whitespace-only body rejected');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''session''), ''Valid'', null, null)','22023','Null tag array rejected');
select * from public.save_session_notes(pg_temp.notes_id('session'),repeat('界',4000),array[repeat('界',40)],current_setting('notes_test.note_version')::timestamptz);
select pg_temp.notes_assert('select char_length(body)=4000 and char_length(technique_tags[1])=40 and updated_at > created_at from public.session_notes where session_id=pg_temp.notes_id(''session'')','Unicode codepoint boundaries accepted and edit advances timestamp');
select pg_temp.notes_expect('select public.delete_session_notes(pg_temp.notes_id(''session''), current_setting(''notes_test.note_version'')::timestamptz)','40001','Stale delete rejected');
select pg_temp.notes_expect('insert into public.session_notes(session_id,body) values(pg_temp.notes_id(''other_session''),''Forged'')','42501','Direct notes insert denied');
select pg_temp.notes_expect('update public.session_notes set body=''Forged''','42501','Direct notes update denied');
select pg_temp.notes_expect('delete from public.session_notes','42501','Direct notes delete denied');
select * from public.save_session_notes(pg_temp.notes_id('session'),'Eight technique tags',array['1','2','3','4','5','6','7','8'],(select updated_at from public.session_notes where session_id=pg_temp.notes_id('session')));
select pg_temp.notes_assert('select cardinality(technique_tags)=8 from public.session_notes where session_id=pg_temp.notes_id(''session'')','Eight-tag boundary accepted');
select set_config('notes_test.note_version',updated_at::text,true) from public.session_notes where session_id=pg_temp.notes_id('session');
select public.delete_session_notes(pg_temp.notes_id('session'),current_setting('notes_test.note_version')::timestamptz);
select pg_temp.notes_assert('select count(*)=0 from public.session_notes where session_id=pg_temp.notes_id(''session'')','Owner deletes note');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''session''),''Deleted concurrently'',''{}'',current_setting(''notes_test.note_version'')::timestamptz)','40001','Stale edit cannot recreate deleted note');
select * from public.save_session_notes(pg_temp.notes_id('session'),'Historical athlete notes','{}',null);
reset role;

select pg_temp.notes_as('coach_a');
set local role authenticated;
select pg_temp.notes_assert('select count(*)=1 from public.session_notes where session_id=pg_temp.notes_id(''session'')','Current coach reads athlete notes');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''session''),''Coach forged edit'',''{}'',null)','42501','Coach cannot modify notes');
select pg_temp.notes_expect('select public.delete_session_notes(pg_temp.notes_id(''session''),now())','42501','Coach cannot delete notes');
select set_config('notes_test.primary_feedback',public.save_coach_feedback(null,pg_temp.notes_id('org_a'),pg_temp.notes_id('athlete'),'session',pg_temp.notes_id('feedback_session'),'Example session feedback A' ,null,pg_temp.notes_id('request_primary'))::text,true);
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),''general'',null,''Removed standalone request'',null,pg_temp.notes_id(''request_invalid''))','22023','Standalone creation is rejected even through manually constructed RPC');
select set_config('notes_test.linked',public.save_coach_feedback(null,pg_temp.notes_id('org_a'),pg_temp.notes_id('athlete'),'session',pg_temp.notes_id('session'),'Example session feedback' ,null,pg_temp.notes_id('request_linked'))::text,true);
select pg_temp.notes_assert('select count(*)=2 and bool_and(author_user_id=pg_temp.notes_id(''coach_a'') and can_edit and author_display_name=''Example Coach A'') from public.read_coach_feedback(pg_temp.notes_id(''athlete''))','Original author reads own entries with scoped name');
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),''session'',pg_temp.notes_id(''other_session''),''Wrong owner'',null,pg_temp.notes_id(''request_invalid''))','22023','Session-recipient mismatch denied');
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),''session'',null,''Missing session'',null,pg_temp.notes_id(''request_invalid''))','22023','New session feedback requires session');
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),''general'',pg_temp.notes_id(''session''),''Invalid general'',null,pg_temp.notes_id(''request_invalid''))','22023','Removed feedback kind rejected even with Session');
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_b''),pg_temp.notes_id(''athlete''),''session'',pg_temp.notes_id(''feedback_session''),''Wrong org'',null,pg_temp.notes_id(''request_invalid''))','42501','Coach cannot author in another org');
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_a''),pg_temp.notes_id(''other''),''session'',pg_temp.notes_id(''feedback_session''),''Unrelated athlete'',null,pg_temp.notes_id(''request_invalid''))','42501','Coach cannot author for unrelated athlete');
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),''session'',pg_temp.notes_id(''feedback_session''),repeat(''x'',4001),null,pg_temp.notes_id(''request_invalid''))','22023','Oversize feedback rejected');
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),''session'',pg_temp.notes_id(''feedback_session''),E'' \n\t '',null,pg_temp.notes_id(''request_invalid''))','22023','Whitespace feedback rejected');
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),''private'',null,''Private'',null,pg_temp.notes_id(''request_invalid''))','22023','Unapproved kind rejected');
select pg_temp.notes_expect('insert into public.coach_feedback(organization_id,athlete_user_id,author_user_id,kind,body) values(pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),pg_temp.notes_id(''coach_a2''),''general'',''Impersonation'')','42501','Direct author impersonation denied');
select pg_temp.notes_expect('update public.coach_feedback set author_user_id=pg_temp.notes_id(''coach_a2'')','42501','Direct feedback update denied');
select pg_temp.notes_expect('delete from public.coach_feedback','42501','Direct feedback delete denied');
select pg_temp.notes_expect('select public.save_coach_feedback(p_feedback_id=>null,p_organization_id=>pg_temp.notes_id(''org_a''),p_athlete_user_id=>pg_temp.notes_id(''athlete''),p_kind=>''general'',p_session_id=>null,p_body=>''Forged'',p_author_user_id=>pg_temp.notes_id(''coach_a2''))','42883','RPC has no client author argument');
select set_config('notes_test.feedback_version',updated_at::text,true) from public.coach_feedback where id=pg_temp.notes_id('primary_feedback');
select pg_temp.notes_expect('select public.save_coach_feedback(pg_temp.notes_id(''primary_feedback''),pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),''session'',pg_temp.notes_id(''feedback_session''),''Overwrite'',null)','40001','Feedback update requires version');
select pg_temp.notes_expect('select public.save_coach_feedback(pg_temp.notes_id(''primary_feedback''),pg_temp.notes_id(''org_b''),pg_temp.notes_id(''athlete''),''session'',pg_temp.notes_id(''feedback_session''),''Changed context'',current_setting(''notes_test.feedback_version'')::timestamptz)','22023','Organization immutable');
select pg_temp.notes_expect('select public.save_coach_feedback(pg_temp.notes_id(''primary_feedback''),pg_temp.notes_id(''org_a''),pg_temp.notes_id(''other''),''session'',pg_temp.notes_id(''feedback_session''),''Changed context'',current_setting(''notes_test.feedback_version'')::timestamptz)','22023','Recipient immutable');
select pg_temp.notes_expect('select public.save_coach_feedback(pg_temp.notes_id(''primary_feedback''),pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),''session'',pg_temp.notes_id(''session''),''Changed context'',current_setting(''notes_test.feedback_version'')::timestamptz)','22023','Kind and session immutable');
select public.save_coach_feedback(pg_temp.notes_id('primary_feedback'),pg_temp.notes_id('org_a'),pg_temp.notes_id('athlete'),'session',pg_temp.notes_id('feedback_session'),'Edited feedback',current_setting('notes_test.feedback_version')::timestamptz);
select pg_temp.notes_assert('select body=''Edited feedback'' and updated_at>created_at from public.coach_feedback where id=pg_temp.notes_id(''primary_feedback'')','Author edits and retains creation time');
select pg_temp.notes_expect('select public.delete_coach_feedback(pg_temp.notes_id(''primary_feedback''),current_setting(''notes_test.feedback_version'')::timestamptz)','40001','Stale feedback deletion rejected');
select pg_temp.notes_expect('select public.save_coach_feedback(pg_temp.notes_id(''primary_feedback''),pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),''session'',pg_temp.notes_id(''feedback_session''),''Stale overwrite'',current_setting(''notes_test.feedback_version'')::timestamptz)','40001','Stale feedback edit rejected');
select pg_temp.notes_expect('select * from public.read_coach_feedback(p_before_created_at=>now())','22023','Both keyset cursor parts required');
select pg_temp.notes_expect('select * from public.read_coach_feedback(p_limit=>101)','22023','History limit bounded');
select pg_temp.notes_expect('select * from public.read_coach_feedback(p_kind=>''private'')','22023','History kind bounded');
select pg_temp.notes_assert('select count(*)=1 from public.read_coach_feedback(p_session_id=>pg_temp.notes_id(''session''))','Session filter returns linked feedback');
select pg_temp.notes_expect('select * from public.read_coach_feedback(p_kind=>''general'')','22023','Removed feedback kind rejected by reader');
select pg_temp.notes_assert('with first_page as (select * from public.read_coach_feedback(p_limit=>1)), next_page as (select n.* from first_page f cross join lateral public.read_coach_feedback(p_before_created_at=>f.created_at,p_before_id=>f.id,p_limit=>1) n) select (select count(*) from next_page)=1 and not exists(select 1 from first_page f join next_page n using(id))','Keyset pages do not repeat rows');
reset role;
select pg_temp.notes_expect('update public.coach_feedback set session_id=pg_temp.notes_id(''other_session'') where id=pg_temp.notes_id(''linked'')','22023','Schema trigger rejects session reassignment');
select pg_temp.notes_expect('update public.coach_feedback set author_user_id=pg_temp.notes_id(''coach_a2'') where id=pg_temp.notes_id(''primary_feedback'')','22023','Schema trigger rejects author reassignment');
select pg_temp.notes_expect('update public.coach_feedback set organization_id=null where id=pg_temp.notes_id(''primary_feedback'')','22023','Provenance cannot be nulled while original organization exists');
select pg_temp.notes_expect('insert into public.coach_feedback(organization_id,athlete_user_id,author_user_id,kind,session_id,body) values(pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),pg_temp.notes_id(''coach_a''),''session'',pg_temp.notes_id(''other_session''),''Invalid owner'')','22023','Schema trigger rejects session owner mismatch');
select pg_temp.notes_expect('insert into public.session_notes(session_id,body,technique_tags) values(pg_temp.notes_id(''other_session''),''Valid'',array[''same'',''same''])','23514','Schema rejects duplicate tags outside RPC');

select pg_temp.notes_as('coach_a2');
set local role authenticated;
select pg_temp.notes_assert('select exists(select 1 from public.session_notes where session_id=pg_temp.notes_id(''session''))','Same-org other coach can read athlete notes');
select pg_temp.notes_assert('select count(*)=0 from public.coach_feedback where id in(pg_temp.notes_id(''primary_feedback''),pg_temp.notes_id(''linked''))','Same-org other coach cannot SELECT author feedback');
select pg_temp.notes_assert('select count(*)=0 from public.read_coach_feedback(pg_temp.notes_id(''athlete''),pg_temp.notes_id(''org_a''))','Scoped reader also hides other coach entries');
select pg_temp.notes_expect('select public.save_coach_feedback(pg_temp.notes_id(''primary_feedback''),pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),''session'',pg_temp.notes_id(''feedback_session''),''Another author edit'',null)','42501','Same-org other coach cannot edit');
select pg_temp.notes_expect('select public.delete_coach_feedback(pg_temp.notes_id(''primary_feedback''),now())','42501','Same-org other coach cannot delete');
reset role;
select pg_temp.notes_as('coach_b');
set local role authenticated;
select pg_temp.notes_assert('select count(*)=0 from public.coach_feedback where organization_id=pg_temp.notes_id(''org_a'')','Cross-org direct SELECT denied for multi-org athlete');
select pg_temp.notes_assert('select count(*)=0 from public.read_coach_feedback(pg_temp.notes_id(''athlete''),pg_temp.notes_id(''org_a''))','Cross-org reader denied for multi-org athlete');
select set_config('notes_test.other_org',public.save_coach_feedback(null,pg_temp.notes_id('org_b'),pg_temp.notes_id('athlete'),'session',pg_temp.notes_id('feedback_session'),'Other organisation feedback' ,null,pg_temp.notes_id('request_b'))::text,true);
select pg_temp.notes_assert('select count(*)=1 from public.read_coach_feedback(pg_temp.notes_id(''athlete''))','Coach B sees only own organization feedback');
reset role;
select pg_temp.notes_as('other');
set local role authenticated;
select pg_temp.notes_assert('select count(*)=0 from public.session_notes where session_id=pg_temp.notes_id(''session'')','Unrelated athlete cannot read notes');
select pg_temp.notes_assert('select count(*)=0 from public.read_coach_feedback(pg_temp.notes_id(''athlete''))','Unrelated athlete cannot read feedback');
reset role;
select pg_temp.notes_as('athlete');
set local role authenticated;
select pg_temp.notes_assert('select count(*)=3 and not bool_or(can_edit) from public.read_coach_feedback()','Recipient reads across organizations without edit rights');
select pg_temp.notes_assert('select count(*)=0 from public.profiles where id=pg_temp.notes_id(''coach_a'')','Profile SELECT stays owner-only');
select pg_temp.notes_expect('select public.delete_coach_feedback(pg_temp.notes_id(''primary_feedback''),now())','42501','Recipient cannot delete coach feedback');
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),''session'',pg_temp.notes_id(''feedback_session''),''Athlete forgery'',null,pg_temp.notes_id(''request_invalid''))','42501','Archer cannot author feedback');
reset role;

-- Coach departure revokes both reads and guarded writes; athlete keeps history.
update public.organization_members set status='left',left_at=now()
where organization_id=pg_temp.notes_id('org_a') and user_id=pg_temp.notes_id('coach_a');
select pg_temp.notes_as('coach_a');
set local role authenticated;
select pg_temp.notes_assert('select count(*)=0 from public.session_notes where session_id=pg_temp.notes_id(''session'')','Departed coach loses notes');
select pg_temp.notes_assert('select count(*)=0 from public.read_coach_feedback()','Departed original author loses feedback');
select pg_temp.notes_expect('select public.delete_coach_feedback(pg_temp.notes_id(''primary_feedback''),now())','42501','Departed original author cannot delete');
reset role;
select pg_temp.notes_as('athlete');
set local role authenticated;
select pg_temp.notes_assert('select count(*)=3 from public.read_coach_feedback()','Athlete retains departed coach history');
reset role;
update public.organization_members set status='active',left_at=null
where organization_id=pg_temp.notes_id('org_a') and user_id=pg_temp.notes_id('coach_a');
update public.organization_members set status='left',left_at=now()
where organization_id=pg_temp.notes_id('org_a') and user_id=pg_temp.notes_id('athlete');
-- Joining a different organization does not authorize the original author's A records.
insert into public.organization_members(organization_id,user_id,role,status)
values(pg_temp.notes_id('org_b'),pg_temp.notes_id('coach_a'),'head_coach','active');
select pg_temp.notes_as('coach_a');
set local role authenticated;
select pg_temp.notes_assert('select count(*)=0 from public.read_coach_feedback(p_organization_id=>pg_temp.notes_id(''org_a''))','Author relationship in B cannot recover A history');
select pg_temp.notes_expect('select public.delete_coach_feedback(pg_temp.notes_id(''primary_feedback''),now())','42501','Author in another org cannot mutate A history');
reset role;
select pg_temp.notes_as('athlete');
set local role authenticated;
select pg_temp.notes_assert('select count(*)=3 from public.read_coach_feedback()','Departed athlete retains all recipient history');
reset role;

-- Restore exact relationship, then downgrade coach role while active.
update public.organization_members set status='active',left_at=null
where organization_id=pg_temp.notes_id('org_a') and user_id=pg_temp.notes_id('athlete');
update public.organization_members set role='archer'
where organization_id=pg_temp.notes_id('org_a') and user_id=pg_temp.notes_id('coach_a');
select pg_temp.notes_as('coach_a');
set local role authenticated;
select pg_temp.notes_assert('select count(*)=0 from public.read_coach_feedback(p_organization_id=>pg_temp.notes_id(''org_a''))','Active non-head-coach author denied');
reset role;
update public.organization_members set role='head_coach'
where organization_id=pg_temp.notes_id('org_a') and user_id=pg_temp.notes_id('coach_a');
update public.organization_members set role='head_coach'
where organization_id=pg_temp.notes_id('org_a') and user_id=pg_temp.notes_id('athlete');
select pg_temp.notes_as('coach_a');
set local role authenticated;
select pg_temp.notes_assert('select count(*)=0 from public.read_coach_feedback(p_organization_id=>pg_temp.notes_id(''org_a''))','Recipient must remain an active archer for author reads');
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_a''),pg_temp.notes_id(''athlete''),''session'',pg_temp.notes_id(''feedback_session''),''Wrong recipient role'',null,pg_temp.notes_id(''request_invalid''))','42501','Recipient must be archer for creation');
reset role;
update public.organization_members set role='archer'
where organization_id=pg_temp.notes_id('org_a') and user_id=pg_temp.notes_id('athlete');

-- Successful author deletion removes exactly the selected shared entry.
select pg_temp.notes_as('coach_b');
set local role authenticated;
select public.delete_coach_feedback(pg_temp.notes_id('other_org'),(select updated_at from public.coach_feedback where id=pg_temp.notes_id('other_org')));
select pg_temp.notes_assert('select count(*)=0 from public.coach_feedback where id=pg_temp.notes_id(''other_org'')','Author deletes own feedback');
reset role;

-- Retention under normal FK actions, without changing kind or historical timestamps.
delete from public.sessions where id=pg_temp.notes_id('session');
select pg_temp.notes_assert('select count(*)=0 from public.session_notes where session_id=pg_temp.notes_id(''session'')','Session cascade removes notes');
select pg_temp.notes_assert('select kind=''session'' and session_id is null from public.coach_feedback where id=pg_temp.notes_id(''linked'')','Deleted-session feedback retained with original kind');
select pg_temp.notes_as('coach_a');
set local role authenticated;
select public.save_coach_feedback(pg_temp.notes_id('linked'),pg_temp.notes_id('org_a'),pg_temp.notes_id('athlete'),'session',null,'Edited after session deletion',(select updated_at from public.coach_feedback where id=pg_temp.notes_id('linked')));
select pg_temp.notes_assert('select count(*)=1 from public.read_coach_feedback(p_kind=>''session'') where session_id is null','Retained session feedback stays editable by authorized author');
reset role;
delete from public.organizations where id=pg_temp.notes_id('org_a');
select pg_temp.notes_assert('select count(*)=2 and bool_and(organization_id is null) from public.coach_feedback where athlete_user_id=pg_temp.notes_id(''athlete'')','Organization deletion retains recipient feedback');
select pg_temp.notes_as('coach_a');
set local role authenticated;
select pg_temp.notes_assert('select count(*)=0 from public.read_coach_feedback()','Deleted org grants no author access through B');
reset role;
delete from auth.users where id=pg_temp.notes_id('coach_a');
select pg_temp.notes_as('athlete');
set local role authenticated;
select pg_temp.notes_assert('select count(*)=2 and bool_and(author_user_id is null and author_display_name=''Former coach'' and can_edit=false) from public.read_coach_feedback()','Deleted coach account retains feedback with neutral attribution');
reset role;

-- No-identity authenticated calls and anonymous calls are explicitly denied.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select pg_temp.notes_expect('select * from public.read_coach_feedback()','42501','Authenticated role without UID cannot use privileged reader');
select pg_temp.notes_expect('select * from public.save_session_notes(pg_temp.notes_id(''other_session''),''Anonymous'',''{}'',null)','42501','No-UID notes write denied');
reset role;
set local role anon;
select pg_temp.notes_expect('select * from public.session_notes','42501','Anon notes SELECT denied');
select pg_temp.notes_expect('select * from public.coach_feedback','42501','Anon feedback SELECT denied');
select pg_temp.notes_expect('select * from public.read_coach_feedback()','42501','Anon reader EXECUTE denied');
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_b''),pg_temp.notes_id(''athlete''),''session'',pg_temp.notes_id(''feedback_session''),''Anon'',null,pg_temp.notes_id(''request_invalid''))','42501','Anon write EXECUTE denied');
reset role;
-- An actual athlete-account cascade must also remove an existing Session and its note.
insert into public.sessions(user_id,title,session_date,session_type)
values(pg_temp.notes_id('athlete'),'Account cascade fixture',current_date,'training')
returning set_config('notes_test.account_session',id::text,true);
select pg_temp.notes_as('athlete');
set local role authenticated;
select * from public.save_session_notes(pg_temp.notes_id('account_session'),'Account deletion note','{}',null);
reset role;
delete from auth.users where id=pg_temp.notes_id('athlete');
select pg_temp.notes_assert('select count(*)=0 from public.coach_feedback where athlete_user_id=pg_temp.notes_id(''athlete'')','Athlete deletion cascades personal feedback');
select pg_temp.notes_assert('select count(*)=0 from public.session_notes where session_id=pg_temp.notes_id(''account_session'')','Athlete deletion cascades session notes');
select pg_temp.notes_assert('select count(*)=0 from private.coach_feedback_creation_requests where athlete_user_id=pg_temp.notes_id(''athlete'')','Athlete deletion cascades creation ledger');
select pg_temp.notes_assert('select count(*)=0 from private.coach_feedback_creation_budgets where user_id=pg_temp.notes_id(''coach_a'')','Coach deletion cascades creation budget');

-- Retry identity is independent of editable body text and is never an access token.
insert into public.organizations(id,name,created_by) values
  (pg_temp.notes_id('org_budget'),'Feedback budget fixture',pg_temp.notes_id('coach_budget')),
  (pg_temp.notes_id('org_budget2'),'Feedback budget second org',pg_temp.notes_id('coach_budget2'));
insert into public.organization_members(organization_id,user_id,role,status) values
  (pg_temp.notes_id('org_budget'),pg_temp.notes_id('coach_budget2'),'head_coach','active'),
  (pg_temp.notes_id('org_budget'),pg_temp.notes_id('athlete_budget'),'archer','active'),
  (pg_temp.notes_id('org_budget'),pg_temp.notes_id('athlete_budget2'),'archer','active'),
  (pg_temp.notes_id('org_budget2'),pg_temp.notes_id('coach_budget'),'head_coach','active'),
  (pg_temp.notes_id('org_budget2'),pg_temp.notes_id('athlete_budget'),'archer','active');
insert into public.sessions(id,user_id,title,session_date,session_type)
values(pg_temp.notes_id('budget_session'),pg_temp.notes_id('athlete_budget'),'Feedback retry session',current_date,'training');
select set_config('notes_test.conflict_message','This feedback request conflicts with an earlier submission. Refresh feedback and start a new entry.',true);
select pg_temp.notes_as('coach_budget');
set local role authenticated;
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_budget''),pg_temp.notes_id(''athlete_budget''),''session'',pg_temp.notes_id(''budget_session''),''Budget fixture'',null)',
  '22023','New feedback requires stable request UUID');
reset role;
select set_config('notes_test.budget_feedback_session',gen_random_uuid()::text,true);
insert into public.sessions(id,user_id,title,session_date,session_type) values(pg_temp.notes_id('budget_feedback_session'),pg_temp.notes_id('athlete_budget'),'Budget feedback context',current_date,'training');
set local role authenticated;
select set_config('notes_test.budget_feedback',public.save_coach_feedback(null,pg_temp.notes_id('org_budget'),
  pg_temp.notes_id('athlete_budget'),'session',pg_temp.notes_id('budget_feedback_session'),' Budget fixture ',null,pg_temp.notes_id('request_budget'))::text,true);
select pg_temp.notes_assert('select public.save_coach_feedback(null,pg_temp.notes_id(''org_budget''),pg_temp.notes_id(''athlete_budget''),''session'',pg_temp.notes_id(''budget_feedback_session''),''Budget fixture'',null,pg_temp.notes_id(''request_budget''))=pg_temp.notes_id(''budget_feedback'')',
  'Retry returns original UUID after normalized first submission');
select pg_temp.notes_assert('select count(*)=1 from public.coach_feedback where athlete_user_id=pg_temp.notes_id(''athlete_budget'')','Retry creates exactly one feedback row');
select public.save_coach_feedback(pg_temp.notes_id('budget_feedback'),pg_temp.notes_id('org_budget'),pg_temp.notes_id('athlete_budget'),
  'session',pg_temp.notes_id('budget_feedback_session'),'Edited after creation',(select updated_at from public.coach_feedback where id=pg_temp.notes_id('budget_feedback')));
select pg_temp.notes_assert('select public.save_coach_feedback(null,pg_temp.notes_id(''org_budget''),pg_temp.notes_id(''athlete_budget''),''session'',pg_temp.notes_id(''budget_feedback_session''),''Budget fixture'',null,pg_temp.notes_id(''request_budget''))=pg_temp.notes_id(''budget_feedback'')',
  'Original creation payload retries after later edit');
select pg_temp.notes_assert('select body=''Edited after creation'' from public.coach_feedback where id=pg_temp.notes_id(''budget_feedback'')','Replay never overwrites later edited body');
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_budget''),pg_temp.notes_id(''athlete_budget''),''session'',pg_temp.notes_id(''budget_feedback_session''),''Edited after creation'',null,pg_temp.notes_id(''request_budget''))',
  '22023','Reusing creation key with later body rejected',current_setting('notes_test.conflict_message'));
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_budget''),pg_temp.notes_id(''athlete_budget2''),''session'',pg_temp.notes_id(''budget_feedback_session''),''Budget fixture'',null,pg_temp.notes_id(''request_budget''))',
  '22023','Creation key cannot change recipient',current_setting('notes_test.conflict_message'));
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_budget2''),pg_temp.notes_id(''athlete_budget''),''session'',pg_temp.notes_id(''budget_feedback_session''),''Budget fixture'',null,pg_temp.notes_id(''request_budget''))',
  '22023','Creation key cannot change organization',current_setting('notes_test.conflict_message'));
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_budget''),pg_temp.notes_id(''athlete_budget''),''session'',pg_temp.notes_id(''budget_session''),''Budget fixture'',null,pg_temp.notes_id(''request_budget''))',
  '22023','Creation key cannot change kind or session',current_setting('notes_test.conflict_message'));
select set_config('notes_test.same_text_feedback',public.save_coach_feedback(null,pg_temp.notes_id('org_budget'),pg_temp.notes_id('athlete_budget'),
  'session',pg_temp.notes_id('budget_feedback_session'),'Budget fixture',null,pg_temp.notes_id('request_same_text'))::text,true);
select pg_temp.notes_assert('select pg_temp.notes_id(''same_text_feedback'')<>pg_temp.notes_id(''budget_feedback'')','Same text with new key is a legitimate new entry');
select pg_temp.notes_expect('select * from private.coach_feedback_creation_requests','42501','Authenticated caller cannot inspect creation ledger');
select pg_temp.notes_expect('select * from private.coach_feedback_creation_budgets','42501','Authenticated caller cannot inspect creation budgets');
select pg_temp.notes_expect('select private.consume_coach_feedback_creation_budget()','42501','Authenticated caller cannot directly consume creation budget');
reset role;
select pg_temp.notes_assert('select minute_count=2 and hour_count=2 from private.coach_feedback_creation_budgets where user_id=pg_temp.notes_id(''coach_budget'')','Only two genuine creates charged; retries/conflicts/edits uncharged');
select pg_temp.notes_expect('update private.coach_feedback_creation_requests set request_id=gen_random_uuid() where request_id=pg_temp.notes_id(''request_budget'')','22023','Creation request UUID immutable');
select pg_temp.notes_expect('update private.coach_feedback_creation_requests set payload_sha256=extensions.digest(''changed'',''sha256'') where request_id=pg_temp.notes_id(''request_budget'')','22023','Original full-payload hash immutable');
select pg_temp.notes_expect('update private.coach_feedback_creation_requests set feedback_id=null where request_id=pg_temp.notes_id(''request_budget'')','22023','Ledger link cannot be cleared before feedback deletion');

select pg_temp.notes_as('coach_budget2');
set local role authenticated;
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_budget''),pg_temp.notes_id(''athlete_budget''),''session'',pg_temp.notes_id(''budget_feedback_session''),''Budget fixture'',null,pg_temp.notes_id(''request_budget''))',
  '22023','Other-author key reuse returns uniform safe conflict',current_setting('notes_test.conflict_message'));
select pg_temp.notes_assert('select count(*)=0 from public.read_coach_feedback(pg_temp.notes_id(''athlete_budget''))','Key collision exposes no other-author feedback');
reset role;
update public.organization_members set status='left',left_at=now()
where organization_id=pg_temp.notes_id('org_budget') and user_id=pg_temp.notes_id('coach_budget');
select pg_temp.notes_as('coach_budget');
set local role authenticated;
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_budget''),pg_temp.notes_id(''athlete_budget''),''session'',pg_temp.notes_id(''budget_feedback_session''),''Budget fixture'',null,pg_temp.notes_id(''request_budget''))',
  '42501','Replay rechecks current exact-org authorization');
reset role;
update public.organization_members set status='active',left_at=null
where organization_id=pg_temp.notes_id('org_budget') and user_id=pg_temp.notes_id('coach_budget');

-- Pin the stored windows one boundary ahead (owner-only fixture manipulation) so a
-- real UTC boundary cannot make this fast test flaky. This also proves a delayed
-- request never resets a newer stored window. Actual reset behavior is tested below.
update private.coach_feedback_creation_budgets set
  minute_start=date_trunc('minute',clock_timestamp(),'UTC')+interval '1 minute',
  hour_start=date_trunc('hour',clock_timestamp(),'UTC')+interval '1 hour'
where user_id=pg_temp.notes_id('coach_budget');
select pg_temp.notes_as('coach_budget');
set local role authenticated;
do $$ declare i integer;
begin
  for i in 1..8 loop
    perform public.save_coach_feedback(null,pg_temp.notes_id('org_budget'),pg_temp.notes_id('athlete_budget'),
      'session',pg_temp.notes_id('budget_feedback_session'),'Additional budget fixture '||i,null,gen_random_uuid());
  end loop;
end;
$$;
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_budget''),pg_temp.notes_id(''athlete_budget''),''session'',pg_temp.notes_id(''budget_feedback_session''),''Limit fixture'',null,pg_temp.notes_id(''request_rejected''))',
  'P0001','Eleventh new create exceeds minute quota','Too many feedback entries. Try again shortly.');
select pg_temp.notes_assert('select count(*)=10 from public.coach_feedback where athlete_user_id=pg_temp.notes_id(''athlete_budget'')','Quota rejection preserves existing feedback');
select pg_temp.notes_assert('select public.save_coach_feedback(null,pg_temp.notes_id(''org_budget''),pg_temp.notes_id(''athlete_budget''),''session'',pg_temp.notes_id(''budget_feedback_session''),''Budget fixture'',null,pg_temp.notes_id(''request_budget''))=pg_temp.notes_id(''budget_feedback'')',
  'Completed request can replay even after quota exhaustion');
select public.save_coach_feedback(pg_temp.notes_id('budget_feedback'),pg_temp.notes_id('org_budget'),pg_temp.notes_id('athlete_budget'),
  'session',pg_temp.notes_id('budget_feedback_session'),'Edit despite create exhaustion',(select updated_at from public.coach_feedback where id=pg_temp.notes_id('budget_feedback')));
reset role;
select pg_temp.notes_assert('select minute_count=10 and hour_count=10 from private.coach_feedback_creation_budgets where user_id=pg_temp.notes_id(''coach_budget'')','Rejected/replayed/edited entries do not consume extra quota');
select pg_temp.notes_assert('select count(*)=0 from private.coach_feedback_creation_requests where request_id=pg_temp.notes_id(''request_rejected'')','Rejected create leaves no ledger row');
select pg_temp.notes_assert('select count(*)=0 from private.operation_budgets where user_id in(pg_temp.notes_id(''coach_budget''),pg_temp.notes_id(''coach_budget2''))','Feedback creates never alter existing operation budgets');

-- Independent author allowance and tombstone behavior after explicit shared deletion.
select pg_temp.notes_as('coach_budget2');
set local role authenticated;
select set_config('notes_test.budget_feedback2',public.save_coach_feedback(null,pg_temp.notes_id('org_budget'),pg_temp.notes_id('athlete_budget'),
  'session',pg_temp.notes_id('budget_feedback_session'),'Second coach fixture',null,pg_temp.notes_id('request_budget2'))::text,true);
select public.delete_coach_feedback(pg_temp.notes_id('budget_feedback2'),(select updated_at from public.coach_feedback where id=pg_temp.notes_id('budget_feedback2')));
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_budget''),pg_temp.notes_id(''athlete_budget''),''session'',pg_temp.notes_id(''budget_feedback_session''),''Second coach fixture'',null,pg_temp.notes_id(''request_budget2''))',
  '22023','Delayed retry cannot resurrect explicitly deleted feedback',current_setting('notes_test.conflict_message'));
select set_config('notes_test.budget_session_feedback',public.save_coach_feedback(null,pg_temp.notes_id('org_budget'),pg_temp.notes_id('athlete_budget'),
  'session',pg_temp.notes_id('budget_session'),'Original session fixture',null,pg_temp.notes_id('request_budget_session'))::text,true);
reset role;
select pg_temp.notes_assert('select minute_count=2 and hour_count=2 from private.coach_feedback_creation_budgets where user_id=pg_temp.notes_id(''coach_budget2'')','Different coach has independent budget; tombstone retry uncharged');
select pg_temp.notes_assert('select feedback_id is null from private.coach_feedback_creation_requests where request_id=pg_temp.notes_id(''request_budget2'')','Explicit deletion retains only private retry tombstone');
delete from public.sessions where id=pg_temp.notes_id('budget_session');
select pg_temp.notes_as('coach_budget2');
set local role authenticated;
select pg_temp.notes_assert('select public.save_coach_feedback(null,pg_temp.notes_id(''org_budget''),pg_temp.notes_id(''athlete_budget''),''session'',pg_temp.notes_id(''budget_session''),''Original session fixture'',null,pg_temp.notes_id(''request_budget_session''))=pg_temp.notes_id(''budget_session_feedback'')',
  'Original payload retry returns retained feedback after session deletion');
reset role;

-- Isolated fixed-window reset / hour ceiling tests, with no real time manipulation.
update private.coach_feedback_creation_budgets set minute_start=date_trunc('minute',clock_timestamp(),'UTC')-interval '1 minute',
  minute_count=10,hour_start=date_trunc('hour',clock_timestamp(),'UTC'),hour_count=99 where user_id=pg_temp.notes_id('coach_budget');
select pg_temp.notes_as('coach_budget');
set local role authenticated;
select public.save_coach_feedback(null,pg_temp.notes_id('org_budget'),pg_temp.notes_id('athlete_budget'),
  'session',pg_temp.notes_id('budget_feedback_session'),'Hundredth hourly fixture',null,pg_temp.notes_id('request_budget_hour'));
select pg_temp.notes_expect('select public.save_coach_feedback(null,pg_temp.notes_id(''org_budget''),pg_temp.notes_id(''athlete_budget''),''session'',pg_temp.notes_id(''budget_feedback_session''),''Hour limit fixture'',null,pg_temp.notes_id(''request_rejected''))',
  'P0001','Hundred-and-first hourly create rejected','Too many feedback entries. Try again shortly.');
reset role;
select pg_temp.notes_assert('select minute_count=1 and hour_count=100 from private.coach_feedback_creation_budgets where user_id=pg_temp.notes_id(''coach_budget'')','Minute resets independently without clearing hourly count');
update private.coach_feedback_creation_budgets set minute_start=date_trunc('minute',clock_timestamp(),'UTC')-interval '1 hour',minute_count=10,
  hour_start=date_trunc('hour',clock_timestamp(),'UTC')-interval '1 hour',hour_count=100 where user_id=pg_temp.notes_id('coach_budget');
select pg_temp.notes_as('coach_budget');
set local role authenticated;
select public.save_coach_feedback(null,pg_temp.notes_id('org_budget'),pg_temp.notes_id('athlete_budget'),
  'session',pg_temp.notes_id('budget_feedback_session'),'New UTC hour fixture',null,pg_temp.notes_id('request_rejected'));
reset role;
select pg_temp.notes_assert('select minute_count=1 and hour_count=1 from private.coach_feedback_creation_budgets where user_id=pg_temp.notes_id(''coach_budget'')','New hour resets both fixed UTC windows');

-- Hosted-like Auth administrator role: narrow auth.users deletion permissions only.
-- Referential actions and privileged triggers must work without granting private data.
set local role supabase_auth_admin;
delete from auth.users where id=pg_temp.notes_id('coach_budget2');
reset role;
select pg_temp.notes_assert('select count(*)=2 and bool_and(author_user_id is null) from private.coach_feedback_creation_requests where request_id in(pg_temp.notes_id(''request_budget2''),pg_temp.notes_id(''request_budget_session''))','Auth-admin coach deletion preserves ledger and clears author');
set local role supabase_auth_admin;
delete from auth.users where id=pg_temp.notes_id('athlete_budget');
reset role;
select pg_temp.notes_assert('select count(*)=0 from private.coach_feedback_creation_requests where athlete_user_id=pg_temp.notes_id(''athlete_budget'')','Auth-admin athlete deletion removes all retry metadata');
select pg_temp.notes_assert('select count(*)=0 from public.coach_feedback where athlete_user_id=pg_temp.notes_id(''athlete_budget'')','Auth-admin athlete deletion removes feedback');

-- Schema security audit: no definer in public, empty paths, no unintended grants.
select pg_temp.notes_assert($q$select not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in('save_session_notes','delete_session_notes','save_coach_feedback','delete_coach_feedback','read_coach_feedback') and p.prosecdef)$q$,'Public RPC wrappers are invoker');
select pg_temp.notes_assert($q$select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in('save_session_notes','delete_session_notes','save_coach_feedback','delete_coach_feedback','read_coach_feedback','guard_coach_feedback_context','require_feedback_relationship','can_author_coach_feedback','guard_coach_feedback_creation_request','consume_coach_feedback_creation_budget','coach_feedback_creation_digest')$q$,'Privileged functions have fixed empty search paths');
select pg_temp.notes_assert($q$select not has_table_privilege('authenticated','public.session_notes','INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated','public.coach_feedback','INSERT, UPDATE, DELETE')$q$,'No broad authenticated write grants');
select pg_temp.notes_assert($q$select not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','private') and p.proname in('trim_coaching_text','valid_session_technique_tags','guard_coach_feedback_context','require_feedback_relationship','can_author_coach_feedback','save_session_notes','delete_session_notes','save_coach_feedback','delete_coach_feedback','read_coach_feedback','guard_coach_feedback_creation_request','consume_coach_feedback_creation_budget','coach_feedback_creation_digest')
  and has_function_privilege('anon',p.oid,'EXECUTE'))$q$,'No anonymous or inherited PUBLIC execution grants');
select pg_temp.notes_assert($q$select count(*)=2 and bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in('session_notes','coach_feedback')$q$,'Both new tables have RLS');
select pg_temp.notes_assert($q$select count(*)=2 and bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname in('coach_feedback_creation_requests','coach_feedback_creation_budgets')$q$,'Private ledger and budgets have RLS');
select pg_temp.notes_assert($q$select not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in('guard_coach_feedback_creation_request','consume_coach_feedback_creation_budget','coach_feedback_creation_digest')
  and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE')))$q$,'No API-role grants on ledger/budget internals');
select current_setting('notes_test.passed')::integer as passed_assertions;
rollback;

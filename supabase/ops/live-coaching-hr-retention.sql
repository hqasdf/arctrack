-- Phase 2 release prerequisite, LOCAL REVIEW ONLY. Does not install extensions.
-- Run only after separately approving/applying both BLE HR and monitoring history migrations.
-- This creates/updates one INACTIVE job atomically. Activation is a separate operation.
begin;
do $$
declare job bigint;
begin
 if not exists(select 1 from pg_extension where extname='pg_cron') then raise exception 'Existing pg_cron required';end if;
 select jobid into job from cron.job where jobname='arctrack-live-coaching-hr-retention';
 if job is null then
  job:=cron.schedule('arctrack-live-coaching-hr-retention','* * * * *','select public.prune_live_coaching_hr();');
 end if;
 perform cron.alter_job(job, schedule:='* * * * *', command:='select public.prune_live_coaching_hr();', active:=false);
end;$$;
commit;
-- Before enabling Phase 2, explicitly activate this reviewed job and verify
-- cron.job_run_details. Latest values older than 60 seconds are cleared each run.
-- At a healthy one-minute cadence, physical live-table retention is <2 minutes.
-- Reads hide latest values after 10 seconds and samples at their exact 24-hour expiry.
-- The updated pruner removes expired samples and completed consent controls after 24 hours.
-- Enable and verify successful cleanup BEFORE enabling timeline retention in production.

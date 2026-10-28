-- Administrator-only, READ ONLY. No BPM, device identifiers, payloads or credentials.
select j.jobname,j.active,j.schedule,
 max(d.end_time) filter(where d.status='succeeded') as last_success,
 count(*) filter(where d.status='failed' and d.start_time>now()-interval '15 minutes') as failures_last_15_minutes,
 case when not j.active then 'INACTIVE'
      when max(d.end_time) filter(where d.status='succeeded') is null then 'NO_SUCCESS_RECORDED'
      when max(d.end_time) filter(where d.status='succeeded')<now()-interval '3 minutes' then 'CLEANUP_OVERDUE'
      else 'HEALTHY' end as cleanup_health
from cron.job j left join cron.job_run_details d on d.jobid=j.jobid
where j.jobname='arctrack-live-coaching-hr-retention'
group by j.jobname,j.active,j.schedule;

select count(*) filter(where expires_at<=clock_timestamp()) as expired_samples_waiting_for_cleanup
from public.live_coaching_hr_samples;

select count(*) filter(where received_at<clock_timestamp()-interval '2 minutes') as stale_latest_values_waiting_for_cleanup
from public.live_coaching_hr;

select d.start_time,d.end_time,d.status,d.return_message
from cron.job_run_details d join cron.job j on j.jobid=d.jobid
where j.jobname='arctrack-live-coaching-hr-retention' and d.status='failed'
order by d.start_time desc limit 10;

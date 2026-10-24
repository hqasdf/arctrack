-- READ ONLY, administrator only, after separately approved pilot installation.
-- Export aggregates, never payloads, request headers, provider IDs or secret values.
select state,count(*) as receipts,min(received_at) as oldest_receipt
from public.garmin_health_inbox group by state;
select state,error_code,count(*) as users from public.garmin_health_sync_state group by state,error_code;
select count(*) filter(where r.status_code=200) as successful_calls,
  count(*) filter(where r.status_code is not null and r.status_code<>200) as failed_calls,
  count(*) filter(where r.timed_out or r.error_msg is not null) as transport_failures,
  count(*) filter(where r.id is null and w.enqueued_at<now()-interval '2 minutes') as missing_responses
from private.garmin_health_worker_runs w left join net._http_response r on r.id=w.request_id;
select d.status,count(*) as runs from cron.job_run_details d join cron.job j on j.jobid=d.jobid
where j.jobname='arctrack-garmin-health-pilot' and d.start_time>now()-interval '1 day' group by d.status;

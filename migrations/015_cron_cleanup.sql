-- Run once in Supabase > SQL Editor (existing projects, after 004_push_schedule.sql).
-- pg_cron logs every run of every job in cron.job_run_details and never deletes those rows itself. The reminder job runs
-- every minute, so that's ~1,440 rows a day, forever, all counted against the database size limit. This keeps one week.
-- Curious how big it got?  select pg_size_pretty(pg_total_relation_size('cron.job_run_details')), count(*) from cron.job_run_details;
select cron.schedule(
  'purge-cron-history',
  '17 4 * * *',   -- daily, 04:17 UTC
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$
);

-- Deleting frees the space for reuse but doesn't shrink the table. If it had grown large, run this on its own afterwards
-- to hand the space back:  vacuum full cron.job_run_details;
-- To stop the clean-up:  select cron.unschedule('purge-cron-history');

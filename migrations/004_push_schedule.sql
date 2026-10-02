-- Run AFTER the send-reminders function is deployed and its secrets are set.
-- Replace PASTE_CRON_SECRET with the CRON_SECRET value (the same one you saved as a function secret).
-- If "create extension" complains, enable pg_cron and pg_net under Database > Extensions instead.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-reminders',
  '* * * * *',   -- every minute
  $$
  select net.http_post(
    url     := 'https://aaejevsvmmhrmykozzic.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'PASTE_CRON_SECRET'),
    body    := '{}'::jsonb
  );
  $$
);

-- To stop reminders later:  select cron.unschedule('send-reminders');

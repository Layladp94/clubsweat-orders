-- Nightly renewal job. Run this AFTER the functions are deployed.
-- Replace the two placeholders before running:
--   YOUR_PROJECT_REF   (Supabase project reference)
--   YOUR_CRON_SECRET   (same value as the CRON_SECRET function secret)

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('clubsweat-renewals') where exists (select 1 from cron.job where jobname = 'clubsweat-renewals');

-- 06:00 South Africa time = 04:00 UTC, every day
select cron.schedule(
  'clubsweat-renewals',
  '0 4 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/renewals',
    headers := '{"content-type":"application/json","x-cron-secret":"YOUR_CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

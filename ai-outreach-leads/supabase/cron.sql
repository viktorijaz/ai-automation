-- Supabase only: every 5 minutes, call the Vercel route, but only when there is work.
-- Not a migration: local Docker Postgres has no pg_cron / pg_net.
--
-- Before running this, once, in the Supabase SQL editor (values never go into git):
--   select vault.create_secret('https://<your-app>.vercel.app/api/process-leads', 'process_leads_url');
--   select vault.create_secret('<the CRON_SECRET set on Vercel>', 'cron_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'process-leads',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'process_leads_url'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 60000 -- a batch takes ~25 s; pg_net's default is only 5 s
  )
  where exists (
    select 1 from public.leads
    where status = 'pending'
       or (status = 'processing' and claimed_at < now() - interval '10 minutes')
  );
  $$
);

-- Check:   select * from cron.job;
--          select * from cron.job_run_details order by start_time desc limit 5;
--          select id, status_code, content from net._http_response order by id desc limit 5;
-- Remove:  select cron.unschedule('process-leads');

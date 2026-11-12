-- OPTIONAL: run the PM/compliance scheduler inside the database instead of (or as well as)
-- the /api/cron/generate route. First enable the pg_cron extension:
--   Supabase dashboard → Integrations → Cron  (or Database → Extensions → pg_cron)
-- Then run this once. 13:00 UTC ≈ 5–6am Pacific.

select cron.schedule('maintainos-generate-due-work-orders', '0 13 * * *', $$ select public.generate_due_work_orders(); $$);

-- To remove later:  select cron.unschedule('maintainos-generate-due-work-orders');

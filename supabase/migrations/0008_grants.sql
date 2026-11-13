-- Newer Supabase projects no longer grant the API roles access to tables created in the SQL editor.
-- Without these grants the app can't read profiles after sign-in ("Your account is inactive").
-- Row-level security policies still decide which rows each user can see. Safe to re-run.
grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

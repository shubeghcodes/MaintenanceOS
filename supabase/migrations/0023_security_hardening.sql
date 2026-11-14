-- =====================================================================
-- MaintenanceOS — Security hardening
-- Run after 0022 (and again any time you re-run 0008, which re-grants functions). Safe to re-run.
--
-- 1. Nobody who isn't signed in can call any database function through the API.
--    (The app never calls functions without a sign-in; server jobs use the service role.)
-- 2. Trigger functions can't be called directly by anyone (triggers still fire normally).
-- 3. vendor_portal_set_status is server-only again: 0008 re-opened it to signed-in users,
--    which let them change any work order's status around the access rules.
-- 4. Every app function gets a fixed search_path.
-- =====================================================================

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.prorettype = 'trigger'::regtype as is_trigger,
           exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as has_path
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')  -- skip extension functions
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.is_trigger then
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
    if not f.has_path then
      execute format('alter function %s set search_path = public', f.sig);
    end if;
  end loop;
end $$;

-- Server only (vendor portal actions run with the service role).
revoke execute on function public.vendor_portal_set_status(uuid, public.wo_status, text, text, boolean) from public, anon, authenticated;
grant execute on function public.vendor_portal_set_status(uuid, public.wo_status, text, text, boolean) to service_role;

-- Functions added by future migrations aren't callable without a sign-in either.
alter default privileges in schema public revoke execute on functions from public, anon;

-- =====================================================================
-- MaintenanceOS — Geofence fixes (review of 0039)
-- Run after 0039. Safe to re-run.
--
-- A) Consent belongs to the person: only they can change profiles.location_consent_at
--    (a trigger refuses it from anyone else — admins, the server key, the SQL editor).
--    set_location_consent() still works because it only changes the caller's own row.
--    Clearing consent by any route also ends an open visit.
-- B) No GPS coordinates are kept (owner decision): lat / lng / accuracy_m are dropped from
--    site_presence_events. record_location_ping() keeps the same signature and still uses
--    the reading to decide inside / outside, but saves only who, store, shift, kind, time, source.
-- C) Withdrawing consent closes the visit: set_location_consent(false) writes a 'left' for the
--    current store (if any), clears tech_presence_state and now RETURNS A JSON ARRAY of events
--    (same shape as record_location_ping) so the app can push "left". A clock-out still records
--    the 'left' even if consent was withdrawn.
-- D) "Not at any store" rows in tech_presence_state: only super admins / company-unrestricted
--    admins (same rule as admin_company_ok) and the tech themselves can see them.
-- =====================================================================

-- ---------- B) no coordinates stored ----------
alter table public.site_presence_events drop column if exists lat;
alter table public.site_presence_events drop column if exists lng;
alter table public.site_presence_events drop column if exists accuracy_m;

-- New event source for C.
alter table public.site_presence_events drop constraint if exists site_presence_events_source_check;
alter table public.site_presence_events add constraint site_presence_events_source_check
  check (source in ('ping', 'clock_in', 'clock_out', 'consent_withdrawn'));

-- Shared "leave the current store" step, used by clock-out and by withdrawing consent.
-- Returns the event(s) as a JSON array ([] if they weren't at a store). Not callable from the API.
create or replace function public.presence_close_visit(p_user uuid, p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st      tech_presence_state;
  v_shift uuid;
  v_now   timestamptz := now();
  events  jsonb := '[]'::jsonb;
begin
  select * into st from tech_presence_state where user_id = p_user for update;
  if st.site_id is not null then
    select id into v_shift from tech_shifts where user_id = p_user
     order by (clock_out_at is null) desc, clock_in_at desc limit 1;   -- open shift first, else the latest
    insert into site_presence_events (user_id, site_id, shift_id, kind, at, source)
    values (p_user, st.site_id, v_shift, 'exit', v_now, p_source);
    events := jsonb_build_array(jsonb_build_object('kind', 'exit', 'site_id', st.site_id,
               'site_name', (select name from sites where id = st.site_id), 'at', v_now));
  end if;
  if st.user_id is not null then
    update tech_presence_state
       set site_id = null,
           since = case when site_id is null then since else v_now end,
           last_ping_at = v_now
     where user_id = p_user;
  end if;
  return events;
end $$;
revoke execute on function public.presence_close_visit(uuid, text) from public, anon, authenticated;

-- ---------- A) consent can only be changed by the person ----------
-- Also: clearing consent by any route (even a direct edit of one's own profile row) ends an open visit,
-- so nobody is left "at the store" without consent. Security definer only so it can write that 'left'.
create or replace function public.profiles_consent_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.location_consent_at is not null and (auth.uid() is null or new.id <> auth.uid()) then
      raise exception 'Only the person themselves can agree to location checks';
    end if;
  elsif new.location_consent_at is distinct from old.location_consent_at then
    if auth.uid() is null or new.id <> auth.uid() then
      raise exception 'Only the person themselves can change their location consent';
    end if;
    if new.location_consent_at is null then
      perform public.presence_close_visit(new.id, 'consent_withdrawn');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_consent_guard on public.profiles;
create trigger profiles_consent_guard before insert or update on public.profiles
  for each row execute function public.profiles_consent_guard();
revoke execute on function public.profiles_consent_guard() from public, anon, authenticated;

-- Same signature as 0039 (the app keeps calling it the same way); coordinates are only used, never saved.
create or replace function public.record_location_ping(p_lat double precision, p_lng double precision,
                                                       p_accuracy_m double precision, p_source text default 'ping')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid        uuid := auth.uid();
  me         profiles;
  v_shift    uuid;
  st         tech_presence_state;
  cur_site   sites;
  new_site   uuid;
  events     jsonb := '[]'::jsonb;
  v_now      timestamptz := now();
begin
  if p_source is null or p_source not in ('ping', 'clock_in', 'clock_out') then
    raise exception 'Unknown location source: %', p_source;
  end if;
  if uid is null then return events; end if;
  select * into me from profiles where id = uid;
  if me.id is null or me.role <> 'tech' then return events; end if;

  -- Clocking out closes the visit whatever the reading, and even if consent was withdrawn
  -- (withdrawing already closes it, so normally there is nothing left to close).
  if p_source = 'clock_out' then
    return public.presence_close_visit(uid, 'clock_out');
  end if;

  if not me.active or me.location_consent_at is null then return events; end if;
  select id into v_shift from tech_shifts where user_id = uid and clock_out_at is null
   order by clock_in_at desc limit 1;
  if v_shift is null then return events; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy_m is null or p_accuracy_m < 0 or p_accuracy_m > 200 then
    return events;
  end if;

  select * into st from tech_presence_state where user_id = uid for update;

  -- Still at the current store unless clearly beyond its radius (+50 m), or it no longer counts.
  if st.site_id is not null then
    select s.* into cur_site from sites s
     where s.id = st.site_id and s.active and s.latitude is not null and s.longitude is not null
       and exists (select 1 from site_members m where m.site_id = s.id and m.user_id = uid);
    if cur_site.id is not null
       and public.geo_distance_m(p_lat, p_lng, cur_site.latitude, cur_site.longitude) <= cur_site.geofence_radius_m + 50 then
      update tech_presence_state set last_ping_at = v_now where user_id = uid;
      return events;
    end if;
    insert into site_presence_events (user_id, site_id, shift_id, kind, at, source)
    values (uid, st.site_id, v_shift, 'exit', v_now, p_source);
    events := events || jsonb_build_object('kind', 'exit', 'site_id', st.site_id,
               'site_name', (select name from sites where id = st.site_id), 'at', v_now);
  end if;

  -- Inside one of their stores now? (nearest one, within its radius)
  select s.id into new_site
    from sites s join site_members m on m.site_id = s.id and m.user_id = uid
   where s.active and s.latitude is not null and s.longitude is not null
     and public.geo_distance_m(p_lat, p_lng, s.latitude, s.longitude) <= s.geofence_radius_m
   order by public.geo_distance_m(p_lat, p_lng, s.latitude, s.longitude)
   limit 1;

  if new_site is not null then
    insert into site_presence_events (user_id, site_id, shift_id, kind, at, source)
    values (uid, new_site, v_shift, 'enter', v_now, p_source);
    events := events || jsonb_build_object('kind', 'enter', 'site_id', new_site,
               'site_name', (select name from sites where id = new_site), 'at', v_now);
  end if;

  insert into tech_presence_state (user_id, site_id, since, last_ping_at)
  values (uid, new_site, v_now, v_now)
  on conflict (user_id) do update set
    since = case when tech_presence_state.site_id is not distinct from excluded.site_id
                 then tech_presence_state.since else v_now end,
    site_id = excluded.site_id,
    last_ping_at = v_now;
  return events;
end $$;

-- ---------- C) consent: agree / withdraw (withdraw closes the visit) ----------
-- Return type changes from timestamptz (0039) to jsonb, so the old version is dropped first.
drop function if exists public.set_location_consent(boolean);
create function public.set_location_consent(p_consent boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); events jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if p_consent then
    update profiles set location_consent_at = now() where id = uid;
  else
    -- Close the visit first so the 'left' comes back to the app (the consent trigger then finds nothing open).
    events := public.presence_close_visit(uid, 'consent_withdrawn');
    update profiles set location_consent_at = null where id = uid;
  end if;
  return events;
end $$;

-- ---------- D) "not at any store" rows: unrestricted admins and the tech only ----------
-- admin_site_ok(null) = admin_company_ok(null) = super admin, or an admin with no company limits.
drop policy if exists presence_state_select on public.tech_presence_state;
create policy presence_state_select on public.tech_presence_state for select to authenticated
  using (public.admin_site_ok(site_id)
         or user_id = auth.uid()
         or (site_id is not null and public.my_role() = 'manager' and public.is_site_member(site_id)));

-- ---------- grants ----------
revoke execute on function public.record_location_ping(double precision, double precision, double precision, text) from public, anon;
revoke execute on function public.set_location_consent(boolean) from public, anon;
grant execute on function public.record_location_ping(double precision, double precision, double precision, text) to authenticated;
grant execute on function public.set_location_consent(boolean) to authenticated;

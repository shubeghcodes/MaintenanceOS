-- =====================================================================
-- MaintenanceOS — Store geofences ("Version A")
-- Run after 0038. Safe to re-run.
--
-- While a tech is clocked in with the app open, the phone sends its location about once a
-- minute to record_location_ping(). When the tech walks into or out of one of their stores,
-- an 'enter' / 'exit' row is written and returned, so the app can push admins.
--
-- * sites.geofence_radius_m: how close counts as "at the store" (50–2000 m, default 150).
--   Uses the existing sites.latitude / sites.longitude; stores without both are ignored.
-- * profiles.location_consent_at: when the person agreed to location checks (null = not agreed).
-- * site_presence_events: arrived / left history. tech_presence_state: where each tech is now.
-- * Who can see them: admins (for the companies they manage; super admins and unrestricted
--   admins see all), the tech their own, GMs only for stores they belong to. Never vendors.
--   Nobody writes to these tables directly; only record_location_ping() does.
-- * Location is only checked during an open shift, only with consent, only for stores the tech
--   belongs to, and only from readings accurate to 200 m or better. Leaving needs the tech to be
--   50 m beyond the radius, so a reading wobbling at the edge doesn't flap in and out.
-- =====================================================================

alter table public.sites add column if not exists geofence_radius_m integer not null default 150;
do $$ begin
  alter table public.sites add constraint sites_geofence_radius_check check (geofence_radius_m between 50 and 2000);
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists location_consent_at timestamptz;

-- ---------- tables ----------
create table if not exists public.site_presence_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  site_id     uuid not null references public.sites(id) on delete cascade,
  shift_id    uuid references public.tech_shifts(id) on delete set null,
  kind        text not null check (kind in ('enter', 'exit')),
  at          timestamptz not null default now(),
  lat         double precision,
  lng         double precision,
  accuracy_m  double precision,
  source      text not null default 'ping' check (source in ('ping', 'clock_in', 'clock_out'))
);
create index if not exists site_presence_user_idx on public.site_presence_events (user_id, at desc);
create index if not exists site_presence_site_idx on public.site_presence_events (site_id, at desc);

create table if not exists public.tech_presence_state (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  site_id       uuid references public.sites(id) on delete set null,   -- null = not at any store
  since         timestamptz not null default now(),
  last_ping_at  timestamptz
);

alter table public.site_presence_events enable row level security;
alter table public.tech_presence_state  enable row level security;

drop policy if exists presence_events_select on public.site_presence_events;
create policy presence_events_select on public.site_presence_events for select to authenticated
  using (public.admin_site_ok(site_id)
         or user_id = auth.uid()
         or (public.my_role() = 'manager' and public.is_site_member(site_id)));

drop policy if exists presence_state_select on public.tech_presence_state;
create policy presence_state_select on public.tech_presence_state for select to authenticated
  using ((site_id is null and public.is_admin())
         or (site_id is not null and public.admin_site_ok(site_id))
         or user_id = auth.uid()
         or (site_id is not null and public.my_role() = 'manager' and public.is_site_member(site_id)));

-- Read only for signed-in users (rows still filtered above); nothing for anon.
revoke all on public.site_presence_events, public.tech_presence_state from public, anon, authenticated;
grant select on public.site_presence_events, public.tech_presence_state to authenticated;
grant all on public.site_presence_events, public.tech_presence_state to service_role;

-- ---------- distance ----------
-- Great-circle distance in metres (haversine). Good to well under a metre at store scale.
create or replace function public.geo_distance_m(lat1 double precision, lng1 double precision,
                                                 lat2 double precision, lng2 double precision)
returns double precision language sql immutable parallel safe set search_path = public as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;

-- ---------- consent ----------
-- p_consent true = agree now; false = withdraw (location checks stop).
drop function if exists public.set_location_consent();
create or replace function public.set_location_consent(p_consent boolean default true)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update profiles set location_consent_at = case when p_consent then now() end
   where id = auth.uid()
   returning location_consent_at into v;
  return v;
end $$;

-- ---------- the ping ----------
-- Returns a JSON array of new events: [{kind, site_id, site_name, at}] ([] when nothing changed
-- or the ping was not accepted). The app pushes admins for each one.
create or replace function public.record_location_ping(p_lat double precision, p_lng double precision,
                                                       p_accuracy_m double precision, p_source text default 'ping')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid        uuid := auth.uid();
  me         profiles;
  v_shift    uuid;
  st         tech_presence_state;
  cur_site   sites;
  d_cur      double precision;
  new_site   uuid;
  events     jsonb := '[]'::jsonb;
  v_now      timestamptz := now();
begin
  if p_source is null or p_source not in ('ping', 'clock_in', 'clock_out') then
    raise exception 'Unknown location source: %', p_source;
  end if;
  if uid is null then return events; end if;
  select * into me from profiles where id = uid;
  if me.id is null or not me.active or me.role <> 'tech' or me.location_consent_at is null then
    return events;
  end if;

  select id into v_shift from tech_shifts where user_id = uid and clock_out_at is null
   order by clock_in_at desc limit 1;
  select * into st from tech_presence_state where user_id = uid for update;

  -- Clocking out: leaving whatever store they're at, whatever the reading says.
  -- (Accepted with or without the shift still open, so the app can call it either side of clock_out.)
  if p_source = 'clock_out' then
    if st.site_id is not null then
      if v_shift is null then
        select id into v_shift from tech_shifts where user_id = uid order by clock_in_at desc limit 1;
      end if;
      insert into site_presence_events (user_id, site_id, shift_id, kind, at, lat, lng, accuracy_m, source)
      values (uid, st.site_id, v_shift, 'exit', v_now, p_lat, p_lng, p_accuracy_m, p_source);
      events := events || jsonb_build_object('kind', 'exit', 'site_id', st.site_id,
                 'site_name', (select name from sites where id = st.site_id), 'at', v_now);
    end if;
    insert into tech_presence_state (user_id, site_id, since, last_ping_at) values (uid, null, v_now, v_now)
    on conflict (user_id) do update set site_id = null,
      since = case when tech_presence_state.site_id is null then tech_presence_state.since else v_now end,
      last_ping_at = v_now;
    return events;
  end if;

  -- Everything else needs an open shift and a usable reading.
  if v_shift is null then return events; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy_m is null or p_accuracy_m < 0 or p_accuracy_m > 200 then
    return events;
  end if;

  -- Still at the current store unless clearly beyond its radius (+50 m), or it no longer counts.
  if st.site_id is not null then
    select s.* into cur_site from sites s
     where s.id = st.site_id and s.active and s.latitude is not null and s.longitude is not null
       and exists (select 1 from site_members m where m.site_id = s.id and m.user_id = uid);
    if cur_site.id is not null then
      d_cur := public.geo_distance_m(p_lat, p_lng, cur_site.latitude, cur_site.longitude);
      if d_cur <= cur_site.geofence_radius_m + 50 then
        update tech_presence_state set last_ping_at = v_now where user_id = uid;
        return events;
      end if;
    end if;
    insert into site_presence_events (user_id, site_id, shift_id, kind, at, lat, lng, accuracy_m, source)
    values (uid, st.site_id, v_shift, 'exit', v_now, p_lat, p_lng, p_accuracy_m, p_source);
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
    insert into site_presence_events (user_id, site_id, shift_id, kind, at, lat, lng, accuracy_m, source)
    values (uid, new_site, v_shift, 'enter', v_now, p_lat, p_lng, p_accuracy_m, p_source);
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

-- Signed-in users only (each function checks who is calling); never anon.
revoke execute on function public.record_location_ping(double precision, double precision, double precision, text) from public, anon;
revoke execute on function public.set_location_consent(boolean) from public, anon;
revoke execute on function public.geo_distance_m(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.record_location_ping(double precision, double precision, double precision, text) to authenticated;
grant execute on function public.set_location_consent(boolean) to authenticated;
grant execute on function public.geo_distance_m(double precision, double precision, double precision, double precision) to authenticated;

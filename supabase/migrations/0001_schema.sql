-- =====================================================================
-- MaintenanceOS CMMS — core schema
-- Run in Supabase SQL editor (or `supabase db push`).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Enums ----------------------------------------------------
create type public.user_role         as enum ('admin', 'manager', 'tech', 'vendor');
create type public.site_type         as enum ('qsr', 'dine_in', 'cre');
create type public.asset_status      as enum ('operational', 'needs_repair', 'down', 'retired');
create type public.wo_priority       as enum ('emergency', 'high', 'medium', 'low');
create type public.wo_status         as enum ('new', 'assigned', 'in_progress', 'on_hold', 'completed', 'cancelled');
create type public.wo_type           as enum ('reactive', 'preventive', 'compliance', 'project');
create type public.freq_unit         as enum ('day', 'week', 'month', 'year');
create type public.compliance_result as enum ('pass', 'fail', 'conditional');

-- ---------- Helpers --------------------------------------------------
create or replace function public.freq_interval(n int, u public.freq_unit)
returns interval language sql immutable as $$
  select case u
    when 'day'   then make_interval(days   => n)
    when 'week'  then make_interval(weeks  => n)
    when 'month' then make_interval(months => n)
    when 'year'  then make_interval(years  => n)
  end
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- Vendors --------------------------------------------------
create table public.vendors (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  trades          text[] not null default '{}',
  contact_name    text,
  email           text,
  phone           text,
  after_hours_phone text,
  license_number  text,
  coi_expires_on  date,
  hourly_rate     numeric(10,2),
  rating          smallint check (rating between 1 and 5),
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger vendors_touch before update on public.vendors for each row execute function public.touch_updated_at();

-- ---------- Profiles (1:1 with auth.users) ---------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  role        public.user_role not null default 'manager',
  vendor_id   uuid references public.vendors(id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- Create a profile whenever an auth user is created (invite or signup).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, vendor_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'manager'),
    nullif(new.raw_user_meta_data->>'vendor_id', '')::uuid
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Sites ----------------------------------------------------
create table public.sites (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  name        text not null,
  type        public.site_type not null,
  brand       text,
  address     text,
  city        text,
  state       text,
  zip         text,
  phone       text,
  sq_ft       integer,
  latitude    double precision,
  longitude   double precision,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger sites_touch before update on public.sites for each row execute function public.touch_updated_at();

create table public.site_members (
  site_id  uuid not null references public.sites(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  primary key (site_id, user_id)
);

-- ---------- Assets ---------------------------------------------------
create table public.assets (
  id                  uuid primary key default gen_random_uuid(),
  site_id             uuid not null references public.sites(id) on delete cascade,
  name                text not null,
  tag                 text,
  category            text not null default 'Other',
  location_detail     text,
  manufacturer        text,
  model               text,
  serial_number       text,
  install_date        date,
  warranty_expires_on date,
  purchase_cost       numeric(12,2),
  expected_life_years smallint,
  status              public.asset_status not null default 'operational',
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index assets_site_idx on public.assets(site_id);
create trigger assets_touch before update on public.assets for each row execute function public.touch_updated_at();

-- ---------- Preventive maintenance schedules -------------------------
create table public.pm_schedules (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  site_id            uuid not null references public.sites(id) on delete cascade,
  asset_id           uuid references public.assets(id) on delete cascade,
  category           text not null default 'Other',
  instructions       text,
  checklist          text[] not null default '{}',
  frequency_interval integer not null default 1 check (frequency_interval > 0),
  frequency_unit     public.freq_unit not null default 'month',
  next_due_on        date not null,
  lead_days          integer not null default 7 check (lead_days >= 0),
  priority           public.wo_priority not null default 'medium',
  assigned_tech_id   uuid references public.profiles(id) on delete set null,
  vendor_id          uuid references public.vendors(id) on delete set null,
  estimated_hours    numeric(6,2),
  active             boolean not null default true,
  last_generated_on  date,
  last_completed_on  date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index pm_site_idx on public.pm_schedules(site_id);
create trigger pm_touch before update on public.pm_schedules for each row execute function public.touch_updated_at();

-- ---------- Compliance -----------------------------------------------
create table public.compliance_requirements (
  id                 uuid primary key default gen_random_uuid(),
  site_id            uuid not null references public.sites(id) on delete cascade,
  name               text not null,          -- e.g. "Hood & duct cleaning"
  category           text not null default 'Fire/Life Safety',
  authority          text,                   -- e.g. "County Fire Marshal", "NFPA 96"
  frequency_interval integer not null default 1 check (frequency_interval > 0),
  frequency_unit     public.freq_unit not null default 'year',
  last_completed_on  date,
  next_due_on        date not null,
  lead_days          integer not null default 21 check (lead_days >= 0),
  auto_create_wo     boolean not null default true,
  vendor_id          uuid references public.vendors(id) on delete set null,
  notes              text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index compliance_site_idx on public.compliance_requirements(site_id);
create trigger compliance_touch before update on public.compliance_requirements for each row execute function public.touch_updated_at();

-- ---------- Work orders ----------------------------------------------
create table public.work_orders (
  id                    uuid primary key default gen_random_uuid(),
  number                bigint generated by default as identity (start with 1001) unique,
  site_id               uuid not null references public.sites(id) on delete cascade,
  asset_id              uuid references public.assets(id) on delete set null,
  title                 text not null,
  description           text,
  category              text not null default 'Other',
  location_detail       text,
  priority              public.wo_priority not null default 'medium',
  status                public.wo_status not null default 'new',
  type                  public.wo_type not null default 'reactive',
  requested_by          uuid references public.profiles(id) on delete set null,
  assigned_tech_id      uuid references public.profiles(id) on delete set null,
  vendor_id             uuid references public.vendors(id) on delete set null,
  due_at                timestamptz,
  nte_amount            numeric(12,2),         -- not-to-exceed for vendors
  labor_hours           numeric(8,2) not null default 0,
  labor_cost            numeric(12,2) not null default 0,
  parts_cost            numeric(12,2) not null default 0,
  vendor_invoice_amount numeric(12,2) not null default 0,
  invoice_number        text,
  total_cost            numeric(12,2) generated always as (labor_cost + parts_cost + vendor_invoice_amount) stored,
  resolution_notes      text,
  pm_schedule_id        uuid references public.pm_schedules(id) on delete set null,
  compliance_requirement_id uuid references public.compliance_requirements(id) on delete set null,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index wo_site_idx     on public.work_orders(site_id);
create index wo_status_idx   on public.work_orders(status);
create index wo_asset_idx    on public.work_orders(asset_id);
create index wo_vendor_idx   on public.work_orders(vendor_id);
create index wo_tech_idx     on public.work_orders(assigned_tech_id);
create trigger wo_touch before update on public.work_orders for each row execute function public.touch_updated_at();

create table public.work_order_events (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders(id) on delete cascade,
  user_id        uuid references public.profiles(id) on delete set null,
  kind           text not null default 'comment',   -- comment | status | assignment | system
  body           text,
  from_status    public.wo_status,
  to_status      public.wo_status,
  created_at     timestamptz not null default now()
);
create index wo_events_wo_idx on public.work_order_events(work_order_id, created_at);

create table public.compliance_records (
  id                         uuid primary key default gen_random_uuid(),
  requirement_id             uuid not null references public.compliance_requirements(id) on delete cascade,
  completed_on               date not null,
  result                     public.compliance_result not null default 'pass',
  vendor_id                  uuid references public.vendors(id) on delete set null,
  work_order_id              uuid references public.work_orders(id) on delete set null,
  certificate_number         text,
  notes                      text,
  recorded_by                uuid references public.profiles(id) on delete set null,
  created_at                 timestamptz not null default now()
);
create index compliance_records_req_idx on public.compliance_records(requirement_id, completed_on desc);

-- Generic file attachments (photos, invoices, certificates)
create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null check (entity_type in ('work_order', 'asset', 'compliance')),
  entity_id     uuid not null,
  storage_path  text not null unique,
  file_name     text not null,
  content_type  text,
  size_bytes    bigint,
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index attachments_entity_idx on public.attachments(entity_type, entity_id);

-- =====================================================================
-- Work order business rules (triggers)
-- =====================================================================

-- Default due date from priority SLA when none is given.
create or replace function public.wo_before_insert()
returns trigger language plpgsql as $$
begin
  if new.due_at is null then
    new.due_at := now() + case new.priority
      when 'emergency' then interval '4 hours'
      when 'high'      then interval '24 hours'
      when 'medium'    then interval '3 days'
      else                  interval '7 days'
    end;
  end if;
  if new.status = 'new' and (new.assigned_tech_id is not null or new.vendor_id is not null) then
    new.status := 'assigned';
  end if;
  if new.requested_by is null then
    new.requested_by := auth.uid();
  end if;
  return new;
end $$;
create trigger wo_before_insert before insert on public.work_orders
  for each row execute function public.wo_before_insert();

-- Status timestamps + auto-advance new → assigned.
create or replace function public.wo_before_update()
returns trigger language plpgsql as $$
begin
  if new.status = 'new' and (new.assigned_tech_id is not null or new.vendor_id is not null) then
    new.status := 'assigned';
  end if;
  if new.status = 'in_progress' and old.status <> 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger wo_before_update before update on public.work_orders
  for each row execute function public.wo_before_update();

-- Activity log + PM/compliance roll-forward.
create or replace function public.wo_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.compliance_requirements;
begin
  if tg_op = 'INSERT' then
    insert into work_order_events (work_order_id, user_id, kind, body, to_status)
    values (new.id, auth.uid(), 'system',
            case new.type when 'preventive' then 'Created from PM schedule'
                          when 'compliance' then 'Created from compliance requirement'
                          else 'Request submitted' end,
            new.status);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into work_order_events (work_order_id, user_id, kind, from_status, to_status)
    values (new.id, auth.uid(), 'status', old.status, new.status);
  end if;

  if new.assigned_tech_id is distinct from old.assigned_tech_id
     or new.vendor_id is distinct from old.vendor_id then
    insert into work_order_events (work_order_id, user_id, kind, body)
    values (new.id, auth.uid(), 'assignment',
      concat_ws(' · ',
        (select 'Tech: ' || coalesce(full_name, email) from profiles where id = new.assigned_tech_id),
        (select 'Vendor: ' || name from vendors where id = new.vendor_id),
        case when new.assigned_tech_id is null and new.vendor_id is null then 'Unassigned' end));
  end if;

  if new.status = 'completed' and old.status <> 'completed' then
    if new.pm_schedule_id is not null then
      update pm_schedules set last_completed_on = current_date where id = new.pm_schedule_id;
    end if;
    if new.compliance_requirement_id is not null then
      select * into r from compliance_requirements where id = new.compliance_requirement_id;
      insert into compliance_records (requirement_id, completed_on, result, vendor_id, work_order_id, notes, recorded_by)
      values (r.id, current_date, 'pass', new.vendor_id, new.id,
              coalesce(new.resolution_notes, 'Closed via WO #' || new.number), auth.uid());
      update compliance_requirements
         set last_completed_on = current_date,
             next_due_on = (current_date + freq_interval(r.frequency_interval, r.frequency_unit))::date
       where id = r.id;
    end if;
  end if;
  return new;
end $$;
create trigger wo_after_change after insert or update on public.work_orders
  for each row execute function public.wo_after_change();

-- Manually logged pass/conditional records roll the requirement forward; a fail leaves it due.
create or replace function public.compliance_record_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.compliance_requirements;
begin
  if new.work_order_id is not null then return new; end if;  -- already handled by WO trigger
  select * into r from compliance_requirements where id = new.requirement_id;
  if new.result <> 'fail' and (r.last_completed_on is null or new.completed_on >= r.last_completed_on) then
    update compliance_requirements
       set last_completed_on = new.completed_on,
           next_due_on = (new.completed_on + freq_interval(r.frequency_interval, r.frequency_unit))::date
     where id = r.id;
  end if;
  return new;
end $$;
create trigger compliance_record_after_insert after insert on public.compliance_records
  for each row execute function public.compliance_record_after_insert();

-- =====================================================================
-- Scheduler: create PM + compliance work orders that are coming due.
-- Called daily by /api/cron/generate (or pg_cron), and by the
-- "Run scheduler now" button for admins.
-- =====================================================================
create or replace function public.generate_due_work_orders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  s public.pm_schedules;
  c public.compliance_requirements;
  v_next date;
  n int := 0;
begin
  -- Only admins (or service role / cron, where auth.uid() is null) may run this.
  if auth.uid() is not null and not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Only admins can run the scheduler';
  end if;

  for s in select * from pm_schedules
            where active and next_due_on - lead_days <= current_date
  loop
    if not exists (select 1 from work_orders
                    where pm_schedule_id = s.id and status not in ('completed', 'cancelled')) then
      insert into work_orders (site_id, asset_id, title, description, category, priority, type,
                               assigned_tech_id, vendor_id, due_at, pm_schedule_id)
      values (s.site_id, s.asset_id, 'PM: ' || s.title,
              concat_ws(E'\n\n', s.instructions,
                        case when cardinality(s.checklist) > 0
                             then 'Checklist:' || E'\n' || array_to_string(array(select '☐ ' || x from unnest(s.checklist) x), E'\n') end),
              s.category, s.priority, 'preventive',
              s.assigned_tech_id, s.vendor_id,
              (s.next_due_on + time '17:00') at time zone 'America/Los_Angeles',
              s.id);
      n := n + 1;

      v_next := s.next_due_on;
      loop
        v_next := (v_next + freq_interval(s.frequency_interval, s.frequency_unit))::date;
        exit when v_next - s.lead_days > current_date;
      end loop;
      update pm_schedules set next_due_on = v_next, last_generated_on = current_date where id = s.id;
    end if;
  end loop;

  for c in select * from compliance_requirements
            where active and auto_create_wo and next_due_on - lead_days <= current_date
  loop
    if not exists (select 1 from work_orders
                    where compliance_requirement_id = c.id and status not in ('completed', 'cancelled')) then
      insert into work_orders (site_id, title, description, category, priority, type, vendor_id, due_at,
                               compliance_requirement_id)
      values (c.site_id, 'Compliance: ' || c.name,
              concat_ws(E'\n', 'Due ' || to_char(c.next_due_on, 'Mon DD, YYYY'),
                        case when c.authority is not null then 'Authority / standard: ' || c.authority end,
                        c.notes),
              c.category,
              case when c.next_due_on < current_date then 'high'::wo_priority else 'medium'::wo_priority end,
              'compliance', c.vendor_id,
              (c.next_due_on + time '17:00') at time zone 'America/Los_Angeles',
              c.id);
      n := n + 1;
    end if;
  end loop;

  return n;
end $$;

-- =====================================================================
-- Row-level security
-- =====================================================================
create or replace function public.my_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid() and active), false)
$$;

create or replace function public.my_vendor_id()
returns uuid language sql stable security definer set search_path = public as $$
  select vendor_id from profiles where id = auth.uid() and role = 'vendor' and active
$$;

create or replace function public.is_site_member(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from site_members m join profiles p on p.id = m.user_id
                  where m.site_id = p_site and m.user_id = auth.uid() and p.active and p.role <> 'vendor')
$$;

-- Vendors can see a site only if they have a work order there.
create or replace function public.vendor_has_site(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from work_orders w
                  where w.site_id = p_site and w.vendor_id is not null and w.vendor_id = public.my_vendor_id())
$$;

-- Users may edit their own name/phone, but not their role, vendor link or active flag.
create or replace function public.profiles_guard()
returns trigger language plpgsql as $$
begin
  if not public.is_admin() and auth.uid() is not null then
    if new.role is distinct from old.role or new.vendor_id is distinct from old.vendor_id
       or new.active is distinct from old.active then
      raise exception 'Only admins can change roles or access';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

alter table public.profiles                enable row level security;
alter table public.vendors                 enable row level security;
alter table public.sites                   enable row level security;
alter table public.site_members            enable row level security;
alter table public.assets                  enable row level security;
alter table public.pm_schedules            enable row level security;
alter table public.compliance_requirements enable row level security;
alter table public.compliance_records      enable row level security;
alter table public.work_orders             enable row level security;
alter table public.work_order_events       enable row level security;
alter table public.attachments             enable row level security;

-- profiles
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- vendors
create policy vendors_select on public.vendors for select to authenticated
  using (public.my_role() in ('admin', 'manager', 'tech') or id = public.my_vendor_id());
create policy vendors_admin on public.vendors for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- sites
create policy sites_select on public.sites for select to authenticated
  using (public.is_site_member(id) or public.vendor_has_site(id));
create policy sites_admin on public.sites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- site_members
create policy members_select on public.site_members for select to authenticated
  using (user_id = auth.uid() or public.is_site_member(site_id));
create policy members_admin on public.site_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- assets
create policy assets_select on public.assets for select to authenticated
  using (public.is_site_member(site_id)
         or exists (select 1 from public.work_orders w where w.asset_id = assets.id));
create policy assets_write on public.assets for all to authenticated
  using (public.is_admin() or (public.my_role() = 'tech' and public.is_site_member(site_id)))
  with check (public.is_admin() or (public.my_role() = 'tech' and public.is_site_member(site_id)));

-- pm_schedules
create policy pm_select on public.pm_schedules for select to authenticated
  using (public.is_site_member(site_id));
create policy pm_admin on public.pm_schedules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- compliance
create policy creq_select on public.compliance_requirements for select to authenticated
  using (public.is_site_member(site_id));
create policy creq_admin on public.compliance_requirements for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy crec_select on public.compliance_records for select to authenticated
  using (exists (select 1 from public.compliance_requirements r where r.id = requirement_id));
create policy crec_insert on public.compliance_records for insert to authenticated
  with check (public.my_role() in ('admin', 'tech')
              and exists (select 1 from public.compliance_requirements r where r.id = requirement_id));
create policy crec_admin on public.compliance_records for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- work orders
create policy wo_select on public.work_orders for select to authenticated
  using (public.is_site_member(site_id)
         or assigned_tech_id = auth.uid()
         or (vendor_id is not null and vendor_id = public.my_vendor_id()));
create policy wo_insert on public.work_orders for insert to authenticated
  with check (public.is_admin()
              or (public.my_role() in ('manager', 'tech') and public.is_site_member(site_id)));
create policy wo_update on public.work_orders for update to authenticated
  using (public.is_site_member(site_id)
         or assigned_tech_id = auth.uid()
         or (vendor_id is not null and vendor_id = public.my_vendor_id()))
  with check (public.is_site_member(site_id)
         or assigned_tech_id = auth.uid()
         or (vendor_id is not null and vendor_id = public.my_vendor_id()));
create policy wo_delete on public.work_orders for delete to authenticated using (public.is_admin());

-- work order events (visible wherever the work order is)
create policy woe_select on public.work_order_events for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id));
create policy woe_insert on public.work_order_events for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.work_orders w where w.id = work_order_id));

-- attachments follow their parent record
create policy att_select on public.attachments for select to authenticated
  using ((entity_type = 'work_order' and exists (select 1 from public.work_orders w where w.id = entity_id))
      or (entity_type = 'asset'      and exists (select 1 from public.assets a where a.id = entity_id))
      or (entity_type = 'compliance' and exists (select 1 from public.compliance_requirements c where c.id = entity_id)));
create policy att_insert on public.attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and (
         (entity_type = 'work_order' and exists (select 1 from public.work_orders w where w.id = entity_id))
      or (entity_type = 'asset'      and exists (select 1 from public.assets a where a.id = entity_id))
      or (entity_type = 'compliance' and exists (select 1 from public.compliance_requirements c where c.id = entity_id))));
create policy att_delete on public.attachments for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_admin());

grant execute on function public.generate_due_work_orders() to authenticated, service_role;

-- =====================================================================
-- Storage bucket for photos, invoices and certificates (private)
-- =====================================================================
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments'
         and exists (select 1 from public.attachments a where a.storage_path = storage.objects.name));
create policy "attachments upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments');
create policy "attachments delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (owner = auth.uid() or public.is_admin()));

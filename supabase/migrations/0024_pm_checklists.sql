-- =====================================================================
-- MaintenanceOS — PM templates & photo checklists
-- Run after 0023. Safe to re-run.
--
-- * pm_templates / pm_template_items: a reusable PM list (e.g. "Quarterly HVAC") with one row per
--   activity and its photo rule: before & after, one photo, or none.
-- * pm_schedules.template_id: a schedule made from a template. Every work order it generates gets
--   the template's activities as checklist items (wo_checklist_items).
-- * Each item needs a result (OK / Needs repair / N/A) and the photos its rule asks for
--   (N/A needs a reason instead of photos). A work order can't be completed until every item is done.
-- =====================================================================

-- ---------- Templates -------------------------------------------------
create table if not exists public.pm_templates (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  category           text not null default 'Other',
  instructions       text,
  frequency_interval integer not null default 3 check (frequency_interval > 0),
  frequency_unit     public.freq_unit not null default 'month',
  priority           public.wo_priority not null default 'medium',
  lead_days          integer not null default 7 check (lead_days >= 0),
  estimated_hours    numeric(6,2),
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.pm_template_items (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.pm_templates(id) on delete cascade,
  position     integer not null default 0,
  activity     text not null,
  description  text,
  photo_rule   text not null default 'before_after' check (photo_rule in ('before_after', 'single', 'none')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists pm_template_items_tpl_idx on public.pm_template_items(template_id, position);

alter table public.pm_schedules add column if not exists template_id uuid references public.pm_templates(id) on delete set null;
create index if not exists pm_template_idx on public.pm_schedules(template_id) where template_id is not null;

drop trigger if exists pm_templates_touch on public.pm_templates;
create trigger pm_templates_touch before update on public.pm_templates for each row execute function public.touch_updated_at();

-- ---------- Checklist items on work orders ---------------------------
create table if not exists public.wo_checklist_items (
  id                  uuid primary key default gen_random_uuid(),
  work_order_id       uuid not null references public.work_orders(id) on delete cascade,
  template_item_id    uuid references public.pm_template_items(id) on delete set null,
  position            integer not null default 0,
  activity            text not null,
  description         text,
  photo_rule          text not null default 'before_after' check (photo_rule in ('before_after', 'single', 'none')),
  result              text check (result in ('ok', 'needs_repair', 'na')),
  note                text,
  before_attachment_id uuid references public.attachments(id) on delete set null,
  after_attachment_id  uuid references public.attachments(id) on delete set null,
  followup_wo_id      uuid references public.work_orders(id) on delete set null,
  completed_by        uuid references public.profiles(id) on delete set null,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists wo_checklist_wo_idx on public.wo_checklist_items(work_order_id, position);

-- Is this item finished? (result set; N/A and Needs repair need a note; photos per rule unless N/A)
create or replace function public.checklist_item_done(i public.wo_checklist_items)
returns boolean language sql immutable set search_path = public as $$
  select i.result is not null
     and (i.result not in ('na', 'needs_repair') or coalesce(btrim(i.note), '') <> '')
     and (i.result = 'na'
          or i.photo_rule = 'none'
          or (i.photo_rule = 'single' and (i.after_attachment_id is not null or i.before_attachment_id is not null))
          or (i.photo_rule = 'before_after' and i.before_attachment_id is not null and i.after_attachment_id is not null))
$$;

-- Item guard: only result / note / photos / follow-up change for non-admins; nothing changes on a closed job.
create or replace function public.wo_checklist_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_status public.wo_status;
begin
  select status into v_status from work_orders where id = new.work_order_id;
  if auth.uid() is not null and v_status in ('completed', 'cancelled') then
    raise exception 'This work order is closed; its checklist can''t be changed';
  end if;
  if auth.uid() is not null and not public.is_admin() then
    if v_status = 'requested' then raise exception 'This work order hasn''t been approved yet'; end if;
    new.activity := old.activity;
    new.description := old.description;
    new.photo_rule := old.photo_rule;
    new.position := old.position;
    new.work_order_id := old.work_order_id;
    new.template_item_id := old.template_item_id;
  end if;
  if public.checklist_item_done(new) then
    if not public.checklist_item_done(old) or new.result is distinct from old.result then
      new.completed_by := coalesce(auth.uid(), new.completed_by);
      new.completed_at := now();
    end if;
  else
    new.completed_by := null;
    new.completed_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists wo_checklist_guard on public.wo_checklist_items;
create trigger wo_checklist_guard before update on public.wo_checklist_items
  for each row execute function public.wo_checklist_guard();

-- PM work orders made from a template schedule get the template's activities.
create or replace function public.wo_add_template_checklist()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tpl uuid;
begin
  if new.pm_schedule_id is null then return new; end if;
  select template_id into v_tpl from pm_schedules where id = new.pm_schedule_id;
  if v_tpl is null then return new; end if;
  insert into wo_checklist_items (work_order_id, template_item_id, position, activity, description, photo_rule)
  select new.id, ti.id, ti.position, ti.activity, ti.description, ti.photo_rule
    from pm_template_items ti
   where ti.template_id = v_tpl and ti.active
   order by ti.position;
  return new;
end $$;
drop trigger if exists wo_add_template_checklist on public.work_orders;
create trigger wo_add_template_checklist after insert on public.work_orders
  for each row execute function public.wo_add_template_checklist();

-- A work order with an unfinished checklist can't be completed (or sent to GM sign-off / vendor review).
create or replace function public.wo_checklist_open(p_wo uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from wo_checklist_items i where i.work_order_id = p_wo and not public.checklist_item_done(i)
$$;

create or replace function public.wo_checklist_completion_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.status in ('completed', 'awaiting_signoff') and old.status is distinct from new.status then
    n := public.wo_checklist_open(new.id);
    if n > 0 then
      raise exception 'Finish the PM checklist first: % item(s) still need a result and photos', n;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists wo_checklist_completion_guard on public.work_orders;
create trigger wo_checklist_completion_guard before update of status on public.work_orders
  for each row execute function public.wo_checklist_completion_guard();

-- ---------- Row-level security ---------------------------------------
alter table public.pm_templates       enable row level security;
alter table public.pm_template_items  enable row level security;
alter table public.wo_checklist_items enable row level security;

drop policy if exists pmt_select on public.pm_templates;
create policy pmt_select on public.pm_templates for select to authenticated using (public.my_role() in ('admin', 'tech', 'manager'));
drop policy if exists pmt_write on public.pm_templates;
create policy pmt_write on public.pm_templates for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists pmti_select on public.pm_template_items;
create policy pmti_select on public.pm_template_items for select to authenticated using (public.my_role() in ('admin', 'tech', 'manager'));
drop policy if exists pmti_write on public.pm_template_items;
create policy pmti_write on public.pm_template_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Checklist items: visible wherever the work order is; techs and admins fill them in; admins add/remove.
drop policy if exists woci_select on public.wo_checklist_items;
create policy woci_select on public.wo_checklist_items for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id));
drop policy if exists woci_update on public.wo_checklist_items;
create policy woci_update on public.wo_checklist_items for update to authenticated
  using (public.my_role() in ('admin', 'tech') and exists (select 1 from public.work_orders w where w.id = work_order_id))
  with check (public.my_role() in ('admin', 'tech') and exists (select 1 from public.work_orders w where w.id = work_order_id));
drop policy if exists woci_insert on public.wo_checklist_items;
create policy woci_insert on public.wo_checklist_items for insert to authenticated with check (public.is_admin());
drop policy if exists woci_delete on public.wo_checklist_items;
create policy woci_delete on public.wo_checklist_items for delete to authenticated using (public.is_admin());

grant all on public.pm_templates, public.pm_template_items, public.wo_checklist_items to authenticated, service_role;

-- Same lockdown as 0023 for the new functions.
revoke execute on function public.wo_checklist_guard(), public.wo_add_template_checklist(), public.wo_checklist_completion_guard()
  from public, anon, authenticated;
revoke execute on function public.wo_checklist_open(uuid), public.checklist_item_done(public.wo_checklist_items) from public, anon;

-- =====================================================================
-- MaintenanceOS — Spanish (Phase 1: tech screens)
-- Run after 0028. Safe to re-run.
-- * profiles.language: 'en' or 'es'. People change their own on My account; admins on Users.
-- * Spanish text for PM template activities, copied onto each PM work order's checklist.
-- =====================================================================
alter table public.profiles add column if not exists language text not null default 'en';
do $$ begin
  alter table public.profiles add constraint profiles_language_check check (language in ('en', 'es'));
exception when duplicate_object then null; end $$;

alter table public.pm_template_items  add column if not exists activity_es    text;
alter table public.pm_template_items  add column if not exists description_es text;
alter table public.wo_checklist_items add column if not exists activity_es    text;
alter table public.wo_checklist_items add column if not exists description_es text;

-- PM work orders copy the Spanish text along with the English.
create or replace function public.wo_add_template_checklist()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tpl uuid;
begin
  if new.pm_schedule_id is null then return new; end if;
  select template_id into v_tpl from pm_schedules where id = new.pm_schedule_id;
  if v_tpl is null then return new; end if;
  insert into wo_checklist_items (work_order_id, template_item_id, position, activity, description, activity_es, description_es, photo_rule)
  select new.id, ti.id, ti.position, ti.activity, ti.description, ti.activity_es, ti.description_es, ti.photo_rule
    from pm_template_items ti
   where ti.template_id = v_tpl and ti.active
   order by ti.position;
  return new;
end $$;
revoke execute on function public.wo_add_template_checklist() from public, anon, authenticated;

-- Techs can't change the checklist wording (English or Spanish), only results, notes and photos.
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
    new.activity_es := old.activity_es;
    new.description_es := old.description_es;
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

revoke execute on function public.wo_checklist_guard() from public, anon, authenticated;

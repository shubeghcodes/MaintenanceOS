-- =====================================================================
-- MaintenanceOS — First-time onboarding tour
-- Run after 0018. Safe to re-run.
--
-- Remembers when each person finished or skipped the tour so it only
-- appears on their first visit. "Take a tour" in the Help menu restarts it.
-- =====================================================================
alter table public.profiles add column if not exists tour_completed_at timestamptz;
alter table public.profiles add column if not exists tour_outcome text;
alter table public.profiles drop constraint if exists profiles_tour_outcome_check;
alter table public.profiles add constraint profiles_tour_outcome_check check (tour_outcome in ('completed', 'skipped'));

-- Only ever touches the signed-in person's own row.
create or replace function public.set_tour_state(p_outcome text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_outcome not in ('completed', 'skipped') then raise exception 'Unknown tour outcome'; end if;
  update profiles set tour_completed_at = now(), tour_outcome = p_outcome where id = auth.uid();
end $$;
revoke execute on function public.set_tour_state(text) from public, anon;
grant execute on function public.set_tour_state(text) to authenticated;

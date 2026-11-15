-- =====================================================================
-- MaintenanceOS — Push notifications (installable app)
-- Run after 0024. Safe to re-run.
--
-- * push_subscriptions: one row per phone/browser that turned on notifications. People manage their own;
--   the server (service role) reads them to send.
-- * app_secrets: server-only settings. Holds the VAPID key pair for web push when it isn't set as
--   environment variables (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY take priority). No policies, so only the
--   service role can read it.
-- =====================================================================

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists push_own_select on public.push_subscriptions;
create policy push_own_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists push_own_insert on public.push_subscriptions;
create policy push_own_insert on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists push_own_update on public.push_subscriptions;
create policy push_own_update on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists push_own_delete on public.push_subscriptions;
create policy push_own_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
grant all on public.push_subscriptions to authenticated, service_role;

create table if not exists public.app_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
grant all on public.app_secrets to service_role;

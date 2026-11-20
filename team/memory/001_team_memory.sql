-- =====================================================================
-- Team memory — schema `team_memory`
-- Target: the PRACTICE (sandbox) Supabase project ONLY.
--         NEVER the live project pkjjmhnbrzsshyfyuxiq.
-- Status: written, NOT applied. Apply only when M-Brain says so, and
--         only after confirming the project id is the practice one.
-- This file lives in team/memory/, never in supabase/migrations/, so it
-- can never run as part of the app's migrations.
--
-- What it does
--   * Own schema `team_memory`, kept apart from the app's `public` schema.
--   * App roles (anon, authenticated) and the app's server key role
--     (service_role) get NO rights on the schema, its tables or functions.
--   * Row-level security is ON on every table with NO
--     policies, so even if the schema were ever exposed, app roles see
--     nothing.
--   * work_log and decisions are add-only: updates and deletes are refused.
--   * Never store keys, passwords, link tokens or personal data from the app.
--
-- NOT done by SQL (dashboard setting): `team_memory` must NOT be added to
-- the API's "Exposed schemas" list. Leave that list as it is.
--
-- Safe to re-run: every statement is "if not exists" / "or replace" /
-- "drop ... if exists" first, and the seed insert skips existing rows.
-- =====================================================================

begin;

create schema if not exists team_memory;

-- ---------- lock the door before anything is inside ----------
revoke all on schema team_memory from public, anon, authenticated, service_role;
alter default privileges in schema team_memory revoke all on tables    from public, anon, authenticated, service_role;
alter default privileges in schema team_memory revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema team_memory revoke all on functions from public, anon, authenticated, service_role;

-- ---------- tables ----------
create table if not exists team_memory.chats (
  name           text primary key check (name ~ '^M-[A-Za-z]+$'),
  role           text not null,
  area           text not null,
  rulebook_path  text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists team_memory.tasks (
  id           bigint generated always as identity primary key,
  title        text not null check (length(title) between 1 and 200),
  detail       text,
  owner_chat   text not null references team_memory.chats(name),
  status       text not null default 'planned' check (status in
                 ('planned','approved','in_progress','reported','in_review','verified','sent_back','dropped')),
  branch       text,
  created_by   text not null references team_memory.chats(name),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  verified_at  timestamptz
);

create table if not exists team_memory.work_log (
  id          bigint generated always as identity primary key,
  task_id     bigint references team_memory.tasks(id),
  chat        text not null references team_memory.chats(name),
  kind        text not null check (kind in
                ('plan','progress','report','review','verification','alert','note')),
  summary     text not null check (length(summary) between 1 and 4000),
  branch      text,
  commit_sha  text check (commit_sha is null or commit_sha ~ '^[0-9a-f]{7,40}$'),
  created_at  timestamptz not null default now()
);

create table if not exists team_memory.decisions (
  id          bigint generated always as identity primary key,
  title       text not null check (length(title) between 1 and 200),
  decision    text not null,
  reason      text,
  decided_by  text not null check (decided_by in ('owner','M-Brain')),
  task_id     bigint references team_memory.tasks(id),
  replaces    bigint references team_memory.decisions(id),
  created_at  timestamptz not null default now()
);

create table if not exists team_memory.open_questions (
  id           bigint generated always as identity primary key,
  question     text not null check (length(question) between 1 and 2000),
  raised_by    text not null references team_memory.chats(name),
  waiting_on   text not null check (waiting_on = 'owner' or waiting_on ~ '^M-[A-Za-z]+$'),
  task_id      bigint references team_memory.tasks(id),
  status       text not null default 'open' check (status in ('open','answered','dropped')),
  answer       text,
  created_at   timestamptz not null default now(),
  answered_at  timestamptz
);

create index if not exists tasks_owner_status_idx   on team_memory.tasks (owner_chat, status);
create index if not exists work_log_task_idx        on team_memory.work_log (task_id);
create index if not exists work_log_chat_time_idx   on team_memory.work_log (chat, created_at desc);
create index if not exists decisions_task_idx       on team_memory.decisions (task_id);
create index if not exists open_questions_status_idx on team_memory.open_questions (status, waiting_on);

-- ---------- rules enforced by the database ----------
create or replace function team_memory.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function team_memory.refuse_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'team_memory.%: rows are add-only; add a new row instead', tg_table_name;
end $$;

revoke all on function team_memory.touch_updated_at() from public, anon, authenticated, service_role;
revoke all on function team_memory.refuse_change()    from public, anon, authenticated, service_role;

drop trigger if exists tasks_touch on team_memory.tasks;
create trigger tasks_touch before update on team_memory.tasks
  for each row execute function team_memory.touch_updated_at();

drop trigger if exists work_log_add_only on team_memory.work_log;
create trigger work_log_add_only before update or delete on team_memory.work_log
  for each row execute function team_memory.refuse_change();

drop trigger if exists decisions_add_only on team_memory.decisions;
create trigger decisions_add_only before update or delete on team_memory.decisions
  for each row execute function team_memory.refuse_change();

-- ---------- RLS on, no policies ----------
-- Not FORCED on purpose: on Supabase the `postgres` login (what the chats'
-- Supabase tool uses) owns these tables but is not a superuser; forced RLS
-- with no policies would lock the team out of its own memory. App roles are
-- kept out by the revokes above and below, with RLS as the second wall.
alter table team_memory.chats          enable row level security;
alter table team_memory.tasks          enable row level security;
alter table team_memory.work_log       enable row level security;
alter table team_memory.decisions      enable row level security;
alter table team_memory.open_questions enable row level security;

-- belt and braces: explicit revokes on what now exists
revoke all on all tables    in schema team_memory from public, anon, authenticated, service_role;
revoke all on all sequences in schema team_memory from public, anon, authenticated, service_role;

-- ---------- the team list (no personal data) ----------
insert into team_memory.chats (name, role, area, rulebook_path) values
  ('M-Brain',     'General contractor',  'Assigns, verifies, reports to the owner',                       'team/rulebooks/M-Brain.md'),
  ('M-Architect', 'Team machinery',      'Rule books, chats, team memory',                                'team/rulebooks/M-Architect.md'),
  ('M-Database',  'Database',            'Migrations, RLS policies, SQL functions',                       'team/rulebooks/M-Database.md'),
  ('M-Core',      'Core app',            'Work orders, PM, compliance, assets, sites, schedule',          'team/rulebooks/M-Core.md'),
  ('M-Vendor',    'Vendor side',         'Vendor portal, dispatch, vendor documents',                     'team/rulebooks/M-Vendor.md'),
  ('M-Money',     'Money',               'Labor, timesheets, purchases, budgets, invoices, analytics',    'team/rulebooks/M-Money.md'),
  ('M-Comms',     'Messaging',           'Email, inbound replies, push, cron routes, PWA',                'team/rulebooks/M-Comms.md'),
  ('M-Review',    'Checker (read-only)', 'Reviews every finished branch',                                 'team/rulebooks/M-Review.md'),
  ('M-Watchdog',  'Security alerts (read-only)', 'Daily security check',                                  'team/rulebooks/M-Watchdog.md')
on conflict (name) do nothing;

commit;

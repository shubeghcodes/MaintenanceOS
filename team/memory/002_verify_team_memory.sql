-- Read-only checks to run AFTER 001 is applied (practice project only).
-- Every row should show the "expected" value. Changes nothing.

-- 1. App roles have no access to the schema.
select r.role,
       has_schema_privilege(r.role, 'team_memory', 'USAGE')  as schema_usage,   -- expected: false
       has_schema_privilege(r.role, 'team_memory', 'CREATE') as schema_create   -- expected: false
from (values ('anon'), ('authenticated'), ('service_role')) as r(role);

-- 2. App roles have no rights on any table.
select r.role, t.table_name,
       has_table_privilege(r.role, format('team_memory.%I', t.table_name), 'SELECT,INSERT,UPDATE,DELETE') as any_right  -- expected: false
from (values ('anon'), ('authenticated'), ('service_role')) as r(role)
cross join information_schema.tables t
where t.table_schema = 'team_memory'
order by 1, 2;

-- 3. RLS on, and no policies. (Not forced, on purpose: see 001.)
select c.relname, c.relrowsecurity as rls_on,    -- expected: true
       (select count(*) from pg_policies p where p.schemaname = 'team_memory' and p.tablename = c.relname) as policies  -- expected: 0
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'team_memory' and c.relkind = 'r'
order by 1;

-- 4. Schema is not exposed through the API (PostgREST setting).
--    Expected: 'team_memory' does NOT appear in the result.
--    Also check Dashboard > Settings > API > Exposed schemas.
select setting from pg_settings where name = 'search_path';
select rolname, rolconfig from pg_roles where rolname = 'authenticator';

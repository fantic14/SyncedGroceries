-- Read-only checks for Supabase SQL Editor after CLI migration deployment.
-- Run as the database owner. This does not test a signed-in user's RLS scope.

-- Expected: 9 rows, every table_exists and rls_enabled value true.
with expected(schema_name, table_name) as (
  values
    ('public', 'profiles'),
    ('public', 'households'),
    ('public', 'household_members'),
    ('public', 'household_invites'),
    ('public', 'grocery_lists'),
    ('public', 'grocery_items'),
    ('public', 'household_notes'),
    ('private', 'invite_attempts'),
    ('private', 'applied_operations')
)
select e.schema_name, e.table_name,
       c.oid is not null as table_exists,
       coalesce(c.relrowsecurity, false) as rls_enabled
from expected e
left join pg_namespace n on n.nspname = e.schema_name
left join pg_class c on c.relnamespace = n.oid
  and c.relname = e.table_name and c.relkind = 'r'
order by e.schema_name, e.table_name;

-- Expected: 2 rows, realtime_enabled=true for both.
select e.table_name, exists (
  select 1 from pg_publication_tables p
  where p.pubname = 'supabase_realtime'
    and p.schemaname = 'public' and p.tablename = e.table_name
) as realtime_enabled
from (values ('grocery_items'), ('household_notes')) as e(table_name)
order by e.table_name;

-- Expected: 14 rows, rpc_exists=true, anon_execute=false,
-- authenticated_execute=true. Sign in through the app to exercise the RPCs;
-- SQL Editor normally has no auth.uid().
with expected(name, signature) as (
  values
    ('get_my_household', 'public.get_my_household()'),
    ('get_household_members', 'public.get_household_members()'),
    ('create_household', 'public.create_household(text,text)'),
    ('create_household_invite', 'public.create_household_invite()'),
    ('redeem_household_invite', 'public.redeem_household_invite(text,text)'),
    ('get_household_invites', 'public.get_household_invites()'),
    ('revoke_household_invite', 'public.revoke_household_invite(uuid)'),
    ('remove_household_member', 'public.remove_household_member(uuid)'),
    ('transfer_household_ownership', 'public.transfer_household_ownership(uuid)'),
    ('leave_household', 'public.leave_household()'),
    ('delete_my_account', 'public.delete_my_account()'),
    ('get_shared_household', 'public.get_shared_household(uuid)'),
    ('mutate_grocery', 'public.mutate_grocery(uuid,uuid,uuid,bigint,jsonb)'),
    ('save_household_note', 'public.save_household_note(uuid,uuid,bigint,text)')
), resolved as (
  select name, to_regprocedure(signature) as function_id from expected
)
select name, function_id is not null as rpc_exists,
       has_function_privilege('anon', function_id, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', function_id, 'EXECUTE')
         as authenticated_execute
from resolved
order by name;

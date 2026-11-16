-- Shared online groceries and notes. Durable offline replay is a later milestone.
begin;

create table public.grocery_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null unique references public.households(id) on delete cascade,
  name text not null default 'Groceries',
  created_at timestamptz not null default now(),
  unique (id, household_id)
);

create table public.grocery_items (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  list_id uuid not null,
  title text not null check (length(title) between 1 and 120 and title = btrim(title)),
  quantity text not null check (length(quantity) between 1 and 40 and quantity = btrim(quantity)),
  completed boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  deleted_at timestamptz,
  foreign key (list_id, household_id) references public.grocery_lists(id, household_id) on delete cascade
);
create index grocery_items_household_idx on public.grocery_items(household_id);

create table public.household_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null unique references public.households(id) on delete cascade,
  body text not null default '' check (length(body) <= 2000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision between 1 and 9007199254740991)
);

create table private.applied_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  household_id uuid not null references public.households(id) on delete cascade,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

alter table public.grocery_lists enable row level security;
alter table public.grocery_items enable row level security;
alter table public.household_notes enable row level security;
alter table private.applied_operations enable row level security;
revoke all on public.grocery_lists, public.grocery_items, public.household_notes from public, anon, authenticated;
revoke all on private.applied_operations from public, anon, authenticated;
grant select on public.grocery_lists, public.grocery_items, public.household_notes to authenticated;
create policy members_read_lists on public.grocery_lists for select to authenticated
  using (household_id = (select private.current_household_id()));
create policy members_read_groceries on public.grocery_items for select to authenticated
  using (household_id = (select private.current_household_id()));
create policy members_read_notes on public.household_notes for select to authenticated
  using (household_id = (select private.current_household_id()));

create function private.provision_shared_household() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.grocery_lists(household_id) values(new.id);
  insert into public.household_notes(household_id, updated_by) values(new.id, new.owner_id);
  return new;
end
$$;
revoke all on function private.provision_shared_household() from public, anon, authenticated;
create trigger provision_shared_household after insert on public.households
  for each row execute function private.provision_shared_household();
insert into public.grocery_lists(household_id) select h.id from public.households h;
insert into public.household_notes(household_id, updated_by) select h.id, h.owner_id from public.households h;

-- Lock the household before checking membership. Identity RPCs lock this same
-- row, so a removal/leave cannot race an already-authorized mutation or replay.
create function private.lock_shared_household(requested_house uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.lock_actor();
begin
  perform 1 from public.households h where h.id = requested_house for update;
  if not found or not exists(select 1 from public.household_members m
      where m.household_id = requested_house and m.user_id = actor) then
    raise exception 'You no longer have access to this household.' using errcode = '42501';
  end if;
  return actor;
end
$$;
revoke all on function private.lock_shared_household(uuid) from public, anon, authenticated;

create function public.get_shared_household(household_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare requested_house alias for $1; result jsonb;
begin
  perform private.lock_shared_household(requested_house);
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(i) - 'household_id' - 'list_id' order by i.created_at, i.id)
      from public.grocery_items i where i.household_id = requested_house), '[]'::jsonb),
    'note', (select to_jsonb(n) - 'household_id' from public.household_notes n where n.household_id = requested_house)
  ) into result;
  return result;
end
$$;

create function public.mutate_grocery(operation_id uuid, household_id uuid, item_id uuid, base_revision bigint, changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  op alias for $1; house alias for $2; target alias for $3; base alias for $4; patch alias for $5;
  actor uuid; current_item public.grocery_items; previous private.applied_operations;
  request_data jsonb; response jsonb; list uuid; exists_item boolean;
begin
  actor := private.lock_shared_household(house);
  if op is null or target is null or base is null or base < 0 or base > 9007199254740991
    or patch is null or jsonb_typeof(patch) <> 'object' or patch = '{}'::jsonb then
    raise exception 'Invalid grocery change.' using errcode = '22023';
  end if;
  request_data := jsonb_build_object('kind','grocery','household_id',house,'item_id',target,'base_revision',base,'changes',patch);
  select a.* into previous from private.applied_operations a where a.user_id = actor and a.operation_id = op;
  if found then
    if previous.request <> request_data then
      raise exception 'This operation code was already used for a different change.' using errcode = '22023';
    end if;
    return previous.result;
  end if;
  if exists(select 1 from jsonb_object_keys(patch) k where k not in ('title','quantity','completed','deleted'))
    or (patch ? 'title' and (jsonb_typeof(patch->'title') <> 'string' or length(btrim(patch->>'title')) not between 1 and 120))
    or (patch ? 'quantity' and (jsonb_typeof(patch->'quantity') <> 'string' or length(btrim(patch->>'quantity')) not between 1 and 40))
    or (patch ? 'completed' and jsonb_typeof(patch->'completed') <> 'boolean')
    or (patch ? 'deleted' and (patch <> '{"deleted":true}'::jsonb)) then
    raise exception 'Enter a valid item, quantity, or bought state.' using errcode = '22023';
  end if;
  select i.* into current_item from public.grocery_items i where i.id = target and i.household_id = house for update;
  exists_item := found;
  if (exists_item and (current_item.revision <> base or current_item.deleted_at is not null))
    or (not exists_item and base <> 0) then
    return jsonb_build_object('status','conflict','item',case when exists_item then to_jsonb(current_item) - 'household_id' - 'list_id' else null end);
  end if;
  if not exists_item then
    if not (patch ? 'title' and patch ? 'quantity') or patch ? 'deleted' then
      raise exception 'New groceries need an item name and quantity.' using errcode = '22023';
    end if;
    select l.id into list from public.grocery_lists l where l.household_id = house;
    begin
      insert into public.grocery_items(id, household_id, list_id, title, quantity, completed, created_by, updated_by)
        values(target, house, list, btrim(patch->>'title'), btrim(patch->>'quantity'), coalesce((patch->>'completed')::boolean, false), actor, actor)
        returning * into current_item;
    exception when unique_violation then
      -- Do not disclose a guessed record belonging to another household.
      return jsonb_build_object('status','conflict','item',null);
    end;
  else
    update public.grocery_items i set
      title = case when patch ? 'title' then btrim(patch->>'title') else i.title end,
      quantity = case when patch ? 'quantity' then btrim(patch->>'quantity') else i.quantity end,
      completed = case when patch ? 'completed' then (patch->>'completed')::boolean else i.completed end,
      deleted_at = case when patch ? 'deleted' then clock_timestamp() else i.deleted_at end,
      updated_by = actor, updated_at = clock_timestamp(), revision = i.revision + 1
      where i.id = target and i.household_id = house returning * into current_item;
  end if;
  response := jsonb_build_object('status','applied','item',to_jsonb(current_item) - 'household_id' - 'list_id');
  insert into private.applied_operations(user_id, operation_id, household_id, request, result) values(actor, op, house, request_data, response);
  return response;
end
$$;

create function public.save_household_note(operation_id uuid, household_id uuid, base_revision bigint, body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  op alias for $1; house alias for $2; base alias for $3; draft alias for $4;
  actor uuid; current_note public.household_notes; previous private.applied_operations;
  request_data jsonb; response jsonb;
begin
  actor := private.lock_shared_household(house);
  if op is null or base is null or base < 1 or base > 9007199254740991 or draft is null or length(draft) > 2000 then
    raise exception 'Enter a note of at most 2000 characters.' using errcode = '22023';
  end if;
  request_data := jsonb_build_object('kind','note','household_id',house,'base_revision',base,'body',draft);
  select a.* into previous from private.applied_operations a where a.user_id = actor and a.operation_id = op;
  if found then
    if previous.request <> request_data then
      raise exception 'This operation code was already used for a different change.' using errcode = '22023';
    end if;
    return previous.result;
  end if;
  select n.* into current_note from public.household_notes n where n.household_id = house for update;
  if current_note.revision <> base then
    return jsonb_build_object('status','conflict','note',to_jsonb(current_note) - 'household_id');
  end if;
  update public.household_notes n set body = draft, updated_by = actor, updated_at = clock_timestamp(), revision = n.revision + 1
    where n.household_id = house returning * into current_note;
  response := jsonb_build_object('status','applied','note',to_jsonb(current_note) - 'household_id');
  insert into private.applied_operations(user_id, operation_id, household_id, request, result) values(actor, op, house, request_data, response);
  return response;
end
$$;

revoke all on function public.get_shared_household(uuid), public.mutate_grocery(uuid,uuid,uuid,bigint,jsonb),
  public.save_household_note(uuid,uuid,bigint,text) from public, anon;
grant execute on function public.get_shared_household(uuid), public.mutate_grocery(uuid,uuid,uuid,bigint,jsonb),
  public.save_household_note(uuid,uuid,bigint,text) to authenticated;

-- Realtime events only invalidate client snapshots. Normal item deletion uses
-- an RLS-protected UPDATE tombstone; snapshots always recheck membership.
do $$
begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'grocery_items') then
      alter publication supabase_realtime add table public.grocery_items;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'household_notes') then
      alter publication supabase_realtime add table public.household_notes;
    end if;
  end if;
end
$$;

commit;

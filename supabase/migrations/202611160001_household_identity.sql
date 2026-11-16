-- Household identity boundary. Apply as the Supabase database owner.
-- No grocery/notes sync is introduced by this migration.
begin;

create schema if not exists private;
revoke all on schema private from public;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 60)
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  unique (household_id, user_id)
);
create index household_members_household_idx on public.household_members(household_id);
create unique index household_single_owner_idx on public.household_members(household_id) where role = 'owner';

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  token_hash bytea not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  check (expires_at > created_at)
);
create index household_invites_household_idx on public.household_invites(household_id);

create table private.invite_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0)
);

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table private.invite_attempts enable row level security;

-- No direct writes, even when guessed IDs satisfy a foreign key.
revoke all on public.profiles, public.households, public.household_members,
  public.household_invites from public, anon, authenticated;
revoke all on private.invite_attempts from public, anon, authenticated;
grant select on public.profiles, public.households, public.household_members to authenticated;

-- This helper avoids recursive membership RLS. Only the caller's own ID is used.
create function private.current_household_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.household_id from public.household_members m where m.user_id = auth.uid()
$$;
revoke all on function private.current_household_id() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_household_id() to authenticated;

create policy members_read_household on public.households for select to authenticated
  using (id = (select private.current_household_id()));
create policy members_read_members on public.household_members for select to authenticated
  using (household_id = (select private.current_household_id()));
create policy members_read_profiles on public.profiles for select to authenticated
  using (id = (select auth.uid()) or exists (
    select 1 from public.household_members m
    where m.user_id = profiles.id and m.household_id = (select private.current_household_id())
  ));
-- Invite hashes and attempt counters have no client-readable policies/grants.

create function private.lock_actor() returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  -- Serializes create/join/leave/account deletion for the same account.
  -- NO KEY UPDATE also permits FK checks during a concurrent ownership transfer.
  perform 1 from auth.users u where u.id = actor for no key update;
  if not found then raise exception 'Sign in again.' using errcode = '42501'; end if;
  return actor;
end
$$;
revoke all on function private.lock_actor() from public, anon, authenticated;

create function private.lock_owned_household(actor uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare house uuid; owner uuid;
begin
  select h.id, h.owner_id into house, owner
    from public.households h join public.household_members m on m.household_id = h.id
    where m.user_id = actor for update of h;
  if house is null or owner <> actor then
    raise exception 'Only the household owner can do that.' using errcode = '42501';
  end if;
  return house;
end
$$;
revoke all on function private.lock_owned_household(uuid) from public, anon, authenticated;

create function public.get_my_household()
returns table(id uuid, name text, owner_id uuid, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select h.id, h.name, h.owner_id, h.created_at from public.households h
    where h.id = private.current_household_id()
$$;

create function public.get_household_members()
returns table(user_id uuid, display_name text, role text, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.display_name, m.role, m.joined_at
    from public.household_members m join public.profiles p on p.id = m.user_id
    where m.household_id = private.current_household_id()
    order by m.joined_at, m.user_id
$$;

create function public.create_household(household_name text, display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.lock_actor(); house uuid;
begin
  if household_name is null or length(btrim(household_name)) not between 1 and 80
    or display_name is null or length(btrim(display_name)) not between 1 and 60 then
    raise exception 'Enter a household name and your name.' using errcode = '22023';
  end if;
  if exists (select 1 from public.household_members m where m.user_id = actor) then
    raise exception 'Leave your current household first.' using errcode = '23505';
  end if;
  insert into public.profiles(id, display_name) values(actor, btrim(display_name))
    on conflict(id) do update set display_name = excluded.display_name;
  insert into public.households(name, owner_id) values(btrim(household_name), actor) returning id into house;
  insert into public.household_members(household_id, user_id, role) values(house, actor, 'owner');
  return house;
end
$$;

create function public.create_household_invite()
returns table(id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.lock_actor(); house uuid; secret text;
begin
  house := private.lock_owned_household(actor);
  if (select count(*) from public.household_invites i where i.household_id = house
      and i.revoked_at is null and i.redeemed_at is null and i.expires_at > now()) >= 5
    or (select count(*) from public.household_invites i where i.household_id = house
      and i.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many invitations. Revoke an unused invite or try later.' using errcode = '54000';
  end if;
  -- Three independent secure UUIDs supply >256 bits of entropy before hashing.
  secret := encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex');
  return query insert into public.household_invites as i(household_id, token_hash, created_by, expires_at)
    values(house, sha256(convert_to(secret, 'UTF8')), actor, now() + interval '48 hours')
    returning i.id, secret, i.expires_at;
end
$$;

create function public.redeem_household_invite(invite_token text, display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.lock_actor(); house uuid; invitation public.household_invites; attempts integer;
begin
  insert into private.invite_attempts as a(user_id, window_start, attempts)
    values(actor, now(), 1)
    on conflict(user_id) do update set
      window_start = case when a.window_start <= now() - interval '15 minutes' then now() else a.window_start end,
      attempts = case when a.window_start <= now() - interval '15 minutes' then 1 else least(a.attempts + 1, 11) end
    returning a.attempts into attempts;
  -- Return NULL for invalid/rejected attempts, rather than rolling the counter back.
  if attempts > 10 or invite_token is null or invite_token !~ '^[a-f0-9]{64}$'
    or display_name is null or length(btrim(display_name)) not between 1 and 60
    or exists(select 1 from public.household_members m where m.user_id = actor) then
    return null;
  end if;
  select i.household_id into house from public.household_invites i
    where i.token_hash = sha256(convert_to(invite_token, 'UTF8'));
  if house is null then return null; end if;
  -- Consistent lock order: acting auth user, household, then invitation.
  perform 1 from public.households h where h.id = house for update;
  if not found then return null; end if;
  select i.* into invitation from public.household_invites i
    where i.token_hash = sha256(convert_to(invite_token, 'UTF8')) for update;
  if not found or invitation.expires_at <= clock_timestamp() or invitation.revoked_at is not null
    or invitation.redeemed_at is not null then return null; end if;
  insert into public.profiles(id, display_name) values(actor, btrim(display_name))
    on conflict(id) do update set display_name = excluded.display_name;
  insert into public.household_members(household_id, user_id, role) values(house, actor, 'member');
  update public.household_invites i set redeemed_at = now(), redeemed_by = actor where i.id = invitation.id;
  return house;
end
$$;

create function public.get_household_invites()
returns table(id uuid, expires_at timestamptz, revoked_at timestamptz, redeemed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.expires_at, i.revoked_at, i.redeemed_at
    from public.household_invites i join public.households h on h.id = i.household_id
    where h.owner_id = auth.uid() order by i.created_at desc limit 100
$$;

create function public.revoke_household_invite(invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.lock_actor(); house uuid;
begin
  house := private.lock_owned_household(actor);
  update public.household_invites i set revoked_at = coalesce(i.revoked_at, now())
    where i.id = invite_id and i.household_id = house;
  if not found then raise exception 'Invitation not found.' using errcode = '22023'; end if;
end
$$;

create function public.remove_household_member(member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.lock_actor(); house uuid;
begin
  house := private.lock_owned_household(actor);
  if member_id = actor then raise exception 'Transfer ownership or leave the household instead.' using errcode = '22023'; end if;
  delete from public.household_members m where m.user_id = member_id and m.household_id = house and m.role = 'member';
  if not found then raise exception 'Member not found.' using errcode = '22023'; end if;
end
$$;

create function public.transfer_household_ownership(member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.lock_actor(); house uuid;
begin
  house := private.lock_owned_household(actor);
  if member_id = actor or not exists(select 1 from public.household_members m
    where m.user_id = member_id and m.household_id = house) then
    raise exception 'Choose another current household member.' using errcode = '22023';
  end if;
  update public.household_members m set role = 'member' where m.user_id = actor;
  update public.household_members m set role = 'owner' where m.user_id = member_id;
  update public.households h set owner_id = member_id where h.id = house;
  -- Previously issued tokens must not outlive the owner's invitation authority.
  update public.household_invites i set revoked_at = now()
    where i.household_id = house and i.revoked_at is null and i.redeemed_at is null;
end
$$;

create function public.leave_household()
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.lock_actor(); house uuid; owner uuid;
begin
  select m.household_id into house from public.household_members m where m.user_id = actor;
  if house is null then return; end if;
  select h.owner_id into owner from public.households h where h.id = house for update;
  if owner = actor then
    if exists(select 1 from public.household_members m where m.household_id = house and m.user_id <> actor) then
      raise exception 'Transfer ownership before leaving.' using errcode = '22023';
    end if;
    delete from public.households h where h.id = house;
  else
    delete from public.household_members m where m.user_id = actor and m.household_id = house;
  end if;
end
$$;

create function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.lock_actor();
begin
  -- Applies the same owner-transfer rule; sole-owned households are deleted.
  perform public.leave_household();
  delete from auth.users u where u.id = actor;
end
$$;

-- Supabase public-schema defaults must not make definer RPCs anonymous APIs.
revoke all on function public.get_my_household(), public.get_household_members(),
  public.create_household(text,text), public.create_household_invite(),
  public.redeem_household_invite(text,text), public.get_household_invites(),
  public.revoke_household_invite(uuid), public.remove_household_member(uuid),
  public.transfer_household_ownership(uuid), public.leave_household(),
  public.delete_my_account() from public, anon;
grant execute on function public.get_my_household(), public.get_household_members(),
  public.create_household(text,text), public.create_household_invite(),
  public.redeem_household_invite(text,text), public.get_household_invites(),
  public.revoke_household_invite(uuid), public.remove_household_member(uuid),
  public.transfer_household_ownership(uuid), public.leave_household(),
  public.delete_my_account() to authenticated;

commit;

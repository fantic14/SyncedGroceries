import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// This is PostgreSQL, not a mocked query engine. Only Supabase's auth schema
// and JWT-to-UID mapping are substituted; JWT verification itself is not tested.
const db = new PGlite();
const users = {
  alice: '00000000-0000-4000-8000-000000000001',
  bob: '00000000-0000-4000-8000-000000000002',
  clara: '00000000-0000-4000-8000-000000000003',
  dan: '00000000-0000-4000-8000-000000000004',
};

before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text unique);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  const migration = await readFile(
    new URL(
      '../../supabase/migrations/202611160001_household_identity.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await db.exec(migration);
});

beforeEach(async () => {
  await db.exec(
    'truncate auth.users, public.households, public.profiles, private.invite_attempts cascade;',
  );
  for (const [name, id] of Object.entries(users)) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [
      id,
      `${name}@example.test`,
    ]);
  }
});

after(async () => db.close());

async function asUser(id, sql, params = [], role = 'authenticated') {
  await db.exec(`set role ${role}`);
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      id ?? '',
    ]);
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
  }
}

async function createHouse(user, name = 'Our place') {
  const { rows } = await asUser(
    user,
    'select public.create_household($1,$2) as id',
    [name, 'Student'],
  );
  return rows[0].id;
}

async function invite(user) {
  const { rows } = await asUser(
    user,
    'select * from public.create_household_invite()',
  );
  return rows[0];
}

async function join(user, token) {
  const { rows } = await asUser(
    user,
    'select public.redeem_household_invite($1,$2) as id',
    [token, 'Flatmate'],
  );
  return rows[0].id;
}

test('two households are isolated under actual authenticated RLS roles', async () => {
  const aliceHouse = await createHouse(users.alice, 'Flat A');
  await createHouse(users.bob, 'Flat B');
  const token = await invite(users.alice);
  assert.equal(await join(users.clara, token.token), aliceHouse);

  const houses = await asUser(users.clara, 'select * from public.households');
  assert.deepEqual(
    houses.rows.map((h) => h.name),
    ['Flat A'],
  );
  const members = await asUser(
    users.clara,
    'select * from public.household_members',
  );
  assert.deepEqual(
    new Set(members.rows.map((m) => m.user_id)),
    new Set([users.alice, users.clara]),
  );
  const profiles = await asUser(users.clara, 'select * from public.profiles');
  assert.deepEqual(
    new Set(profiles.rows.map((p) => p.id)),
    new Set([users.alice, users.clara]),
  );
  const guessed = await asUser(
    users.bob,
    'select * from public.households where id=$1',
    [aliceHouse],
  );
  assert.deepEqual(guessed.rows, []);
  assert.deepEqual(
    (await asUser(users.dan, 'select * from public.household_members')).rows,
    [],
  );
});

test('anonymous requests cannot read data or execute identity mutations', async () => {
  await createHouse(users.alice);
  await assert.rejects(
    asUser(null, 'select * from public.households', [], 'anon'),
    /permission denied/,
  );
  await assert.rejects(
    asUser(
      null,
      "select public.create_household('Forged','Student')",
      [],
      'anon',
    ),
    /permission denied/,
  );
  await assert.rejects(
    asUser(null, 'select public.get_my_household()', [], 'anon'),
    /permission denied/,
  );
  await assert.rejects(
    asUser(null, 'select public.create_household_invite()'),
    /Sign in first/,
  );
});

test('direct writes cannot forge membership, owner status, profiles, or invitations', async () => {
  const house = await createHouse(users.alice);
  await assert.rejects(
    asUser(
      users.bob,
      'insert into public.household_members(household_id,user_id,role) values($1,$2,$3)',
      [house, users.bob, 'owner'],
    ),
    /permission denied/,
  );
  await assert.rejects(
    asUser(
      users.alice,
      "update public.household_members set role='owner' where user_id=$1",
      [users.bob],
    ),
    /permission denied/,
  );
  await assert.rejects(
    asUser(
      users.alice,
      'update public.households set owner_id=$1 where id=$2',
      [users.bob, house],
    ),
    /permission denied/,
  );
  await assert.rejects(
    asUser(users.alice, "update public.profiles set display_name='Forged'"),
    /permission denied/,
  );
  await assert.rejects(
    asUser(users.alice, 'select * from public.household_invites'),
    /permission denied/,
  );
  await assert.rejects(
    asUser(users.alice, 'select * from private.invite_attempts'),
    /permission denied/,
  );
  await assert.rejects(
    asUser(users.alice, 'select private.lock_actor()'),
    /permission denied/,
  );
});

test('invitations store hashes only and redeem once into exactly one household', async () => {
  const house = await createHouse(users.alice);
  const issued = await invite(users.alice);
  assert.match(issued.token, /^[a-f0-9]{64}$/);
  const saved = (await db.query('select * from public.household_invites'))
    .rows[0];
  assert.equal('token' in saved, false);
  const hash = (
    await db.query(
      "select encode(token_hash,'hex') as hash from public.household_invites",
    )
  ).rows[0].hash;
  assert.notEqual(hash, issued.token);
  assert.equal(await join(users.clara, issued.token), house);
  assert.equal(await join(users.dan, issued.token), null);
  await assert.rejects(
    createHouse(users.clara),
    /Leave your current household/,
  );
  const metadata = await asUser(
    users.alice,
    'select * from public.get_household_invites()',
  );
  assert.deepEqual(Object.keys(metadata.rows[0]).sort(), [
    'expires_at',
    'id',
    'redeemed_at',
    'revoked_at',
  ]);
  assert.notEqual(metadata.rows[0].redeemed_at, null);
});

test('expired and revoked invitations are rejected without joining', async () => {
  await createHouse(users.alice);
  const expired = await invite(users.alice);
  // Preserve the expiry > creation constraint while making the invite expired.
  await db.query(
    "update public.household_invites set created_at=now()-interval '3 days', expires_at=now()-interval '1 day' where id=$1",
    [expired.id],
  );
  assert.equal(await join(users.bob, expired.token), null);
  const revoked = await invite(users.alice);
  await asUser(users.alice, 'select public.revoke_household_invite($1)', [
    revoked.id,
  ]);
  assert.equal(await join(users.bob, revoked.token), null);
  assert.deepEqual(
    (await asUser(users.bob, 'select * from public.get_my_household()')).rows,
    [],
  );
});

test('failed redemption attempts persist and block a valid token until the window resets', async () => {
  await createHouse(users.alice);
  const issued = await invite(users.alice);
  for (let i = 0; i < 10; i++)
    assert.equal(await join(users.bob, 'a'.repeat(64)), null);
  assert.equal(
    (
      await db.query(
        'select attempts from private.invite_attempts where user_id=$1',
        [users.bob],
      )
    ).rows[0].attempts,
    10,
  );
  assert.equal(await join(users.bob, issued.token), null);
  await db.query(
    "update private.invite_attempts set window_start=now()-interval '16 minutes' where user_id=$1",
    [users.bob],
  );
  assert.notEqual(await join(users.bob, issued.token), null);
});

test('only an owner can manage invitations or members, and removed members lose reads', async () => {
  const house = await createHouse(users.alice);
  const issued = await invite(users.alice);
  assert.equal(await join(users.clara, issued.token), house);
  await createHouse(users.bob, 'Other flat');
  await assert.rejects(invite(users.clara), /Only the household owner/);
  await assert.rejects(
    asUser(users.clara, 'select public.remove_household_member($1)', [
      users.alice,
    ]),
    /Only the household owner/,
  );
  await assert.rejects(
    asUser(users.bob, 'select public.revoke_household_invite($1)', [issued.id]),
    /Invitation not found/,
  );
  await asUser(users.alice, 'select public.remove_household_member($1)', [
    users.clara,
  ]);
  assert.deepEqual(
    (await asUser(users.clara, 'select * from public.households')).rows,
    [],
  );
  assert.deepEqual(
    (await asUser(users.clara, 'select * from public.household_members')).rows,
    [],
  );
  assert.deepEqual(
    (
      await asUser(users.clara, 'select * from public.profiles where id=$1', [
        users.alice,
      ])
    ).rows,
    [],
  );
});

test('owner transfer is required before leaving and updates all owner authority', async () => {
  await createHouse(users.alice);
  await join(users.clara, (await invite(users.alice)).token);
  const unredeemed = await invite(users.alice);
  await assert.rejects(
    asUser(users.alice, 'select public.leave_household()'),
    /Transfer ownership/,
  );
  await assert.rejects(
    asUser(users.alice, 'select public.transfer_household_ownership($1)', [
      users.bob,
    ]),
    /Choose another current/,
  );
  await asUser(users.alice, 'select public.transfer_household_ownership($1)', [
    users.clara,
  ]);
  const members = (
    await asUser(users.clara, 'select * from public.get_household_members()')
  ).rows;
  assert.equal(members.find((m) => m.user_id === users.clara).role, 'owner');
  assert.equal(members.find((m) => m.user_id === users.alice).role, 'member');
  assert.equal(
    (await asUser(users.clara, 'select * from public.get_my_household()'))
      .rows[0].owner_id,
    users.clara,
  );
  assert.equal(await join(users.bob, unredeemed.token), null);
  await assert.rejects(invite(users.alice), /Only the household owner/);
  await asUser(users.alice, 'select public.leave_household()');
  assert.deepEqual(
    (await asUser(users.alice, 'select * from public.get_my_household()')).rows,
    [],
  );
});

test('account deletion affects only the authenticated user and applies ownership rules', async () => {
  await createHouse(users.alice);
  await join(users.clara, (await invite(users.alice)).token);
  await assert.rejects(
    asUser(users.alice, 'select public.delete_my_account()'),
    /Transfer ownership/,
  );
  await asUser(users.clara, 'select public.delete_my_account()');
  assert.equal(
    (await db.query('select id from auth.users where id=$1', [users.clara]))
      .rows.length,
    0,
  );
  assert.equal(
    (await db.query('select id from auth.users where id=$1', [users.alice]))
      .rows.length,
    1,
  );
  await assert.rejects(createHouse(users.clara), /Sign in again/);
  await asUser(users.alice, 'select public.delete_my_account()');
  assert.equal(
    (await db.query('select id from public.households')).rows.length,
    0,
  );
  assert.equal(
    (await db.query('select id from public.profiles')).rows.length,
    0,
  );
});

test('owner cannot generate an unbounded number of active invitations', async () => {
  await createHouse(users.alice);
  for (let i = 0; i < 5; i++) await invite(users.alice);
  await assert.rejects(invite(users.alice), /Too many invitations/);
});

test('failed household creation is atomic and cannot create orphaned profiles or households', async () => {
  await assert.rejects(
    createHouse(users.alice, '   '),
    /Enter a household name/,
  );
  await assert.rejects(
    asUser(users.alice, 'select public.create_household($1,$2)', [
      'Valid house',
      'x'.repeat(61),
    ]),
    /Enter a household name/,
  );
  assert.deepEqual((await db.query('select id from public.profiles')).rows, []);
  assert.deepEqual(
    (await db.query('select id from public.households')).rows,
    [],
  );
  await createHouse(users.alice);
  await assert.rejects(
    createHouse(users.alice, 'Second house'),
    /Leave your current household/,
  );
  assert.equal(
    (await db.query('select id from public.households')).rows.length,
    1,
  );
});

test('revoking invitations does not bypass the hourly issuance limit', async () => {
  await createHouse(users.alice);
  for (let i = 0; i < 20; i++) {
    const issued = await invite(users.alice);
    await asUser(users.alice, 'select public.revoke_household_invite($1)', [
      issued.id,
    ]);
  }
  await assert.rejects(invite(users.alice), /Too many invitations/);
});

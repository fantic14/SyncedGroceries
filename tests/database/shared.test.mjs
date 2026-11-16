import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const users = {
  alice: '00000000-0000-4000-8000-000000000001',
  bob: '00000000-0000-4000-8000-000000000002',
  clara: '00000000-0000-4000-8000-000000000003',
};
let backfilled;

async function asUser(user, sql, parameters = [], role = 'authenticated') {
  await db.exec(`set role ${role}`);
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      user ?? '',
    ]);
    return await db.query(sql, parameters);
  } finally {
    await db.exec('reset role');
  }
}

async function house(user, name = 'Our place') {
  return (
    await asUser(user, 'select public.create_household($1,$2) as id', [
      name,
      'Student',
    ])
  ).rows[0].id;
}

async function join(owner, member) {
  const token = (
    await asUser(owner, 'select * from public.create_household_invite()')
  ).rows[0].token;
  return (
    await asUser(member, 'select public.redeem_household_invite($1,$2) as id', [
      token,
      'Flatmate',
    ])
  ).rows[0].id;
}

async function snapshot(user, id) {
  return (
    await asUser(user, 'select public.get_shared_household($1) as result', [id])
  ).rows[0].result;
}

async function change(
  user,
  id,
  item,
  revision,
  changes,
  operation = randomUUID(),
) {
  return (
    await asUser(
      user,
      'select public.mutate_grocery($1,$2,$3,$4,$5::jsonb) as result',
      [operation, id, item, revision, JSON.stringify(changes)],
    )
  ).rows[0].result;
}

async function note(user, id, revision, body, operation = randomUUID()) {
  return (
    await asUser(
      user,
      'select public.save_household_note($1,$2,$3,$4) as result',
      [operation, id, revision, body],
    )
  ).rows[0].result;
}

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
  await db.exec(
    await readFile(
      new URL(
        '../../supabase/migrations/202611160001_household_identity.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    users.alice,
    'legacy@example.test',
  ]);
  const existingHouse = await house(users.alice);
  await db.exec(
    await readFile(
      new URL(
        '../../supabase/migrations/202611160002_shared_groceries.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  backfilled = await snapshot(users.alice, existingHouse);
});

beforeEach(async () => {
  await db.exec(
    'truncate auth.users, public.households, public.profiles, private.invite_attempts cascade;',
  );
  for (const [name, id] of Object.entries(users))
    await db.query('insert into auth.users(id,email) values($1,$2)', [
      id,
      `${name}@example.test`,
    ]);
});
after(async () => db.close());

test('existing and newly created households each receive one list and an empty revisioned note', async () => {
  assert.deepEqual(backfilled.items, []);
  assert.equal(backfilled.note.body, '');
  assert.equal(backfilled.note.revision, 1);
  const id = await house(users.alice);
  const state = await snapshot(users.alice, id);
  assert.deepEqual(state.items, []);
  assert.equal(state.note.body, '');
  assert.equal(state.note.updated_by, users.alice);
  assert.equal(
    (
      await db.query(
        'select id from public.grocery_lists where household_id=$1',
        [id],
      )
    ).rows.length,
    1,
  );
});

test('members share their own data but another household cannot read or mutate it', async () => {
  const id = await house(users.alice);
  const other = await house(users.bob);
  await join(users.alice, users.clara);
  const item = randomUUID();
  await change(users.clara, id, item, 0, {
    title: 'Milk',
    quantity: '1 carton',
  });
  assert.equal(
    (await snapshot(users.alice, id)).items[0].created_by,
    users.clara,
  );
  assert.equal((await snapshot(users.bob, other)).items.length, 0);
  assert.deepEqual(
    (await asUser(users.bob, 'select * from public.grocery_items')).rows,
    [],
  );
  assert.deepEqual(
    (
      await asUser(
        users.bob,
        'select * from public.household_notes where household_id=$1',
        [id],
      )
    ).rows,
    [],
  );
  await assert.rejects(snapshot(users.bob, id), /no longer have access/);
  await assert.rejects(
    change(users.bob, id, item, 1, { completed: true }),
    /no longer have access/,
  );
  await assert.rejects(
    note(users.bob, id, 1, 'Forged note'),
    /no longer have access/,
  );
});

test('anonymous requests, direct DML, private replay results, and internal helpers are denied', async () => {
  const id = await house(users.alice);
  await assert.rejects(
    asUser(null, 'select public.get_shared_household($1)', [id], 'anon'),
    /permission denied/,
  );
  await assert.rejects(
    asUser(null, 'select * from public.household_notes', [], 'anon'),
    /permission denied/,
  );
  await assert.rejects(
    asUser(users.alice, "update public.household_notes set body='forged'"),
    /permission denied/,
  );
  await assert.rejects(
    asUser(
      users.alice,
      'insert into public.grocery_items(id) values(gen_random_uuid())',
    ),
    /permission denied/,
  );
  await assert.rejects(
    asUser(users.alice, 'delete from public.grocery_lists'),
    /permission denied/,
  );
  await assert.rejects(
    asUser(users.alice, 'select * from private.applied_operations'),
    /permission denied/,
  );
  await assert.rejects(
    asUser(users.alice, 'select private.lock_shared_household($1)', [id]),
    /permission denied/,
  );
  await assert.rejects(snapshot(null, id), /Sign in first/);
});

test('explicit bought-state retries are idempotent and revisions are server-controlled', async () => {
  const id = await house(users.alice);
  const item = randomUUID();
  const created = await change(users.alice, id, item, 0, {
    title: ' Milk ',
    quantity: ' 1 carton ',
  });
  assert.equal(created.status, 'applied');
  assert.equal(created.item.title, 'Milk');
  assert.equal(created.item.quantity, '1 carton');
  assert.equal(created.item.revision, 1);
  const op = randomUUID();
  const checked = await change(
    users.alice,
    id,
    item,
    1,
    { completed: true },
    op,
  );
  const replay = await change(
    users.alice,
    id,
    item,
    1,
    { completed: true },
    op,
  );
  assert.deepEqual(replay, checked);
  assert.equal((await snapshot(users.alice, id)).items[0].revision, 2);
  assert.equal(checked.item.completed, true);
  assert.ok(Number.isFinite(Date.parse(checked.item.updated_at)));
  await assert.rejects(
    change(users.alice, id, item, 2, { completed: false }, op),
    /already used/,
  );
  await assert.rejects(
    note(users.alice, id, 1, 'Other kind', op),
    /already used/,
  );
});

test('stale grocery writes return the current record without overwriting another edit', async () => {
  const id = await house(users.alice);
  await join(users.alice, users.clara);
  const item = randomUUID();
  await change(users.alice, id, item, 0, { title: 'Milk', quantity: '1' });
  await change(users.clara, id, item, 1, { quantity: '2 cartons' });
  const stale = await change(users.alice, id, item, 1, { title: 'Oat milk' });
  assert.equal(stale.status, 'conflict');
  assert.equal(stale.item.quantity, '2 cartons');
  assert.equal(stale.item.title, 'Milk');
  const rebased = await change(users.alice, id, item, stale.item.revision, {
    title: 'Oat milk',
  });
  assert.equal(rebased.item.quantity, '2 cartons');
  assert.equal(rebased.item.updated_by, users.alice);
  assert.equal(rebased.item.revision, 3);
});

test('deletions retain tombstones and stale edits or inserts cannot resurrect an item', async () => {
  const id = await house(users.alice);
  const item = randomUUID();
  await change(users.alice, id, item, 0, { title: 'Eggs', quantity: '6' });
  const removed = await change(users.alice, id, item, 1, { deleted: true });
  assert.equal(removed.item.revision, 2);
  assert.ok(removed.item.deleted_at);
  assert.equal(
    (await snapshot(users.alice, id)).items[0].deleted_at,
    removed.item.deleted_at,
  );
  assert.equal(
    (await change(users.alice, id, item, 1, { completed: true })).status,
    'conflict',
  );
  assert.equal(
    (await change(users.alice, id, item, 2, { title: 'Back again' })).status,
    'conflict',
  );
  assert.equal(
    (await change(users.alice, id, item, 0, { title: 'Eggs', quantity: '6' }))
      .status,
    'conflict',
  );
  await assert.rejects(
    change(users.alice, id, item, 2, { deleted: false }),
    /valid item/,
  );
});

test('a missing record or a guessed UUID from another household reveals no item', async () => {
  const id = await house(users.alice);
  const other = await house(users.bob);
  const item = randomUUID();
  await change(users.bob, other, item, 0, { title: 'Private', quantity: '1' });
  assert.deepEqual(
    await change(users.alice, id, item, 1, { completed: true }),
    { status: 'conflict', item: null },
  );
  assert.deepEqual(
    await change(users.alice, id, item, 0, { title: 'Guess', quantity: '1' }),
    { status: 'conflict', item: null },
  );
  assert.equal((await snapshot(users.bob, other)).items[0].title, 'Private');
});

test('note conflicts preserve server text and accepted note retries do not increment twice', async () => {
  const id = await house(users.alice);
  await join(users.alice, users.clara);
  const op = randomUUID();
  const saved = await note(users.clara, id, 1, 'Oat milk for coffee.', op);
  assert.equal(saved.status, 'applied');
  assert.equal(saved.note.updated_by, users.clara);
  assert.deepEqual(
    await note(users.clara, id, 1, 'Oat milk for coffee.', op),
    saved,
  );
  const conflict = await note(users.alice, id, 1, 'My other draft');
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.note.body, 'Oat milk for coffee.');
  assert.equal((await snapshot(users.alice, id)).note.revision, 2);
  assert.equal((await note(users.alice, id, 2, '')).note.body, '');
});

test('invalid patches and overlong notes fail atomically without recording operations', async () => {
  const id = await house(users.alice);
  const item = randomUUID();
  const invalid = [
    {},
    { title: '', quantity: '1' },
    { title: 'a'.repeat(121), quantity: '1' },
    { title: 'Milk', quantity: '' },
    { title: 'Milk', quantity: 'a'.repeat(41) },
    { title: null, quantity: '1' },
    { title: 'Milk', quantity: '1', completed: 'yes' },
    { title: 'Milk', quantity: '1', created_by: users.bob },
    { title: 'Milk', quantity: '1', deleted: true },
    { deleted: false },
  ];
  for (const patch of invalid)
    await assert.rejects(change(users.alice, id, item, 0, patch));
  await assert.rejects(
    note(users.alice, id, 1, 'x'.repeat(2001)),
    /at most 2000/,
  );
  assert.equal((await snapshot(users.alice, id)).items.length, 0);
  assert.equal(
    (await db.query('select * from private.applied_operations')).rows.length,
    0,
  );
});

test('removed members cannot read or replay accepted writes, even after joining another household', async () => {
  const id = await house(users.alice);
  await join(users.alice, users.clara);
  const item = randomUUID();
  const operation = randomUUID();
  await change(
    users.clara,
    id,
    item,
    0,
    { title: 'Milk', quantity: '1' },
    operation,
  );
  await asUser(users.alice, 'select public.remove_household_member($1)', [
    users.clara,
  ]);
  await assert.rejects(
    change(
      users.clara,
      id,
      item,
      0,
      { title: 'Milk', quantity: '1' },
      operation,
    ),
    /no longer have access/,
  );
  assert.deepEqual(
    (await asUser(users.clara, 'select * from public.grocery_items')).rows,
    [],
  );
  await house(users.clara, 'New place');
  await assert.rejects(snapshot(users.clara, id), /no longer have access/);
  await assert.rejects(
    change(users.clara, id, item, 1, { completed: true }),
    /no longer have access/,
  );
});

test('account deletion retains shared content with nullable attribution and cannot reuse an old JWT', async () => {
  const id = await house(users.alice);
  await join(users.alice, users.clara);
  const item = randomUUID();
  await change(users.clara, id, item, 0, {
    title: 'Bread',
    quantity: '1 loaf',
  });
  await note(users.clara, id, 1, 'Keep this shared note.');
  await asUser(users.clara, 'select public.delete_my_account()');
  const state = await snapshot(users.alice, id);
  assert.equal(state.items[0].title, 'Bread');
  assert.equal(state.items[0].created_by, null);
  assert.equal(state.items[0].updated_by, null);
  assert.equal(state.note.body, 'Keep this shared note.');
  assert.equal(state.note.updated_by, null);
  await assert.rejects(snapshot(users.clara, id), /Sign in again/);
});

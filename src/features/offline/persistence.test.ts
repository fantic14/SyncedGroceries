import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  CacheClosedError,
  CacheCorruptionError,
  cacheScopeKey,
  type CacheScope,
} from './persistence.ts';
import {
  createSqlitePersistence,
  type SqliteDriver,
} from './sqlitePersistence.ts';

const alice: CacheScope = {
  backend: 'https://development.example',
  userId: 'alice',
  householdId: 'flat-a',
};

const document = {
  version: 1,
  snapshot: { items: [{ id: 'milk', title: 'Milk', revision: 3 }] },
  view: { items: [{ id: 'milk', title: 'Oat milk', revision: 4 }] },
  outbox: [
    { id: 'operation-1', itemId: 'milk', changes: { title: 'Oat milk' } },
  ],
  noteDraft: 'Please buy the unsweetened one 🥛',
};

function driver(database: DatabaseSync): SqliteDriver {
  return {
    exec: async (sql) => {
      database.exec(sql);
    },
    run: async (sql, parameters) => {
      database.prepare(sql).run(...parameters);
    },
    get: async (sql, parameters) =>
      (database.prepare(sql).get(...parameters) as
        { payload: string } | undefined) ?? null,
  };
}

test('a file-backed SQLite restart restores cache, optimistic view, queue, and draft together', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'synced-groceries-offline-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, 'offline.db');
  const firstDatabase = new DatabaseSync(filename);
  const first = await createSqlitePersistence(driver(firstDatabase));
  const firstLease = first.open<typeof document>(alice);
  await firstLease.save(document);
  firstLease.close();
  firstDatabase.close();

  const secondDatabase = new DatabaseSync(filename);
  t.after(() => secondDatabase.close());
  const second = await createSqlitePersistence(driver(secondDatabase));
  assert.deepEqual(await second.open<typeof document>(alice).load(), document);
});

test('a SQLite-aborted replacement preserves the complete previous aggregate', async (t) => {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  const persistence = await createSqlitePersistence(driver(database));
  const cache = persistence.open<typeof document>(alice);
  await cache.save(document);
  database.exec(`
    create trigger fail_offline_update before update on offline_documents_v1
      when instr(new.payload, 'abort_marker') > 0
      begin select raise(abort, 'simulated SQLite write failure'); end;
  `);
  await assert.rejects(cache.save({ ...document, noteDraft: 'abort_marker' }));
  assert.deepEqual(await cache.load(), document);
  await cache.save({ ...document, noteDraft: 'A valid later edit' });
  assert.equal((await cache.load())?.noteDraft, 'A valid later edit');
});

test('backend, user, and household form independent cache boundaries', async (t) => {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  const persistence = await createSqlitePersistence(driver(database));
  const scopes = [
    alice,
    { ...alice, userId: 'bob' },
    { ...alice, backend: 'https://another-project.example' },
    { ...alice, householdId: 'flat-b' },
  ];
  const leases = scopes.map((scope) =>
    persistence.open<{ marker: number }>(scope),
  );
  await Promise.all(leases.map((cache, marker) => cache.save({ marker })));
  assert.deepEqual(await Promise.all(leases.map((cache) => cache.load())), [
    { marker: 0 },
    { marker: 1 },
    { marker: 2 },
    { marker: 3 },
  ]);

  await persistence.clearUser(alice.backend, alice.userId);
  await assert.rejects(leases[0]!.load(), CacheClosedError);
  await assert.rejects(leases[3]!.load(), CacheClosedError);
  assert.equal(await persistence.open(alice).load(), null);
  assert.equal(await persistence.open(scopes[3]!).load(), null);
  assert.deepEqual(await leases[1]!.load(), { marker: 1 });
  assert.deepEqual(await leases[2]!.load(), { marker: 2 });
});

test('logout invalidates old leases before purge, including writes already queued', async (t) => {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  const original = driver(database);
  let entered!: () => void;
  let release!: () => void;
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let paused = false;
  const persistence = await createSqlitePersistence({
    ...original,
    run: async (sql, parameters) => {
      if (!paused && sql.startsWith('insert')) {
        paused = true;
        entered();
        await gate;
      }
      await original.run(sql, parameters);
    },
  });
  const old = persistence.open<typeof document>(alice);
  const first = old.save(document);
  await writing;
  const queued = old.save({ ...document, noteDraft: 'Queued before sign-out' });
  const purge = persistence.clearUser(alice.backend, alice.userId);
  const late = old.save({ ...document, noteDraft: 'Late network result' });
  const results = Promise.allSettled([first, queued, purge, late]);
  release();
  const settled = await results;
  assert.deepEqual(
    settled.map((result) => result.status),
    ['rejected', 'rejected', 'fulfilled', 'rejected'],
  );
  assert.equal(await persistence.open(alice).load(), null);
});

test('closed scopes reject reads and writes while a fresh lease can reopen the same saved data', async (t) => {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  const persistence = await createSqlitePersistence(driver(database));
  const cache = persistence.open<typeof document>(alice);
  await cache.save(document);
  cache.close();
  await assert.rejects(cache.load(), CacheClosedError);
  await assert.rejects(cache.save(document), CacheClosedError);
  await assert.rejects(cache.clear(), CacheClosedError);
  const reopened = persistence.open<typeof document>(alice);
  assert.deepEqual(await reopened.load(), document);
  await reopened.clear();
  assert.equal(await reopened.load(), null);
  await reopened.save(document);
  assert.deepEqual(await reopened.load(), document);
});

test('corrupt saved JSON is rejected without replacing or deleting it', async (t) => {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  const persistence = await createSqlitePersistence(driver(database));
  const cache = persistence.open<typeof document>(alice);
  await cache.save(document);
  database
    .prepare('update offline_documents_v1 set payload = ? where scope_key = ?')
    .run('{broken JSON', cacheScopeKey(alice));
  await assert.rejects(cache.load(), CacheCorruptionError);
  assert.equal(
    database
      .prepare('select payload from offline_documents_v1 where scope_key = ?')
      .get(cacheScopeKey(alice))?.payload,
    '{broken JSON',
  );
});

test('save captures the state at submission and invalid JSON cannot overwrite a saved aggregate', async (t) => {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  const persistence = await createSqlitePersistence(driver(database));
  const cache = persistence.open<unknown>(alice);
  const input = structuredClone(document);
  const saving = cache.save(input);
  input.outbox.length = 0;
  input.noteDraft = 'Changed after save was called';
  await saving;
  assert.deepEqual(await cache.load(), document);
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  await assert.rejects(cache.save(cyclic), /prepared for storage/);
  await assert.rejects(cache.save(undefined), /prepared for storage/);
  assert.deepEqual(await cache.load(), document);
});

test('scope keys are unambiguous, bound at open, and safely parameterized', async (t) => {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  const persistence = await createSqlitePersistence(driver(database));
  const input = {
    ...alice,
    householdId: "flat'); delete from offline_documents_v1; --",
  };
  const expected = { ...input };
  const cache = persistence.open<typeof document>(input);
  input.userId = 'other-user';
  await cache.save(document);
  assert.deepEqual(await persistence.open(expected).load(), document);
  assert.equal(await persistence.open(input).load(), null);
  assert.notEqual(
    cacheScopeKey({ backend: 'a,b', userId: 'c', householdId: 'd' }),
    cacheScopeKey({ backend: 'a', userId: 'b,c', householdId: 'd' }),
  );
  assert.throws(() => persistence.open({ ...alice, backend: '' }), /requires/);
});

test('initialization failure is surfaced rather than replaced with volatile storage', async () => {
  await assert.rejects(
    createSqlitePersistence({
      exec: async () => {
        throw new Error('Disk unavailable');
      },
      run: async () => undefined,
      get: async () => null,
    }),
    /Disk unavailable/,
  );
});

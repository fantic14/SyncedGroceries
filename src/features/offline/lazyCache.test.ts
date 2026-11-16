import assert from 'node:assert/strict';
import test from 'node:test';
import { createLazyCacheFactory, openLazyCache } from './lazyCache.ts';
import {
  createDocumentPersistence,
  type OfflinePersistence,
} from './persistence.ts';

function fixture() {
  const rows = new Map<string, string>();
  const persistence = createDocumentPersistence({
    read: async (key) => rows.get(key) ?? null,
    write: async (_scope, key, value) => {
      rows.set(key, value);
    },
    remove: async (key) => {
      rows.delete(key);
    },
    removeUser: async () => {
      rows.clear();
    },
  });
  return { rows, persistence };
}

test('a lazy open scheduled before logout cannot recreate a purged account', async () => {
  const { rows, persistence } = fixture();
  const scope = { backend: 'test-lazy', userId: 'alice', householdId: 'flat' };
  const lazy = openLazyCache(() => Promise.resolve(persistence), scope);
  await persistence.clearUser(scope.backend, scope.userId);
  await assert.rejects(lazy.save({ old: true }), /ended/);
  assert.equal(rows.size, 0);
});

test('purge fences an unresolved provider while a fresh login can open normally', async () => {
  const { rows, persistence } = fixture();
  const scope = {
    backend: 'test-lazy-deferred',
    userId: 'alice',
    householdId: 'flat',
  };
  let ready!: (value: OfflinePersistence) => void;
  const lazy = openLazyCache(
    () =>
      new Promise<OfflinePersistence>((resolve) => {
        ready = resolve;
      }),
    scope,
  );
  await persistence.clearUser(scope.backend, scope.userId);
  ready(persistence);
  await assert.rejects(lazy.load(), /ended/);
  const fresh = openLazyCache(() => Promise.resolve(persistence), scope);
  await fresh.save({ new: true });
  assert.equal(rows.size, 1);
  assert.deepEqual(await fresh.load(), { new: true });
});

test('closing before provider completion never opens a usable lease', async () => {
  const { persistence } = fixture();
  const lazy = openLazyCache(() => Promise.resolve(persistence), {
    backend: 'test-lazy-close',
    userId: 'alice',
    householdId: 'flat',
  });
  lazy.close();
  await assert.rejects(lazy.load(), /ended/);
});

test('an old store cannot acquire a fresh lease after logout or membership removal', async () => {
  const { persistence } = fixture();
  const scope = {
    backend: 'test-factory',
    userId: 'alice',
    householdId: 'flat',
  };
  const beforeLogout = createLazyCacheFactory(
    () => Promise.resolve(persistence),
    scope,
  );
  await persistence.clearUser(scope.backend, scope.userId);
  assert.throws(beforeLogout, /ended/);
  const beforeRemoval = createLazyCacheFactory(
    () => Promise.resolve(persistence),
    scope,
  );
  persistence.invalidateScope(scope);
  assert.throws(beforeRemoval, /ended/);
  const fresh = createLazyCacheFactory(
    () => Promise.resolve(persistence),
    scope,
  )();
  await fresh.save({ fresh: true });
  assert.deepEqual(await fresh.load(), { fresh: true });
});

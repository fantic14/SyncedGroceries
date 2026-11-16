import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentPersistence } from './persistence.ts';
import { openLazyCache } from './lazyCache.ts';
import { quarantineHousehold } from './quarantine.ts';
import { recoverOwnEdits } from './recovery.ts';
import { createOfflineStore } from './engine.ts';

test('identity-level membership loss fences old leases and retains only explicit recovery intentions', async () => {
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
  const scope = {
    backend: 'quarantine-test',
    userId: 'alice',
    householdId: 'flat',
  };
  const note = {
    id: 'note',
    body: 'Original shared text',
    updated_by: 'alice',
    updated_at: '2026-11-16T10:00:00Z',
    revision: 1,
  };
  let calls = 0;
  const store = createOfflineStore({
    ...scope,
    repository: {
      load: async () => ({ items: [], note }),
      mutate: async () => {
        calls++;
        throw new Error('must not replay');
      },
      saveNote: async () => {
        calls++;
        throw new Error('must not replay');
      },
    },
    cacheFactory: () => persistence.open(scope),
    newId: () => 'operation',
  });
  await store.hydrate();
  store.setOnline(true);
  await store.actions.refresh();
  store.setOnline(false);
  await store.actions.addItem('Bread', '1');
  const delayed = openLazyCache(() => Promise.resolve(persistence), scope);
  await quarantineHousehold(persistence, scope);
  await assert.rejects(delayed.load(), /ended/);
  const lease = persistence.open<unknown>(scope);
  const saved = (await lease.load()) as {
    access: string;
    server: unknown;
    queue: Array<{ status: string }>;
  };
  assert.equal(saved.access, 'revoked');
  assert.equal(saved.server, null);
  assert.equal(saved.queue[0]?.status, 'failed');
  assert.equal(recoverOwnEdits(saved, 'alice', 'flat')?.edits[0]?.kind, 'item');
  const reopened = createOfflineStore({
    ...scope,
    repository: {
      load: async () => ({ items: [], note }),
      mutate: async () => {
        calls++;
        throw new Error('must not replay');
      },
      saveNote: async () => {
        calls++;
        throw new Error('must not replay');
      },
    },
    cacheFactory: () => persistence.open(scope),
    newId: () => 'new-operation',
  });
  await reopened.hydrate();
  reopened.setOnline(true);
  await reopened.actions.refresh();
  assert.equal(calls, 0);
  assert.equal(reopened.getState().failedCount, 1);
});

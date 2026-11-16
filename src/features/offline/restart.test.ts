import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createOfflineStore } from './engine.ts';
import { createSqlitePersistence } from './sqlitePersistence.ts';
import type { OfflineDocument } from './types.ts';
import type {
  ItemMutationRequest,
  ItemResult,
  SharedSnapshot,
} from '../shared/types.ts';

test('a real SQLite reopen retries a lost acknowledgement without duplicating the server edit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'synced-offline-restart-'));
  const file = join(directory, 'offline.sqlite');
  const scope = {
    backend: 'https://project.example',
    userId: 'alice',
    householdId: 'flat',
  };
  let database: DatabaseSync | null = null;
  const open = async () => {
    database = new DatabaseSync(file);
    const current = database;
    return createSqlitePersistence({
      exec: async (sql) => {
        current.exec(sql);
      },
      run: async (sql, values) => {
        current.prepare(sql).run(...values);
      },
      get: async (sql, values) =>
        (current.prepare(sql).get(...values) as
          { payload: string } | undefined) ?? null,
    });
  };
  const server: SharedSnapshot = {
    items: [],
    note: {
      id: randomUUID(),
      body: '',
      updated_by: 'alice',
      updated_at: '2026-11-16T10:00:00Z',
      revision: 1,
    },
  };
  let applications = 0;
  let dropResponse = true;
  const requests: ItemMutationRequest[] = [];
  const accepted = new Map<string, ItemResult>();
  const repository = {
    load: async () => structuredClone(server),
    mutate: async (request: ItemMutationRequest): Promise<ItemResult> => {
      requests.push(structuredClone(request));
      const previous = accepted.get(request.operationId);
      if (previous) return structuredClone(previous);
      const item = {
        id: request.itemId,
        title: request.changes.title!,
        quantity: request.changes.quantity!,
        completed: false,
        created_by: 'alice',
        updated_by: 'alice',
        created_at: '2026-11-16T10:00:00Z',
        updated_at: '2026-11-16T10:00:00Z',
        revision: 1,
        deleted_at: null,
      };
      server.items.push(item);
      applications++;
      const result: ItemResult = { status: 'applied', item };
      accepted.set(request.operationId, result);
      if (dropResponse) {
        dropResponse = false;
        throw new TypeError('acknowledgement lost after server commit');
      }
      return structuredClone(result);
    },
    saveNote: async () => {
      throw new Error('not used');
    },
  };
  try {
    let persistence = await open();
    const first = createOfflineStore({
      ...scope,
      repository,
      newId: randomUUID,
      cacheFactory: () => persistence.open<OfflineDocument>(scope),
    });
    await first.hydrate();
    first.setOnline(true);
    await first.actions.refresh();
    first.setOnline(false);
    assert.equal(await first.actions.addItem('Bread', '2 loaves'), true);
    await first.actions.updateNoteDraft('Dinner at seven');
    first.setOnline(true);
    await first.actions.refresh();
    assert.equal(applications, 1);
    assert.equal(first.getState().queuedCount, 1);
    first.dispose();
    (database as DatabaseSync | null)?.close();

    persistence = await open();
    const reopened = createOfflineStore({
      ...scope,
      repository,
      newId: randomUUID,
      cacheFactory: () => persistence.open<OfflineDocument>(scope),
    });
    await reopened.hydrate();
    assert.equal(reopened.getState().queuedCount, 1);
    assert.equal(reopened.getState().noteDraft, 'Dinner at seven');
    reopened.setOnline(true);
    await reopened.actions.retry();
    assert.equal(applications, 1);
    assert.equal(server.items.length, 1);
    assert.deepEqual(requests[1], requests[0]);
    assert.equal(reopened.getState().queuedCount, 0);
    assert.equal(reopened.getState().noteDraft, 'Dinner at seven');
    reopened.dispose();
  } finally {
    (database as DatabaseSync | null)?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

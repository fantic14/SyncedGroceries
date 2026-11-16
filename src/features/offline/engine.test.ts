import assert from 'node:assert/strict';
import test from 'node:test';
import { createOfflineStore } from './engine.ts';
import type { ScopeCache } from './persistence.ts';
import type { OfflineDocument } from './types.ts';
import type {
  ItemMutationRequest,
  ItemResult,
  NoteMutationRequest,
  NoteResult,
  SharedItem,
  SharedSnapshot,
} from '../shared/types.ts';

const timestamp = '2026-11-16T12:00:00.000Z';
const item: SharedItem = {
  id: 'item-milk',
  title: 'Milk',
  quantity: '1 carton',
  completed: false,
  created_by: 'alice',
  updated_by: 'alice',
  created_at: timestamp,
  updated_at: timestamp,
  revision: 1,
  deleted_at: null,
};
const initial: SharedSnapshot = {
  items: [item],
  note: {
    id: 'note',
    body: 'Original note',
    updated_by: 'alice',
    updated_at: timestamp,
    revision: 1,
  },
};
const copy = <T>(value: T): T => structuredClone(value);

function fixture(start = initial) {
  let saved: OfflineDocument | null = null;
  let remote = copy(start);
  let nextId = 0;
  let clock = Date.parse(timestamp);
  let failStorage = false;
  let loadError: unknown = null;
  let writeError: unknown = null;
  let dropAcknowledgement = false;
  let race: (() => void) | null = null;
  let writeDelay: Promise<void> | null = null;
  let failNextOpen = false;
  const requests: Array<ItemMutationRequest | NoteMutationRequest> = [];
  const accepted = new Map<
    string,
    { request: string; result: ItemResult | NoteResult }
  >();
  let applications = 0;
  let reads = 0;
  const cacheFactory = (): ScopeCache<OfflineDocument> => {
    let active = true;
    const poisoned = failNextOpen;
    failNextOpen = false;
    return {
      load: async () => {
        if (!active || poisoned)
          throw new Error('closed or provider initialization failed');
        return copy(saved);
      },
      save: async (value) => {
        if (!active || failStorage) throw new Error('storage failed');
        saved = copy(value);
      },
      clear: async () => {
        saved = null;
      },
      close: () => {
        active = false;
      },
    };
  };
  function replay(request: ItemMutationRequest | NoteMutationRequest) {
    const previous = accepted.get(request.operationId);
    if (previous) {
      assert.equal(previous.request, JSON.stringify(request));
      return copy(previous.result);
    }
    return null;
  }
  function acknowledge(
    request: ItemMutationRequest | NoteMutationRequest,
    result: ItemResult | NoteResult,
  ) {
    accepted.set(request.operationId, {
      request: JSON.stringify(request),
      result: copy(result),
    });
    applications++;
    if (dropAcknowledgement) {
      dropAcknowledgement = false;
      throw new TypeError('response lost after commit');
    }
    return copy(result);
  }
  const repository = {
    load: async () => {
      reads++;
      if (loadError) throw loadError;
      return copy(remote);
    },
    mutate: async (request: ItemMutationRequest): Promise<ItemResult> => {
      requests.push(copy(request));
      if (writeError) throw writeError;
      if (writeDelay) await writeDelay;
      const replayed = replay(request);
      if (replayed) return replayed as ItemResult;
      if (race) {
        const perform = race;
        race = null;
        perform();
      }
      let current = remote.items.find((value) => value.id === request.itemId);
      if (
        current &&
        (current.deleted_at || current.revision !== request.baseRevision)
      )
        return { status: 'conflict', item: copy(current) };
      if (!current && request.baseRevision !== 0)
        return { status: 'conflict', item: null };
      current = current
        ? { ...current }
        : {
            ...item,
            id: request.itemId,
            title: request.changes.title!,
            quantity: request.changes.quantity!,
            revision: 0,
          };
      const updated: SharedItem = {
        ...current,
        ...('title' in request.changes
          ? { title: request.changes.title! }
          : {}),
        ...('quantity' in request.changes
          ? { quantity: request.changes.quantity! }
          : {}),
        ...('completed' in request.changes
          ? { completed: request.changes.completed! }
          : {}),
        deleted_at: request.changes.deleted ? timestamp : null,
        revision: current.revision + 1,
      };
      remote.items = [
        ...remote.items.filter((value) => value.id !== updated.id),
        updated,
      ];
      return acknowledge(request, {
        status: 'applied',
        item: updated,
      }) as ItemResult;
    },
    saveNote: async (request: NoteMutationRequest): Promise<NoteResult> => {
      requests.push(copy(request));
      if (writeError) throw writeError;
      const replayed = replay(request);
      if (replayed) return replayed as NoteResult;
      if (remote.note.revision !== request.baseRevision)
        return { status: 'conflict', note: copy(remote.note) };
      remote.note = {
        ...remote.note,
        body: request.body,
        revision: remote.note.revision + 1,
      };
      return acknowledge(request, {
        status: 'applied',
        note: remote.note,
      }) as NoteResult;
    },
  };
  const makeStore = (userId = 'alice', householdId = 'house') =>
    createOfflineStore({
      householdId,
      userId,
      repository,
      newId: () => `operation-${++nextId}`,
      cacheFactory,
      now: () => clock,
    });
  const ready = async () => {
    const store = makeStore();
    await store.hydrate();
    store.setOnline(true);
    await store.sync();
    store.setOnline(false);
    return store;
  };
  return {
    makeStore,
    ready,
    requests,
    saved: () => copy(saved),
    remote: () => copy(remote),
    applications: () => applications,
    reads: () => reads,
    changeRemote: (change: (snapshot: SharedSnapshot) => void) => {
      change(remote);
    },
    setStorageFailure: (value: boolean) => {
      failStorage = value;
    },
    setLoadError: (value: unknown) => {
      loadError = value;
    },
    setWriteError: (value: unknown) => {
      writeError = value;
    },
    loseAcknowledgement: () => {
      dropAcknowledgement = true;
    },
    onNextWrite: (perform: () => void) => {
      race = perform;
    },
    delayWrites: (delay: Promise<void> | null) => {
      writeDelay = delay;
    },
    failNextCacheOpen: () => {
      failNextOpen = true;
    },
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    corrupt: (value: unknown) => {
      saved = value as OfflineDocument;
    },
  };
}

test('offline cache, queued edits, and unsaved note draft survive a store restart', async () => {
  const setup = fixture();
  const first = await setup.ready();
  assert.equal(await first.actions.addItem('Bread', '2'), true);
  assert.equal(
    await first.actions.updateNoteDraft('My unsaved meal plan'),
    true,
  );
  const op = setup.saved()!.queue[0]!.id;
  first.dispose();
  const restarted = setup.makeStore();
  await restarted.hydrate();
  assert.equal(
    restarted
      .getState()
      .snapshot?.items.some((value) => value.title === 'Bread'),
    true,
  );
  assert.equal(restarted.getState().noteDraft, 'My unsaved meal plan');
  assert.equal(restarted.getState().queuedCount, 1);
  assert.equal(setup.saved()!.queue[0]!.id, op);
  assert.equal(restarted.getState().syncStatus, 'offline');
});

test('lost acknowledgement is recovered using the frozen request after restart', async () => {
  const setup = fixture();
  const first = await setup.ready();
  await first.actions.addItem('Bread', '1');
  setup.loseAcknowledgement();
  first.setOnline(true);
  await first.sync();
  assert.equal(first.getState().queuedCount, 1);
  assert.equal(setup.applications(), 1);
  const sent = copy(setup.requests[0]);
  const retryAt = first.getState().nextRetryAt;
  first.dispose();
  const second = setup.makeStore();
  await second.hydrate();
  second.setOnline(true);
  await second.sync();
  assert.equal(setup.requests.length, 1, 'backoff must survive restart');
  setup.advance(retryAt - Date.parse(timestamp));
  await second.sync();
  assert.deepEqual(setup.requests[1], sent);
  assert.equal(setup.applications(), 1);
  assert.equal(second.getState().queuedCount, 0);
  assert.equal(
    setup.remote().items.filter((value) => value.title === 'Bread').length,
    1,
  );
});

test('sequential offline add, edit, and delete replay in FIFO order without resurrection', async () => {
  const setup = fixture();
  const store = await setup.ready();
  await store.actions.addItem('Bread', '1');
  const added = store
    .getState()
    .snapshot!.items.find((value) => value.title === 'Bread')!;
  await store.actions.updateItem(added, { quantity: '2 loaves' });
  const edited = store
    .getState()
    .snapshot!.items.find((value) => value.id === added.id)!;
  await store.actions.updateItem(edited, { deleted: true });
  assert.equal(store.getState().queuedCount, 3);
  store.setOnline(true);
  await store.sync();
  assert.equal(store.getState().queuedCount, 0);
  const final = setup.remote().items.find((value) => value.id === added.id)!;
  assert.equal(final.quantity, '2 loaves');
  assert.ok(final.deleted_at);
  assert.equal(final.revision, 3);
  assert.equal(setup.requests.length, 3);
});

test('independent remote grocery fields merge, overlapping fields become durable conflicts', async () => {
  const setup = fixture();
  const store = await setup.ready();
  await store.actions.updateItem(item, { title: 'Oat milk' });
  setup.changeRemote((snapshot) => {
    snapshot.items[0] = { ...item, quantity: '2 cartons', revision: 2 };
  });
  store.setOnline(true);
  await store.sync();
  assert.equal(setup.remote().items[0]?.title, 'Oat milk');
  assert.equal(setup.remote().items[0]?.quantity, '2 cartons');
  assert.equal(store.getState().queuedCount, 0);
  store.setOnline(false);
  const current = store.getState().snapshot!.items[0]!;
  await store.actions.updateItem(current, { title: 'Soy milk' });
  setup.changeRemote((snapshot) => {
    snapshot.items[0] = {
      ...snapshot.items[0]!,
      title: 'Almond milk',
      revision: 4,
    };
  });
  store.setOnline(true);
  await store.sync();
  assert.equal(store.getState().failedCount, 1);
  assert.equal(store.getState().itemConflict?.title, 'Almond milk');
  assert.equal(setup.remote().items[0]?.title, 'Almond milk');
  store.dispose();
  const reopened = setup.makeStore();
  await reopened.hydrate();
  assert.equal(
    reopened.getState().failedDetails[0]?.changes?.title,
    'Soy milk',
  );
});

test('an in-flight independent edit safely rebases once with a new request ID', async () => {
  const setup = fixture();
  const store = await setup.ready();
  await store.actions.updateItem(item, { title: 'Oat milk' });
  setup.onNextWrite(() =>
    setup.changeRemote((snapshot) => {
      snapshot.items[0] = { ...item, quantity: '2 cartons', revision: 2 };
    }),
  );
  store.setOnline(true);
  await store.sync();
  assert.equal(store.getState().queuedCount, 0);
  assert.equal(setup.requests.length, 2);
  assert.notEqual(
    setup.requests[0]?.operationId,
    setup.requests[1]?.operationId,
  );
  assert.equal(setup.remote().items[0]?.title, 'Oat milk');
  assert.equal(setup.remote().items[0]?.quantity, '2 cartons');
});

test('both conflicting note versions survive restart and keep-mine uses latest revision', async () => {
  const setup = fixture();
  const first = await setup.ready();
  await first.actions.updateNoteDraft('My dinner plan');
  await first.actions.saveNote();
  setup.changeRemote((snapshot) => {
    snapshot.note = {
      ...snapshot.note,
      body: 'Flatmate dinner plan',
      revision: 2,
    };
  });
  first.setOnline(true);
  await first.sync();
  assert.equal(first.getState().noteDraft, 'My dinner plan');
  assert.equal(first.getState().noteConflict?.body, 'Flatmate dinner plan');
  first.dispose();
  const second = setup.makeStore();
  await second.hydrate();
  assert.equal(second.getState().noteDraft, 'My dinner plan');
  assert.equal(second.getState().noteConflict?.body, 'Flatmate dinner plan');
  await second.actions.keepMyNote();
  second.setOnline(true);
  await second.sync();
  assert.equal(setup.remote().note.body, 'My dinner plan');
  assert.equal(setup.remote().note.revision, 3);
  assert.equal(second.getState().queuedCount, 0);
});

test('remote deletion stops a stale queued edit and does not erase its recoverable intent', async () => {
  const setup = fixture();
  const store = await setup.ready();
  await store.actions.updateItem(item, { quantity: '3 cartons' });
  setup.changeRemote((snapshot) => {
    snapshot.items[0] = { ...item, deleted_at: timestamp, revision: 2 };
  });
  store.setOnline(true);
  await store.sync();
  assert.ok(store.getState().snapshot!.items[0]?.deleted_at);
  assert.equal(store.getState().failedCount, 1);
  assert.equal(store.actions.getUnsentWork().edits[0]?.kind, 'item');
  assert.equal(setup.requests.length, 0);
});

test('storage failure does not publish an optimistic edit or send an unpersisted request', async () => {
  const setup = fixture();
  const store = await setup.ready();
  const saved = setup.saved();
  setup.setStorageFailure(true);
  assert.equal(await store.actions.addItem('Bread', '1'), false);
  assert.deepEqual(setup.saved(), saved);
  assert.equal(store.getState().snapshot?.items.length, 1);
  assert.equal(store.getState().queuedCount, 0);
  assert.ok(store.getState().storageError);
  store.setOnline(true);
  await store.sync();
  assert.equal(setup.requests.length, 0);
});

test('expired authentication pauses the queue; verified reauthentication resumes it', async () => {
  const setup = fixture();
  const store = await setup.ready();
  await store.actions.updateItem(item, { completed: true });
  setup.setLoadError({ code: 'PGRST301' });
  store.setOnline(true);
  await store.sync();
  assert.equal(store.getState().syncStatus, 'reauth');
  assert.equal(store.getState().queuedCount, 1);
  const reads = setup.reads();
  await store.sync();
  assert.equal(setup.reads(), reads);
  setup.setLoadError(null);
  await store.setAuthReady(true);
  assert.equal(store.getState().queuedCount, 0);
  assert.equal(setup.remote().items[0]?.completed, true);
});

test('local-only restored authentication never sends requests until confirmed', async () => {
  const setup = fixture();
  const first = await setup.ready();
  await first.actions.addItem('Bread', '1');
  first.dispose();
  const second = setup.makeStore();
  await second.setAuthReady(false);
  await second.hydrate();
  const reads = setup.reads();
  second.setOnline(true);
  await second.sync();
  assert.equal(setup.reads(), reads);
  assert.equal(second.getState().syncStatus, 'reauth');
  assert.equal(second.getState().queuedCount, 1);
});

test('revoked membership hides server data and never replays into another household', async () => {
  const setup = fixture();
  const first = await setup.ready();
  await first.actions.updateItem(item, { quantity: '3 cartons' });
  setup.setLoadError({ code: '42501' });
  first.setOnline(true);
  await first.sync();
  assert.equal(first.getState().snapshot, null);
  assert.equal(first.getState().noteDraft, '');
  assert.equal(first.getState().failedCount, 1);
  assert.equal(setup.requests.length, 0);
  assert.equal(first.actions.getUnsentWork().edits.length, 1);
  first.dispose();
  const anotherHouse = setup.makeStore('alice', 'other-house');
  assert.equal(
    await anotherHouse.hydrate(),
    false,
    'wrong-scope cached data fails closed',
  );
  anotherHouse.setOnline(true);
  await anotherHouse.sync();
  assert.equal(setup.requests.length, 0);
  assert.equal(anotherHouse.getState().snapshot, null);
});

test('corrupt cache remains untouched and cannot be replaced by a remote snapshot', async () => {
  const setup = fixture();
  setup.corrupt({ version: 99, private: 'unreadable saved value' });
  const before = setup.saved();
  const store = setup.makeStore();
  assert.equal(await store.hydrate(), false);
  store.setOnline(true);
  await store.sync();
  assert.deepEqual(setup.saved(), before);
  assert.equal(setup.reads(), 0);
  assert.ok(store.getState().storageError);
});

test('every keystroke is serialized into the durable draft rather than dropped while busy', async () => {
  const setup = fixture();
  const store = await setup.ready();
  const results = await Promise.all([
    store.actions.updateNoteDraft('Dinner'),
    store.actions.updateNoteDraft('Dinner for'),
    store.actions.updateNoteDraft('Dinner for everyone'),
  ]);
  assert.deepEqual(results, [true, true, true]);
  assert.equal(store.getState().noteDraft, 'Dinner for everyone');
  assert.equal(setup.saved()?.draft?.body, 'Dinner for everyone');
  store.dispose();
  const reopened = setup.makeStore();
  await reopened.hydrate();
  assert.equal(reopened.getState().noteDraft, 'Dinner for everyone');
});

test('an acknowledgement persistence failure still recovers exactly once after restart', async () => {
  const setup = fixture();
  const first = await setup.ready();
  await first.actions.updateItem(item, { completed: true });
  setup.onNextWrite(() => setup.setStorageFailure(true));
  first.setOnline(true);
  await first.sync();
  assert.equal(setup.applications(), 1);
  assert.ok(first.getState().storageError);
  assert.ok(setup.saved()?.queue[0]?.request);
  const frozen = copy(setup.requests[0]);
  first.dispose();
  setup.setStorageFailure(false);
  const second = setup.makeStore();
  await second.hydrate();
  second.setOnline(true);
  await second.sync();
  assert.deepEqual(setup.requests[1], frozen);
  assert.equal(setup.applications(), 1);
  assert.equal(second.getState().queuedCount, 0);
});

test('disposing a scope ignores a late mutation acknowledgement without erasing its durable request', async () => {
  const setup = fixture();
  const first = await setup.ready();
  await first.actions.updateItem(item, { quantity: '2 cartons' });
  let release!: () => void;
  setup.delayWrites(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  first.setOnline(true);
  const syncing = first.sync();
  for (let count = 0; !setup.requests.length && count < 30; count++)
    await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(setup.requests.length, 1);
  const before = setup.saved();
  first.dispose();
  release();
  await syncing;
  assert.deepEqual(setup.saved(), before);
  assert.equal(setup.saved()?.queue.length, 1);
  setup.delayWrites(null);
  const second = setup.makeStore();
  await second.hydrate();
  second.setOnline(true);
  await second.sync();
  assert.equal(setup.applications(), 1);
  assert.equal(second.getState().queuedCount, 0);
});

test('a note conflict follows newer server versions while preserving the local draft', async () => {
  const setup = fixture();
  const store = await setup.ready();
  await store.actions.updateNoteDraft('My plan');
  await store.actions.saveNote();
  setup.changeRemote((snapshot) => {
    snapshot.note = {
      ...snapshot.note,
      body: 'First remote plan',
      revision: 2,
    };
  });
  store.setOnline(true);
  await store.sync();
  setup.changeRemote((snapshot) => {
    snapshot.note = {
      ...snapshot.note,
      body: 'Newest remote plan',
      revision: 3,
    };
  });
  await store.actions.refresh();
  assert.equal(store.getState().noteConflict?.body, 'Newest remote plan');
  assert.equal(store.getState().noteDraft, 'My plan');
  await store.actions.keepMyNote();
  await store.sync();
  assert.equal(setup.remote().note.revision, 4);
  assert.equal(setup.remote().note.body, 'My plan');
});

test('network-read backoff grows and survives a restart without blocking an explicit retry', async () => {
  const setup = fixture();
  const first = await setup.ready();
  setup.setLoadError(new TypeError('offline'));
  first.setOnline(true);
  await first.sync();
  const firstAt = first.getState().nextRetryAt;
  setup.advance(firstAt - Date.parse(timestamp));
  await first.sync();
  const secondAt = first.getState().nextRetryAt;
  assert.equal(secondAt - firstAt, 4000);
  first.dispose();
  const second = setup.makeStore();
  await second.hydrate();
  second.setOnline(true);
  const reads = setup.reads();
  await second.sync();
  assert.equal(setup.reads(), reads);
  setup.setLoadError(null);
  assert.equal(await second.actions.retry(), true);
  assert.equal(second.getState().nextRetryAt, 0);
});

test('a failed cache provider is reopened on retry without overwriting durable work', async () => {
  const setup = fixture();
  const first = await setup.ready();
  await first.actions.addItem('Bread', '1');
  await first.actions.updateNoteDraft('Saved local draft');
  const before = setup.saved();
  first.dispose();
  setup.failNextCacheOpen();
  const restarted = setup.makeStore();
  assert.equal(await restarted.hydrate(), false);
  assert.ok(restarted.getState().storageError);
  assert.deepEqual(setup.saved(), before);
  assert.equal(await restarted.hydrate(), true);
  assert.equal(restarted.getState().noteDraft, 'Saved local draft');
  assert.equal(restarted.getState().queuedCount, 1);
  assert.equal(restarted.getState().storageError, null);
});

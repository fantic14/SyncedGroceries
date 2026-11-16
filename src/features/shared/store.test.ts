import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedStore } from './store.ts';
import type {
  ItemMutationRequest,
  ItemResult,
  NoteMutationRequest,
  NoteResult,
  SharedItem,
  SharedSnapshot,
} from './types.ts';

const item: SharedItem = {
  id: 'item',
  title: 'Milk',
  quantity: '1 carton',
  completed: false,
  created_by: 'alice',
  updated_by: 'alice',
  created_at: '2026-11-16T10:00:00Z',
  updated_at: '2026-11-16T10:00:00Z',
  revision: 1,
  deleted_at: null,
};
const initial: SharedSnapshot = {
  items: [item],
  note: {
    id: 'note',
    body: 'Original note',
    updated_by: 'alice',
    updated_at: '2026-11-16T10:00:00Z',
    revision: 1,
  },
};

function fixture() {
  let remote = structuredClone(initial);
  let nextId = 0;
  const writes: ItemMutationRequest[] = [];
  const notes: NoteMutationRequest[] = [];
  const handlers = {
    load: async () => structuredClone(remote),
    mutate: async (request: ItemMutationRequest): Promise<ItemResult> => ({
      status: 'applied',
      item: { ...item, ...request.changes, revision: request.baseRevision + 1 },
    }),
    saveNote: async (request: NoteMutationRequest): Promise<NoteResult> => ({
      status: 'applied',
      note: {
        ...remote.note,
        body: request.body,
        revision: request.baseRevision + 1,
      },
    }),
  };
  const store = createSharedStore({
    householdId: 'house',
    newId: () => `operation-${++nextId}`,
    repository: {
      load: () => handlers.load(),
      mutate: async (request) => {
        writes.push(structuredClone(request));
        return handlers.mutate(request);
      },
      saveNote: async (request) => {
        notes.push(structuredClone(request));
        return handlers.saveNote(request);
      },
    },
  });
  return {
    store,
    writes,
    notes,
    handlers,
    setRemote: (value: SharedSnapshot) => {
      remote = structuredClone(value);
    },
  };
}

test('a live note update preserves the draft and requires an explicit conflict choice', async () => {
  const { store, notes, setRemote } = fixture();
  await store.actions.refresh();
  store.actions.updateNoteDraft('My meal plan');
  setRemote({
    ...initial,
    note: { ...initial.note, body: 'Flatmate meal plan', revision: 2 },
  });
  await store.actions.refresh();
  assert.equal(store.getState().noteDraft, 'My meal plan');
  assert.equal(store.getState().noteConflict?.body, 'Flatmate meal plan');
  assert.equal(await store.actions.saveNote(), false);
  assert.equal(notes.length, 0);
  assert.equal(await store.actions.keepMyNote(), true);
  assert.equal(notes[0]?.baseRevision, 2);
  assert.equal(store.getState().noteDraft, 'My meal plan');
  assert.equal(store.getState().noteConflict, null);
});

test('a lost write acknowledgement retries the exact same operation and payload', async () => {
  const { store, writes, handlers } = fixture();
  await store.actions.refresh();
  let first = true;
  handlers.mutate = async (request) => {
    if (first) {
      first = false;
      throw new TypeError('Network response lost');
    }
    return {
      status: 'applied',
      item: { ...item, id: request.itemId, title: 'Bread', revision: 1 },
    };
  };
  assert.equal(await store.actions.addItem('Bread', '1'), false);
  assert.equal(store.getState().pending, true);
  assert.equal(await store.actions.addItem('Another item', '1'), false);
  assert.equal(await store.actions.retry(), true);
  assert.deepEqual(writes[1], writes[0]);
  assert.equal(store.getState().pending, false);
  assert.equal(
    store.getState().snapshot?.items.filter((value) => value.title === 'Bread')
      .length,
    1,
  );
});

test('non-overlapping grocery edits rebase once using a fresh operation ID', async () => {
  const { store, writes, handlers } = fixture();
  await store.actions.refresh();
  handlers.mutate = async (request) =>
    writes.length === 1
      ? {
          status: 'conflict',
          item: { ...item, quantity: '2 cartons', revision: 2 },
        }
      : {
          status: 'applied',
          item: {
            ...item,
            title: request.changes.title!,
            quantity: '2 cartons',
            revision: 3,
          },
        };
  assert.equal(
    await store.actions.updateItem(item, { title: 'Oat milk' }),
    true,
  );
  assert.equal(writes.length, 2);
  assert.notEqual(writes[0]?.operationId, writes[1]?.operationId);
  assert.equal(writes[1]?.baseRevision, 2);
  assert.deepEqual(writes[1]?.changes, { title: 'Oat milk' });
  assert.equal(store.getState().snapshot?.items[0]?.quantity, '2 cartons');
});

test('overlapping grocery edits stop instead of overwriting a housemate', async () => {
  const { store, writes, handlers } = fixture();
  await store.actions.refresh();
  handlers.mutate = async () => ({
    status: 'conflict',
    item: { ...item, title: 'Soy milk', revision: 2 },
  });
  assert.equal(
    await store.actions.updateItem(item, { title: 'Oat milk' }),
    false,
  );
  assert.equal(writes.length, 1);
  assert.equal(store.getState().itemConflict?.title, 'Soy milk');
  assert.equal(store.getState().pending, false);
});

test('an old snapshot cannot resurrect an acknowledged deletion', async () => {
  const { store, handlers, setRemote } = fixture();
  await store.actions.refresh();
  handlers.mutate = async () => ({
    status: 'applied',
    item: { ...item, deleted_at: '2026-11-16T11:00:00Z', revision: 2 },
  });
  await store.actions.updateItem(item, { deleted: true });
  setRemote(initial);
  await store.actions.refresh();
  assert.ok(store.getState().snapshot?.items[0]?.deleted_at);
  assert.equal(store.getState().snapshot?.items[0]?.revision, 2);
});

test('permission loss clears household data and uncertain operations', async () => {
  const { store, handlers } = fixture();
  await store.actions.refresh();
  handlers.mutate = async () => {
    throw { code: '42501' };
  };
  await store.actions.updateItem(item, { completed: true });
  assert.equal(store.getState().snapshot, null);
  assert.equal(store.getState().pending, false);
  assert.equal(store.getState().noteDraft, '');
});

test('disposed stores ignore slow responses from a previous account scope', async () => {
  const { store, handlers } = fixture();
  let resolve!: (snapshot: SharedSnapshot) => void;
  handlers.load = () =>
    new Promise((done) => {
      resolve = done;
    });
  const loading = store.actions.refresh();
  store.dispose();
  resolve(structuredClone(initial));
  assert.equal(await loading, false);
  assert.equal(store.getState().snapshot, null);
});

test('effect cleanup/setup can reactivate the same store without disabling updates', async () => {
  const { store } = fixture();
  store.dispose();
  store.activate();
  assert.equal(await store.actions.refresh(), true);
  assert.equal(store.getState().snapshot?.note.body, initial.note.body);
});

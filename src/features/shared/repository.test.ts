import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSharedRepository,
  rebaseItemChange,
  SharedDataError,
} from './repository.ts';
import type {
  ItemChanges,
  ItemMutationRequest,
  SharedItem,
  SharedNote,
} from './types.ts';

const householdId = '10000000-0000-4000-8000-000000000001';
const otherHouseholdId = '10000000-0000-4000-8000-000000000002';
const actorId = '20000000-0000-4000-8000-000000000001';
const itemId = '30000000-0000-4000-8000-000000000001';
const noteId = '40000000-0000-4000-8000-000000000001';
const operationId = '50000000-0000-4000-8000-000000000001';
const now = '2026-11-16T12:00:00+00:00';

function item(overrides: Partial<SharedItem> = {}): SharedItem {
  return {
    id: itemId,
    title: 'Milk',
    quantity: '1 carton',
    completed: false,
    created_by: actorId,
    updated_by: actorId,
    created_at: now,
    updated_at: now,
    revision: 1,
    deleted_at: null,
    ...overrides,
  };
}

function note(overrides: Partial<SharedNote> = {}): SharedNote {
  return {
    id: noteId,
    body: 'Oat milk for coffee.',
    updated_by: actorId,
    updated_at: now,
    revision: 1,
    ...overrides,
  };
}

function fixture(data: unknown) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const transport = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data, error: null };
    },
  };
  return { repository: createSharedRepository(transport), calls };
}

test('snapshot parsing retains tombstones and nullable attribution, excluding extra server fields', async () => {
  const tombstone = item({
    deleted_at: now,
    created_by: null,
    updated_by: null,
  });
  const { repository, calls } = fixture({
    items: [
      { ...tombstone, household_id: householdId, internal: 'not exposed' },
    ],
    note: { ...note({ updated_by: null }), household_id: householdId },
  });
  assert.deepEqual(await repository.load(householdId), {
    items: [tombstone],
    note: note({ updated_by: null }),
  });
  assert.deepEqual(calls, [
    {
      name: 'get_shared_household',
      args: { household_id: householdId },
    },
  ]);
});

test('malformed, duplicate, and wrong-household records fail instead of becoming visible data', async () => {
  const invalid = [
    null,
    { items: [], note: null },
    { items: [item(), item()], note: note() },
    { items: [{ ...item(), completed: 'false' }], note: note() },
    { items: [{ ...item(), revision: '1' }], note: note() },
    {
      items: [{ ...item(), revision: Number.MAX_SAFE_INTEGER + 1 }],
      note: note(),
    },
    { items: [{ ...item(), updated_at: 'yesterday' }], note: note() },
    { items: [{ ...item(), household_id: otherHouseholdId }], note: note() },
    { items: [], note: { ...note(), household_id: otherHouseholdId } },
    { items: [{ ...item(), title: '   ' }], note: note() },
    { items: [{ ...item(), created_by: 'not a UUID' }], note: note() },
  ];
  for (const data of invalid) {
    await assert.rejects(
      fixture(data).repository.load(householdId),
      SharedDataError,
    );
  }
});

test('retries retain operation identity, base revision, and explicit completion intent', async () => {
  const { repository, calls } = fixture({
    status: 'applied',
    item: item({ revision: 2 }),
  });
  const request: ItemMutationRequest = {
    operationId,
    householdId,
    itemId,
    baseRevision: 1,
    changes: { completed: false },
  };
  await repository.mutate(request);
  await repository.mutate(request);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0], {
    name: 'mutate_grocery',
    args: {
      operation_id: operationId,
      household_id: householdId,
      item_id: itemId,
      base_revision: 1,
      changes: { completed: false },
    },
  });
});

test('unsafe patches fail before a network request, including mixed deletion and forged fields', async () => {
  const { repository, calls } = fixture(null);
  const invalidPatches = [
    {},
    { deleted: false },
    { deleted: true, title: 'New title' },
    { title: '' },
    { quantity: 'x'.repeat(41) },
    { completed: 'toggle' },
    { household_id: otherHouseholdId, title: 'Milk' },
    { revision: 100, completed: true },
  ];
  for (const changes of invalidPatches) {
    await assert.rejects(
      repository.mutate({
        operationId,
        householdId,
        itemId,
        baseRevision: 1,
        changes: changes as ItemChanges,
      }),
    );
  }
  await assert.rejects(
    repository.mutate({
      operationId,
      householdId,
      itemId,
      baseRevision: 0,
      changes: { completed: true },
    }),
  );
  assert.equal(calls.length, 0);
});

test('mutation responses must identify the requested item and distinguish conflict from success', async () => {
  const request = {
    operationId,
    householdId,
    itemId,
    baseRevision: 1,
    changes: { completed: true },
  };
  assert.deepEqual(
    await fixture({ status: 'conflict', item: null }).repository.mutate(
      request,
    ),
    {
      status: 'conflict',
      item: null,
    },
  );
  for (const data of [
    { status: 'applied', item: null },
    { status: 'success', item: item() },
    { status: 'applied', item: item({ id: noteId }) },
  ]) {
    await assert.rejects(
      fixture(data).repository.mutate(request),
      SharedDataError,
    );
  }
});

test('note conflicts preserve server text and submitted draft including whitespace', async () => {
  const serverNote = note({ body: 'Newer flatmate note', revision: 2 });
  const { repository, calls } = fixture({
    status: 'conflict',
    note: serverNote,
  });
  const draft = '  My draft\n\n';
  assert.deepEqual(
    await repository.saveNote({
      operationId,
      householdId,
      baseRevision: 1,
      body: draft,
    }),
    {
      status: 'conflict',
      note: serverNote,
    },
  );
  assert.equal(calls[0]!.args.body, draft);
  assert.equal(calls[0]!.args.base_revision, 1);
});

test('Unicode limits agree with PostgreSQL character counts', async () => {
  const unicodeNote = '🥑'.repeat(2000);
  const { repository, calls } = fixture({
    status: 'applied',
    note: note({ body: unicodeNote }),
  });
  await repository.saveNote({
    operationId,
    householdId,
    baseRevision: 1,
    body: unicodeNote,
  });
  await assert.rejects(
    repository.saveNote({
      operationId,
      householdId,
      baseRevision: 1,
      body: `${unicodeNote}🥑`,
    }),
  );
  assert.equal(calls.length, 1);
});

test('transport failures retain the original failure for connection/access handling', async () => {
  const failure = { code: '42501', message: 'Membership was removed.' };
  const repository = createSharedRepository({
    rpc: async () => ({ data: null, error: failure }),
  });
  await assert.rejects(
    repository.load(householdId),
    (error) => error === failure,
  );
});

test('independent grocery fields rebase without discarding another member’s edit', () => {
  const original = item();
  const remote = item({ title: 'Oat milk', revision: 2 });
  assert.deepEqual(
    rebaseItemChange(original, remote, { quantity: '2 cartons' }),
    { quantity: '2 cartons' },
  );
  assert.equal(rebaseItemChange(original, remote, { title: 'Soy milk' }), null);
  assert.deepEqual(
    rebaseItemChange(original, remote, { title: ' Oat milk ' }),
    {},
  );
});

test('rebase cannot resurrect deleted groceries, overwrite newer deletion targets, or travel backwards', () => {
  const original = item();
  assert.equal(
    rebaseItemChange(original, item({ deleted_at: now, revision: 2 }), {
      completed: true,
    }),
    null,
  );
  assert.equal(rebaseItemChange(original, null, { quantity: '2' }), null);
  assert.equal(
    rebaseItemChange(original, item({ revision: 2, quantity: '2' }), {
      deleted: true,
    }),
    null,
  );
  assert.deepEqual(rebaseItemChange(original, original, { deleted: true }), {
    deleted: true,
  });
  assert.equal(
    rebaseItemChange(item({ revision: 3 }), item({ revision: 2 }), {
      title: 'Oat milk',
    }),
    null,
  );
});

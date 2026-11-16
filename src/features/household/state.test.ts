import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createItem,
  householdReducer,
  parseHouseholdState,
  type HouseholdState,
} from './state.ts';

const now = '2026-11-16T10:00:00.000Z';

function fixture(): HouseholdState {
  return {
    version: 1,
    items: [createItem('milk', 'Milk', '1 carton', now)],
    note: 'Oat milk for coffee, please.',
  };
}

test('saved groceries and notes survive a serialization round trip', () => {
  const original = fixture();
  original.items[0]!.completed = true;
  assert.deepEqual(parseHouseholdState(JSON.stringify(original)), original);
});

test('an intentionally empty list stays empty when reloaded', () => {
  const empty: HouseholdState = { version: 1, items: [], note: '' };
  assert.deepEqual(parseHouseholdState(JSON.stringify(empty)), empty);
});

test('unreadable, malformed, and newer saved data is rejected', () => {
  const invalid = [
    '{invalid json',
    'null',
    JSON.stringify({ ...fixture(), version: 2 }),
    JSON.stringify({ ...fixture(), note: null }),
    JSON.stringify({ ...fixture(), items: [null] }),
    JSON.stringify({
      ...fixture(),
      items: [{ ...fixture().items[0], completed: 'yes' }],
    }),
    JSON.stringify({
      ...fixture(),
      items: [{ ...fixture().items[0], updatedAt: 'yesterday' }],
    }),
    JSON.stringify({
      ...fixture(),
      items: [{ ...fixture().items[0], title: '   ' }],
    }),
    JSON.stringify({
      ...fixture(),
      items: [{ ...fixture().items[0], quantity: '' }],
    }),
    JSON.stringify({
      ...fixture(),
      items: [fixture().items[0], fixture().items[0]],
    }),
  ];

  for (const raw of invalid) {
    assert.throws(() => parseHouseholdState(raw));
  }
});

test('adding an item normalizes input and rejects an empty grocery name', () => {
  const item = createItem('new-item', '  Oat milk  ', '   ', now);
  assert.equal(item.title, 'Oat milk');
  assert.equal(item.quantity, '1');
  assert.throws(() => createItem('new-item', '   ', '2', now));
});

test('repeated item IDs are idempotent but matching grocery names are allowed', () => {
  const original = fixture();
  const item = original.items[0]!;
  const replayed = householdReducer(original, { type: 'add', item });
  assert.equal(replayed.items.length, 1);

  const second = householdReducer(replayed, {
    type: 'add',
    item: createItem('another-milk', 'Milk', '2 cartons', now),
  });
  assert.equal(second.items.length, 2);
  assert.equal(original.items.length, 1);
});

test('shopping actions preserve notes and only clear bought items', () => {
  const original = fixture();
  const withEggs = householdReducer(original, {
    type: 'add',
    item: createItem('eggs', 'Eggs', '6', now),
  });
  const later = '2026-11-16T11:00:00.000Z';
  const checked = householdReducer(withEggs, {
    type: 'toggle',
    id: 'milk',
    updatedAt: later,
  });
  const cleared = householdReducer(checked, { type: 'clear-completed' });

  assert.equal(checked.items[0]!.updatedAt, later);
  assert.equal(original.items[0]!.completed, false);
  assert.deepEqual(
    cleared.items.map((item) => item.id),
    ['eggs'],
  );
  assert.equal(cleared.note, original.note);
});

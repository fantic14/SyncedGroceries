import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverOwnEdits } from './recovery.ts';

test('recovery exports only owned intentions, never old household records', () => {
  const result = recoverOwnEdits(
    {
      version: 1,
      userId: 'alice',
      householdId: 'flat',
      server: { privateNote: 'PRIVATE SERVER DATA' },
      draft: { body: 'My draft', base: { body: 'PRIVATE SERVER DATA' } },
      queue: [
        {
          id: '1',
          kind: 'item',
          itemId: 'milk',
          changes: { quantity: '2' },
          base: { title: 'PRIVATE SERVER DATA' },
          conflict: { title: 'PRIVATE SERVER DATA' },
        },
        {
          id: '2',
          kind: 'note',
          body: 'My note',
          conflict: { body: 'PRIVATE SERVER DATA' },
        },
      ],
    },
    'alice',
    'flat',
  );
  assert.equal(result?.noteDraft, 'My draft');
  assert.equal(result?.edits.length, 2);
  assert.ok(!JSON.stringify(result).includes('PRIVATE SERVER DATA'));
});

test('recovery refuses another account or household and unsupported patch fields', () => {
  const data = {
    version: 1,
    userId: 'alice',
    householdId: 'flat',
    draft: null,
    queue: [],
  };
  assert.throws(() => recoverOwnEdits(data, 'bob', 'flat'));
  assert.throws(() => recoverOwnEdits(data, 'alice', 'other'));
  assert.throws(() =>
    recoverOwnEdits(
      {
        ...data,
        queue: [
          {
            id: '1',
            kind: 'item',
            itemId: 'item',
            changes: { server: 'not mine' },
          },
        ],
      },
      'alice',
      'flat',
    ),
  );
});

import type { ItemChanges } from '../shared/types.ts';

export function describeOwnChanges(changes: ItemChanges) {
  return [
    changes.title !== undefined ? `Item: ${changes.title}` : null,
    changes.quantity !== undefined ? `Quantity: ${changes.quantity}` : null,
    changes.completed !== undefined
      ? changes.completed
        ? 'Mark as bought'
        : 'Mark as needed'
      : null,
    changes.deleted ? 'Remove this grocery' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function formatRecoveredWork(
  work: NonNullable<ReturnType<typeof recoverOwnEdits>>,
) {
  return [
    'Synced Groceries — saved edits',
    work.noteDraft !== null ? `Note draft:\n${work.noteDraft}` : null,
    ...work.edits.map((edit, index) =>
      edit.kind === 'note'
        ? `Saved note change ${index + 1}:\n${edit.body}`
        : `Grocery change ${index + 1}: ${describeOwnChanges(edit.changes!)}`,
    ),
  ]
    .filter((value) => value !== null)
    .join('\n\n');
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && Array.from(value).length <= max;

// Recovery deliberately projects only the user's own intended changes. Cached
// server records, old note bases, author IDs, and conflict payloads are excluded.
export function recoverOwnEdits(
  value: unknown,
  userId: string,
  householdId: string,
) {
  if (value === null) return null;
  if (
    !record(value) ||
    value.version !== 1 ||
    value.userId !== userId ||
    value.householdId !== householdId ||
    !Array.isArray(value.queue)
  )
    throw new Error('The saved edits could not be read safely.');
  const edits = value.queue.map((entry) => {
    if (!record(entry) || typeof entry.id !== 'string')
      throw new Error('A saved edit could not be read.');
    if (entry.kind === 'note' && text(entry.body, 2000))
      return { id: entry.id, kind: 'note' as const, body: entry.body };
    if (
      entry.kind !== 'item' ||
      typeof entry.itemId !== 'string' ||
      !record(entry.changes)
    )
      throw new Error('A saved edit could not be read.');
    const input = entry.changes;
    const changes: ItemChanges = {};
    for (const [key, change] of Object.entries(input)) {
      if (key === 'title' && text(change, 120)) changes.title = change;
      else if (key === 'quantity' && text(change, 40))
        changes.quantity = change;
      else if (key === 'completed' && typeof change === 'boolean')
        changes.completed = change;
      else if (key === 'deleted' && change === true) changes.deleted = true;
      else throw new Error('A saved edit could not be read.');
    }
    return {
      id: entry.id,
      kind: 'item' as const,
      itemId: entry.itemId,
      changes,
    };
  });
  if (
    value.draft !== null &&
    (!record(value.draft) || !text(value.draft.body, 2000))
  )
    throw new Error('The saved draft could not be read.');
  return {
    householdId,
    noteDraft: record(value.draft) ? (value.draft.body as string) : null,
    edits,
  };
}

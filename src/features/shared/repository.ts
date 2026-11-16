import type {
  ItemChanges,
  ItemMutationRequest,
  ItemResult,
  NoteMutationRequest,
  NoteResult,
  SharedItem,
  SharedNote,
  SharedSnapshot,
} from './types.ts';

type Transport = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

export class SharedDataError extends Error {
  constructor() {
    super('The shared household response could not be read. Please refresh.');
    this.name = 'SharedDataError';
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value: unknown): value is string =>
  typeof value === 'string' && uuidPattern.test(value);
const isActor = (value: unknown): value is string | null =>
  value === null || isId(value);
const isDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));
const isRevision = (value: unknown, minimum = 1): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
const textLength = (value: string) => Array.from(value).length;
const isShortText = (value: unknown, limit: number): value is string =>
  typeof value === 'string' &&
  textLength(value.trim()) > 0 &&
  textLength(value.trim()) <= limit;

function assertId(value: unknown) {
  if (!isId(value)) throw new Error('The shared record identifier is invalid.');
}

function assertRevision(value: unknown, minimum: number) {
  if (!isRevision(value, minimum)) {
    throw new Error('Refresh this shared record before editing it.');
  }
}

function parseItem(value: unknown, householdId: string): SharedItem {
  if (
    !isRecord(value) ||
    !isId(value.id) ||
    !isShortText(value.title, 120) ||
    !isShortText(value.quantity, 40) ||
    typeof value.completed !== 'boolean' ||
    !isActor(value.created_by) ||
    !isActor(value.updated_by) ||
    !isDate(value.created_at) ||
    !isDate(value.updated_at) ||
    !isRevision(value.revision) ||
    !(value.deleted_at === null || isDate(value.deleted_at)) ||
    ('household_id' in value &&
      (typeof value.household_id !== 'string' ||
        value.household_id.toLowerCase() !== householdId.toLowerCase()))
  ) {
    throw new SharedDataError();
  }
  return {
    id: value.id,
    title: value.title,
    quantity: value.quantity,
    completed: value.completed,
    created_by: value.created_by,
    updated_by: value.updated_by,
    created_at: value.created_at,
    updated_at: value.updated_at,
    revision: value.revision,
    deleted_at: value.deleted_at,
  };
}

function parseNote(value: unknown, householdId: string): SharedNote {
  if (
    !isRecord(value) ||
    !isId(value.id) ||
    typeof value.body !== 'string' ||
    textLength(value.body) > 2000 ||
    !isActor(value.updated_by) ||
    !isDate(value.updated_at) ||
    !isRevision(value.revision) ||
    ('household_id' in value &&
      (typeof value.household_id !== 'string' ||
        value.household_id.toLowerCase() !== householdId.toLowerCase()))
  ) {
    throw new SharedDataError();
  }
  return {
    id: value.id,
    body: value.body,
    updated_by: value.updated_by,
    updated_at: value.updated_at,
    revision: value.revision,
  };
}

function validateChanges(changes: ItemChanges): void {
  if (!isRecord(changes)) throw new Error('Choose a grocery change to save.');
  const keys = Object.keys(changes);
  if (
    keys.length === 0 ||
    keys.some(
      (key) => !['title', 'quantity', 'completed', 'deleted'].includes(key),
    )
  ) {
    throw new Error('Choose a valid grocery change to save.');
  }
  if ('deleted' in changes) {
    if (changes.deleted !== true || keys.length !== 1) {
      throw new Error(
        'A grocery deletion must be saved separately from edits.',
      );
    }
    return;
  }
  if ('title' in changes && !isShortText(changes.title, 120)) {
    throw new Error('Enter a grocery name between 1 and 120 characters.');
  }
  if ('quantity' in changes && !isShortText(changes.quantity, 40)) {
    throw new Error('Enter a quantity between 1 and 40 characters.');
  }
  if ('completed' in changes && typeof changes.completed !== 'boolean') {
    throw new Error('Choose whether the grocery has been bought.');
  }
}

export function createSharedRepository(transport: Transport) {
  async function call(name: string, args: Record<string, unknown>) {
    const result = await transport.rpc(name, args);
    if (result.error) throw result.error;
    return result.data;
  }

  return {
    async load(householdId: string): Promise<SharedSnapshot> {
      assertId(householdId);
      const data = await call('get_shared_household', {
        household_id: householdId,
      });
      if (!isRecord(data) || !Array.isArray(data.items)) {
        throw new SharedDataError();
      }
      const items = data.items.map((item) => parseItem(item, householdId));
      if (
        new Set(items.map((item) => item.id.toLowerCase())).size !==
        items.length
      ) {
        throw new SharedDataError();
      }
      return { items, note: parseNote(data.note, householdId) };
    },

    async mutate(request: ItemMutationRequest): Promise<ItemResult> {
      assertId(request.operationId);
      assertId(request.householdId);
      assertId(request.itemId);
      assertRevision(request.baseRevision, 0);
      validateChanges(request.changes);
      if (
        request.baseRevision === 0 &&
        (!('title' in request.changes) ||
          !('quantity' in request.changes) ||
          'deleted' in request.changes)
      ) {
        throw new Error('A new grocery needs a name and quantity.');
      }
      const data = await call('mutate_grocery', {
        operation_id: request.operationId,
        household_id: request.householdId,
        item_id: request.itemId,
        base_revision: request.baseRevision,
        changes: { ...request.changes },
      });
      if (
        !isRecord(data) ||
        (data.status !== 'applied' && data.status !== 'conflict') ||
        (data.status === 'applied' && data.item === null)
      ) {
        throw new SharedDataError();
      }
      const item =
        data.item === null ? null : parseItem(data.item, request.householdId);
      if (item && item.id.toLowerCase() !== request.itemId.toLowerCase()) {
        throw new SharedDataError();
      }
      if (data.status === 'applied') {
        if (!item) throw new SharedDataError();
        return { status: 'applied', item };
      }
      return { status: 'conflict', item };
    },

    async saveNote(request: NoteMutationRequest): Promise<NoteResult> {
      assertId(request.operationId);
      assertId(request.householdId);
      assertRevision(request.baseRevision, 1);
      if (typeof request.body !== 'string' || textLength(request.body) > 2000) {
        throw new Error('Keep the household note within 2,000 characters.');
      }
      const data = await call('save_household_note', {
        operation_id: request.operationId,
        household_id: request.householdId,
        base_revision: request.baseRevision,
        body: request.body,
      });
      if (
        !isRecord(data) ||
        (data.status !== 'applied' && data.status !== 'conflict')
      ) {
        throw new SharedDataError();
      }
      return {
        status: data.status,
        note: parseNote(data.note, request.householdId),
      };
    },
  };
}

/**
 * Rebase only fields whose remote values have not diverged from the edit's
 * starting point. An empty patch means the desired values already exist.
 * Null requires a visible conflict choice; deletions never overwrite newer work.
 */
export function rebaseItemChange(
  base: SharedItem,
  current: SharedItem | null,
  changes: ItemChanges,
): ItemChanges | null {
  validateChanges(changes);
  if (
    !current ||
    base.id.toLowerCase() !== current.id.toLowerCase() ||
    current.revision < base.revision ||
    base.deleted_at !== null ||
    current.deleted_at !== null
  )
    return null;

  if (changes.deleted) {
    return current.revision === base.revision ? { deleted: true } : null;
  }
  const rebased: ItemChanges = {};
  for (const field of ['title', 'quantity', 'completed'] as const) {
    if (!(field in changes)) continue;
    const desired =
      typeof changes[field] === 'string'
        ? changes[field].trim()
        : changes[field];
    if (current[field] === desired) continue;
    if (current[field] !== base[field]) return null;
    if (field === 'completed') rebased.completed = changes.completed;
    else if (field === 'title') rebased.title = changes.title!.trim();
    else rebased.quantity = changes.quantity!.trim();
  }
  return rebased;
}

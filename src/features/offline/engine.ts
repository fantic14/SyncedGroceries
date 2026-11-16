import { identityError } from '../identity/validation.ts';
import {
  rebaseItemChange,
  type createSharedRepository,
} from '../shared/repository.ts';
import type {
  ItemChanges,
  SharedItem,
  SharedNote,
  SharedSnapshot,
} from '../shared/types.ts';
import type { ScopeCache } from './persistence.ts';
import type {
  OfflineDocument,
  OfflineItemOperation,
  OfflineNoteOperation,
  OfflineOperation,
  OfflineState,
} from './types.ts';

type Options = {
  householdId: string;
  userId: string;
  repository: ReturnType<typeof createSharedRepository>;
  newId: () => string;
  cacheFactory: () => ScopeCache<OfflineDocument>;
  now?: () => number;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown, limit: number, empty = false): value is string =>
  typeof value === 'string' &&
  (empty || value.trim().length > 0) &&
  Array.from(value).length <= limit;
const timestamp = (value: unknown) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const actor = (value: unknown) => value === null || typeof value === 'string';
const validItem = (value: unknown): value is SharedItem =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  text(value.title, 120) &&
  text(value.quantity, 40) &&
  typeof value.completed === 'boolean' &&
  actor(value.created_by) &&
  actor(value.updated_by) &&
  timestamp(value.created_at) &&
  timestamp(value.updated_at) &&
  integer(value.revision) &&
  value.revision >= 1 &&
  (value.deleted_at === null || timestamp(value.deleted_at));
const validNote = (value: unknown): value is SharedNote =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  text(value.body, 2000, true) &&
  actor(value.updated_by) &&
  timestamp(value.updated_at) &&
  integer(value.revision) &&
  value.revision >= 1;
function validChanges(value: unknown): value is ItemChanges {
  if (
    !isRecord(value) ||
    Object.keys(value).length === 0 ||
    Object.keys(value).some(
      (key) => !['title', 'quantity', 'completed', 'deleted'].includes(key),
    )
  )
    return false;
  if ('deleted' in value)
    return value.deleted === true && Object.keys(value).length === 1;
  return (
    (!('title' in value) || text(value.title, 120)) &&
    (!('quantity' in value) || text(value.quantity, 40)) &&
    (!('completed' in value) || typeof value.completed === 'boolean')
  );
}

export function validateDocument(
  value: unknown,
  householdId: string,
  userId: string,
): OfflineDocument {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.householdId !== householdId ||
    value.userId !== userId ||
    !Array.isArray(value.queue) ||
    !integer(value.nextRetryAt) ||
    !integer(value.readAttempts) ||
    !(value.lastSyncedAt === null || integer(value.lastSyncedAt)) ||
    !['active', 'reauth', 'revoked'].includes(String(value.access))
  )
    throw new Error('The offline household data could not be read.');
  if (
    value.server !== null &&
    (!isRecord(value.server) ||
      !Array.isArray(value.server.items) ||
      !value.server.items.every(validItem) ||
      new Set(value.server.items.map((item) => item.id)).size !==
        value.server.items.length ||
      !validNote(value.server.note))
  )
    throw new Error('The cached household snapshot is invalid.');
  if (
    value.draft !== null &&
    (!isRecord(value.draft) ||
      !text(value.draft.body, 2000, true) ||
      !validNote(value.draft.base))
  )
    throw new Error('The saved note draft is invalid.');
  const ids = new Set<string>();
  for (const entry of value.queue) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      ids.has(entry.id) ||
      !timestamp(entry.queuedAt) ||
      !integer(entry.attempts) ||
      !['queued', 'conflict', 'failed'].includes(String(entry.status)) ||
      !(entry.message === null || typeof entry.message === 'string')
    )
      throw new Error('The saved operation queue is invalid.');
    ids.add(entry.id);
    if (entry.kind === 'item') {
      if (
        typeof entry.itemId !== 'string' ||
        !(entry.base === null || validItem(entry.base)) ||
        typeof entry.baseWasQueued !== 'boolean' ||
        !integer(entry.rebases) ||
        !validChanges(entry.changes) ||
        (entry.base === null &&
          (!('title' in entry.changes) ||
            !('quantity' in entry.changes) ||
            'deleted' in entry.changes)) ||
        (entry.base !== null && entry.base.id !== entry.itemId) ||
        !(entry.conflict === null || validItem(entry.conflict))
      )
        throw new Error('A queued grocery edit is invalid.');
      const changes = entry.changes;
      if (
        entry.request !== null &&
        (!isRecord(entry.request) ||
          entry.request.operationId !== entry.id ||
          entry.request.householdId !== householdId ||
          entry.request.itemId !== entry.itemId ||
          !integer(entry.request.baseRevision) ||
          (entry.base === null
            ? entry.request.baseRevision !== 0
            : entry.request.baseRevision < 1) ||
          !validChanges(entry.request.changes) ||
          Object.entries(entry.request.changes).some(
            ([key, value]) => changes[key as keyof ItemChanges] !== value,
          ))
      )
        throw new Error('A saved grocery request is invalid.');
    } else if (entry.kind === 'note') {
      if (
        !validNote(entry.base) ||
        !text(entry.body, 2000, true) ||
        !(entry.conflict === null || validNote(entry.conflict))
      )
        throw new Error('A queued note edit is invalid.');
      if (
        entry.request !== null &&
        (!isRecord(entry.request) ||
          entry.request.operationId !== entry.id ||
          entry.request.householdId !== householdId ||
          !integer(entry.request.baseRevision) ||
          entry.request.baseRevision < 1 ||
          entry.request.body !== entry.body)
      )
        throw new Error('A saved note request is invalid.');
    } else throw new Error('The queued operation type is not supported.');
  }
  return clone(value) as OfflineDocument;
}

function mergeServer(
  previous: SharedSnapshot | null,
  incoming: SharedSnapshot,
): SharedSnapshot {
  const items = new Map(previous?.items.map((item) => [item.id, item]) ?? []);
  for (const item of incoming.items)
    if ((items.get(item.id)?.revision ?? 0) <= item.revision)
      items.set(item.id, item);
  return {
    items: [...items.values()],
    note:
      previous && previous.note.revision > incoming.note.revision
        ? previous.note
        : incoming.note,
  };
}

function visible(
  document: OfflineDocument,
  userId: string,
): SharedSnapshot | null {
  if (!document.server || document.access === 'revoked') return null;
  const snapshot = clone(document.server);
  const items = new Map(snapshot.items.map((item) => [item.id, item]));
  for (const operation of document.queue) {
    if (operation.status !== 'queued') continue;
    if (operation.kind === 'note') {
      snapshot.note = {
        ...snapshot.note,
        body: operation.body,
        revision: snapshot.note.revision + 1,
        updated_at: operation.queuedAt,
        updated_by: userId,
      };
      continue;
    }
    const current = items.get(operation.itemId);
    if (current?.deleted_at) continue;
    if (
      current &&
      !operation.changes.deleted &&
      Object.entries(operation.changes).every(
        ([key, value]) => current[key as keyof SharedItem] === value,
      )
    )
      continue;
    if (
      !current &&
      operation.base === null &&
      operation.changes.title &&
      operation.changes.quantity
    ) {
      items.set(operation.itemId, {
        id: operation.itemId,
        title: operation.changes.title,
        quantity: operation.changes.quantity,
        completed: operation.changes.completed ?? false,
        created_by: userId,
        updated_by: userId,
        created_at: operation.queuedAt,
        updated_at: operation.queuedAt,
        revision: 1,
        deleted_at: null,
      });
    } else if (current) {
      items.set(current.id, {
        ...current,
        ...('title' in operation.changes
          ? { title: operation.changes.title! }
          : {}),
        ...('quantity' in operation.changes
          ? { quantity: operation.changes.quantity! }
          : {}),
        ...('completed' in operation.changes
          ? { completed: operation.changes.completed! }
          : {}),
        deleted_at: operation.changes.deleted ? operation.queuedAt : null,
        updated_at: operation.queuedAt,
        updated_by: userId,
        revision: current.revision + 1,
      });
    }
  }
  snapshot.items = [...items.values()];
  return snapshot;
}

export function createOfflineStore({
  householdId,
  userId,
  repository,
  newId,
  cacheFactory,
  now = Date.now,
}: Options) {
  const blank = (): OfflineDocument => ({
    version: 1,
    userId,
    householdId,
    server: null,
    queue: [],
    draft: null,
    access: 'active',
    nextRetryAt: 0,
    readAttempts: 0,
    lastSyncedAt: null,
  });
  let document = blank();
  let cache: ScopeCache<OfflineDocument> | null = null;
  let active = true;
  let hydrated = false;
  let epoch = 0;
  let online = false;
  let authReady = true;
  let syncing = false;
  let hydrating: Promise<boolean> | null = null;
  let syncingPromise: Promise<boolean> | null = null;
  let syncAgain = false;
  let writeQueue: Promise<unknown> = Promise.resolve();
  let localWrites = 0;
  let storageError: string | null = null;
  let error: string | null = null;
  let loading = true;
  let connection: OfflineState['connection'] = 'connecting';
  const listeners = new Set<() => void>();
  let state: OfflineState = {
    snapshot: null,
    loading: true,
    busy: false,
    error: null,
    connection,
    pending: false,
    noteDraft: '',
    noteConflict: null,
    itemConflict: null,
    queuedCount: 0,
    failedCount: 0,
    failedDetails: [],
    syncStatus: 'offline',
    storageError: null,
    online: false,
    nextRetryAt: 0,
    lastSyncedAt: null,
  };

  function publish() {
    if (!active) return;
    const snapshot = visible(document, userId);
    const failed = document.queue.filter(
      (operation) => operation.status !== 'queued',
    );
    const conflict = document.queue.find(
      (operation) => operation.status === 'conflict',
    );
    const noteEdits = document.queue.filter(
      (operation): operation is OfflineNoteOperation =>
        operation.kind === 'note',
    );
    const lastNote = noteEdits[noteEdits.length - 1];
    const draftConflict =
      document.draft &&
      snapshot &&
      document.draft.base.body !== snapshot.note.body &&
      document.draft.body !== snapshot.note.body
        ? (document.server?.note ?? null)
        : null;
    const revoked = document.access === 'revoked';
    state = {
      snapshot,
      loading,
      busy: localWrites > 0,
      error,
      connection,
      pending: document.queue.length > 0,
      noteDraft: revoked
        ? ''
        : (document.draft?.body ?? lastNote?.body ?? snapshot?.note.body ?? ''),
      noteConflict: revoked
        ? null
        : conflict?.kind === 'note'
          ? conflict.conflict
          : draftConflict,
      itemConflict: revoked
        ? null
        : conflict?.kind === 'item'
          ? conflict.conflict
          : null,
      queuedCount: document.queue.length,
      failedCount: failed.length,
      failedDetails: failed.map((operation) =>
        operation.kind === 'note'
          ? {
              id: operation.id,
              kind: 'note',
              message: operation.message ?? 'This note needs review.',
              body: operation.body,
            }
          : {
              id: operation.id,
              kind: 'item',
              message: operation.message ?? 'This grocery edit needs review.',
              itemId: operation.itemId,
              changes: operation.changes,
            },
      ),
      syncStatus:
        storageError || revoked || failed.length
          ? 'failed'
          : document.access === 'reauth' || !authReady
            ? 'reauth'
            : !online
              ? 'offline'
              : syncing
                ? 'syncing'
                : document.queue.length
                  ? 'pending'
                  : document.server
                    ? 'synced'
                    : 'pending',
      storageError,
      online,
      nextRetryAt: document.nextRetryAt,
      lastSyncedAt: document.lastSyncedAt,
    };
    listeners.forEach((listener) => listener());
  }

  function refreshConflicts(next: OfflineDocument) {
    if (!next.server) return;
    for (const operation of next.queue) {
      if (operation.status !== 'conflict') continue;
      operation.conflict =
        operation.kind === 'note'
          ? next.server.note
          : (next.server.items.find((item) => item.id === operation.itemId) ??
            null);
    }
  }

  function transaction(
    change: (next: OfflineDocument) => void,
  ): Promise<boolean> {
    const started = epoch;
    localWrites++;
    publish();
    const result = writeQueue
      .catch(() => undefined)
      .then(async () => {
        if (!active || epoch !== started || !hydrated || !cache) return false;
        const next = clone(document);
        change(next);
        try {
          await cache.save(next);
          if (!active || epoch !== started) return false;
          document = next;
          storageError = null;
          publish();
          return true;
        } catch {
          if (active && epoch === started) {
            storageError =
              'Couldn’t save offline data. Your last edit has not been queued; keep the app open and retry.';
            error = storageError;
            publish();
          }
          return false;
        }
      })
      .finally(() => {
        localWrites--;
        publish();
      });
    writeQueue = result;
    return result;
  }

  async function hydrate(): Promise<boolean> {
    if (!active) return false;
    if (hydrated) return true;
    if (hydrating) return hydrating;
    const started = epoch;
    hydrating = (async () => {
      loading = true;
      publish();
      try {
        cache ??= cacheFactory();
        const saved = await cache.load();
        if (!active || epoch !== started) return false;
        document =
          saved === null
            ? blank()
            : validateDocument(saved, householdId, userId);
        hydrated = true;
        storageError = null;
        error =
          document.access === 'revoked'
            ? 'Household access was removed. Your rejected local edits are retained separately for recovery.'
            : null;
        return true;
      } catch {
        if (active && epoch === started) {
          cache?.close();
          cache = null;
          storageError =
            'Couldn’t open offline data. Saved data has not been replaced. Retry or sign out to clear this account’s cache.';
          error = storageError;
        }
        return false;
      } finally {
        if (active && epoch === started) {
          loading = false;
          hydrating = null;
          publish();
        }
      }
    })();
    return hydrating;
  }

  async function recordFailure(
    cause: unknown,
    operationId?: string,
  ): Promise<boolean> {
    const code = (cause as { code?: string; status?: number } | null)?.code;
    const status = (cause as { status?: number } | null)?.status;
    const revoked = code === '42501';
    const reauth =
      code === 'PGRST301' ||
      code === 'PGRST303' ||
      code === 'bad_jwt' ||
      code === 'refresh_token_not_found' ||
      status === 401;
    const retryableCode =
      !!code &&
      (/^(08|53|57)/.test(code) || code === '40001' || code === '40P01');
    const definite =
      !!code &&
      !code.startsWith('PGRST') &&
      !revoked &&
      !reauth &&
      !retryableCode &&
      !(status && status >= 500);
    const message = revoked
      ? 'Your household access was removed. Pending local edits were retained for recovery and will not be sent.'
      : reauth
        ? 'Sign in again to resume queued changes. Your offline work is saved on this device.'
        : definite
          ? identityError(cause)
          : 'Couldn’t reach your household. Your changes are saved on this device and will retry.';
    const saved = await transaction((next) => {
      if (revoked) {
        next.access = 'revoked';
        next.server = null;
        for (const operation of next.queue) {
          operation.status = 'failed';
          operation.message = message;
        }
      } else if (reauth) next.access = 'reauth';
      else if (definite && operationId) {
        const operation = next.queue.find((value) => value.id === operationId);
        if (operation) {
          operation.status = 'failed';
          operation.message = message;
        }
      } else {
        const operation = next.queue.find((value) => value.id === operationId);
        if (operation)
          operation.attempts = Math.min(30, operation.attempts + 1);
        else next.readAttempts = Math.min(30, next.readAttempts + 1);
        next.nextRetryAt =
          now() +
          Math.min(
            60000,
            1000 * 2 ** Math.min(6, operation?.attempts ?? next.readAttempts),
          );
      }
    });
    if (saved) {
      error = message;
      publish();
    }
    return false;
  }

  function itemPatch(
    operation: OfflineItemOperation,
    current: SharedItem | null,
  ): ItemChanges | null {
    if (!operation.base) return current ? null : operation.changes;
    if (!current || current.deleted_at || operation.base.deleted_at)
      return null;
    return rebaseItemChange(
      {
        ...operation.base,
        revision:
          operation.baseWasQueued && !operation.changes.deleted
            ? Math.min(operation.base.revision, current.revision)
            : operation.base.revision,
      },
      current,
      operation.changes,
    );
  }

  async function flush(started: number): Promise<boolean> {
    while (
      active &&
      epoch === started &&
      online &&
      authReady &&
      document.access === 'active' &&
      !storageError
    ) {
      const head = document.queue[0];
      if (!head) return true;
      if (
        head.status !== 'queued' ||
        document.nextRetryAt > now() ||
        !document.server
      )
        return false;
      if (!head.request) {
        let prepared = false;
        const saved = await transaction((next) => {
          const operation = next.queue[0];
          if (!operation || operation.id !== head.id || !next.server) return;
          if (operation.kind === 'item') {
            const current =
              next.server.items.find((item) => item.id === operation.itemId) ??
              null;
            const patch = itemPatch(operation, current);
            if (patch === null) {
              operation.status = 'conflict';
              operation.conflict = current;
              operation.message = current?.deleted_at
                ? 'A housemate removed this grocery. Your edit has not been applied.'
                : 'This grocery changed while you were offline. Review the server version before continuing.';
            } else if (!Object.keys(patch).length) {
              next.queue.shift();
              prepared = true;
            } else {
              operation.request = {
                operationId: operation.id,
                householdId,
                itemId: operation.itemId,
                baseRevision: current?.revision ?? 0,
                changes: patch,
              };
              prepared = true;
            }
          } else {
            const current = next.server.note;
            if (
              current.body !== operation.base.body &&
              current.body !== operation.body
            ) {
              operation.status = 'conflict';
              operation.conflict = current;
              operation.message =
                'A housemate changed the note. Both versions are saved; choose which to use.';
            } else if (current.body === operation.body) {
              next.queue.shift();
              prepared = true;
            } else {
              operation.request = {
                operationId: operation.id,
                householdId,
                baseRevision: current.revision,
                body: operation.body,
              };
              prepared = true;
            }
          }
        });
        if (!saved || !prepared) {
          error = document.queue[0]?.message ?? error;
          publish();
          return false;
        }
        if (document.queue[0]?.id !== head.id) continue;
      }
      if (
        !active ||
        epoch !== started ||
        !online ||
        !authReady ||
        document.access !== 'active'
      )
        return false;
      const frozen = clone(document.queue[0]!);
      try {
        const result =
          frozen.kind === 'item'
            ? await repository.mutate(frozen.request!)
            : await repository.saveNote(frozen.request!);
        if (!active || epoch !== started) return false;
        const saved = await transaction((next) => {
          const operation = next.queue[0];
          if (!operation || operation.id !== frozen.id || !next.server) return;
          if ('item' in result) {
            if (result.item)
              next.server = mergeServer(next.server, {
                ...next.server,
                items: [result.item],
              });
          } else
            next.server = mergeServer(next.server, {
              ...next.server,
              note: result.note,
            });
          if (result.status === 'conflict') {
            if (
              operation.kind === 'item' &&
              'item' in result &&
              result.item &&
              operation.rebases < 1
            ) {
              const patch = itemPatch(operation, result.item);
              if (patch && !Object.keys(patch).length) {
                next.queue.shift();
                return;
              }
              if (patch) {
                operation.id = newId();
                operation.base = result.item;
                operation.baseWasQueued = false;
                operation.changes = patch;
                operation.request = null;
                operation.rebases++;
                return;
              }
            }
            operation.status = 'conflict';
            operation.message =
              operation.kind === 'note'
                ? 'A housemate changed the note. Both versions are saved; choose which to use.'
                : 'This grocery changed before your edit arrived. Review the latest version.';
            if (operation.kind === 'item' && 'item' in result)
              operation.conflict = result.item;
            if (operation.kind === 'note' && 'note' in result)
              operation.conflict = result.note;
          } else {
            next.queue.shift();
            next.nextRetryAt = 0;
          }
        });
        if (!saved) return false;
        if (
          result.status === 'conflict' &&
          document.queue[0]?.id === frozen.id &&
          document.queue[0]?.status !== 'queued'
        ) {
          error = document.queue[0]?.message ?? null;
          publish();
          return false;
        }
        error = null;
        publish();
      } catch (cause) {
        if (active && epoch === started) return recordFailure(cause, frozen.id);
        return false;
      }
    }
    return false;
  }

  const sync = (): Promise<boolean> => {
    if (!active) return Promise.resolve(false);
    if (syncingPromise) {
      syncAgain = true;
      return syncingPromise;
    }
    const started = epoch;
    syncingPromise = (async () => {
      if (
        !(await hydrate()) ||
        !online ||
        !authReady ||
        document.access === 'reauth' ||
        storageError ||
        document.nextRetryAt > now()
      )
        return false;
      syncing = true;
      loading = !document.server;
      publish();
      let success = false;
      do {
        syncAgain = false;
        try {
          const remote = await repository.load(householdId);
          if (!active || epoch !== started) return false;
          if (
            !(await transaction((next) => {
              next.server = mergeServer(next.server, remote);
              refreshConflicts(next);
              if (next.access === 'revoked') next.access = 'active';
              next.lastSyncedAt = now();
              next.nextRetryAt = 0;
              next.readAttempts = 0;
            }))
          )
            return false;
          success = await flush(started);
          if (
            !document.queue.length &&
            document.access === 'active' &&
            !storageError
          )
            error = null;
        } catch (cause) {
          if (active && epoch === started) await recordFailure(cause);
          return false;
        }
      } while (
        active &&
        epoch === started &&
        online &&
        syncAgain &&
        !storageError &&
        document.access === 'active' &&
        document.nextRetryAt <= now()
      );
      return success;
    })().finally(() => {
      if (active && epoch === started) {
        syncing = false;
        loading = false;
        syncingPromise = null;
        publish();
      }
    });
    return syncingPromise;
  };

  function kick() {
    if (active && online && hydrated && !storageError) void sync();
  }
  function editable() {
    return (
      active &&
      hydrated &&
      document.access !== 'revoked' &&
      !!document.server &&
      !storageError
    );
  }
  const meta = () => ({
    id: newId(),
    queuedAt: new Date(now()).toISOString(),
    attempts: 0,
    status: 'queued' as const,
    message: null,
  });

  async function queueItem(
    item: SharedItem | null,
    changes: ItemChanges,
  ): Promise<boolean> {
    if (!editable()) return false;
    if (
      !validChanges(changes) ||
      (!item && (!changes.title || !changes.quantity || changes.deleted))
    ) {
      error = 'Enter a valid grocery name and quantity.';
      publish();
      return false;
    }
    const operation: OfflineItemOperation = {
      ...meta(),
      kind: 'item',
      itemId: item?.id ?? newId(),
      base: item ? clone(item) : null,
      baseWasQueued: false,
      rebases: 0,
      changes: clone(changes),
      request: null,
      conflict: null,
    };
    const saved = await transaction((next) => {
      operation.baseWasQueued = next.queue.some(
        (queued) =>
          queued.kind === 'item' && queued.itemId === operation.itemId,
      );
      next.queue.push(operation);
    });
    if (saved) {
      error = null;
      publish();
      kick();
    }
    return saved;
  }

  async function queueNote(resolveConflict = false): Promise<boolean> {
    if (!editable()) return false;
    if (
      resolveConflict &&
      document.queue.some(
        (operation) =>
          operation.kind === 'note' &&
          operation.status === 'queued' &&
          operation.request,
      )
    )
      return false;
    const current = visible(document, userId)!;
    const body = state.noteDraft;
    const base = resolveConflict
      ? document.server!.note
      : (document.draft?.base ?? current.note);
    const operation: OfflineNoteOperation = {
      ...meta(),
      kind: 'note',
      base: clone(base),
      body,
      request: null,
      conflict: null,
    };
    const saved = await transaction((next) => {
      if (resolveConflict)
        next.queue = next.queue.filter((queued) => queued.kind !== 'note');
      next.queue.push(operation);
      next.draft = null;
      next.nextRetryAt = 0;
    });
    if (saved) {
      error = null;
      publish();
      kick();
    }
    return saved;
  }

  const actions = {
    refresh: sync,
    addItem: (title: string, quantity: string) =>
      queueItem(null, {
        title: title.trim(),
        quantity: quantity.trim() || '1',
      }),
    updateItem: (item: SharedItem, changes: ItemChanges) =>
      queueItem(item, {
        ...changes,
        ...('title' in changes ? { title: changes.title?.trim() } : {}),
        ...('quantity' in changes
          ? { quantity: changes.quantity?.trim() }
          : {}),
      }),
    updateNoteDraft: async (body: string): Promise<boolean> => {
      if (!editable() || !text(body, 2000, true)) return false;
      const saved = await transaction((next) => {
        const current = visible(next, userId)!;
        next.draft =
          body === current.note.body
            ? null
            : { body, base: next.draft?.base ?? current.note };
      });
      return saved;
    },
    saveNote: async () => (state.noteConflict ? false : queueNote()),
    keepMyNote: () => queueNote(true),
    useServerNote: async () => {
      if (
        !editable() ||
        document.queue.some(
          (queued) =>
            queued.kind === 'note' &&
            queued.status === 'queued' &&
            queued.request,
        )
      )
        return false;
      const saved = await transaction((next) => {
        next.queue = next.queue.filter((queued) => queued.kind !== 'note');
        next.draft = null;
        next.nextRetryAt = 0;
      });
      if (saved) {
        error = null;
        publish();
        kick();
      }
      return saved;
    },
    dismissItemConflict: async () => {
      if (!active || !hydrated) return false;
      const head = document.queue[0];
      if (!head || head.kind !== 'item' || head.status === 'queued')
        return false;
      const saved = await transaction((next) => {
        if (next.queue[0]?.id === head.id) next.queue.shift();
        next.nextRetryAt = 0;
      });
      if (saved) {
        error = null;
        publish();
        kick();
      }
      return saved;
    },
    discardFailed: async (id?: string) => {
      if (!active || !hydrated) return false;
      const saved = await transaction((next) => {
        next.queue = next.queue.filter(
          (operation) =>
            operation.status === 'queued' ||
            (id !== undefined && operation.id !== id),
        );
        next.nextRetryAt = 0;
      });
      if (saved) {
        error = null;
        publish();
        kick();
      }
      return saved;
    },
    retry: async () => {
      if (!(await hydrate())) return false;
      const saved = await transaction((next) => {
        next.nextRetryAt = 0;
        if (next.access === 'reauth') next.access = 'active';
      });
      if (!saved) return false;
      return sync();
    },
    getUnsentWork: () => ({
      householdId,
      noteDraft: document.draft?.body ?? null,
      edits: document.queue.map((operation) =>
        operation.kind === 'note'
          ? {
              id: operation.id,
              kind: operation.kind,
              body: operation.body,
              message: operation.message,
            }
          : {
              id: operation.id,
              kind: operation.kind,
              itemId: operation.itemId,
              changes: operation.changes,
              message: operation.message,
            },
      ),
    }),
  };

  async function confirmAuth() {
    authReady = true;
    if (!(await hydrate())) return false;
    if (
      document.access === 'reauth' &&
      !(await transaction((next) => {
        next.access = 'active';
        next.nextRetryAt = 0;
      }))
    )
      return false;
    return sync();
  }

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hydrate,
    sync,
    setOnline: (value: boolean) => {
      online = value;
      publish();
      if (value) kick();
    },
    setConnection: (value: OfflineState['connection']) => {
      connection = value;
      publish();
    },
    authConfirmed: confirmAuth,
    setAuthReady: (value: boolean) => {
      authReady = value;
      publish();
      return value ? confirmAuth() : Promise.resolve(false);
    },
    activate: () => {
      if (!active) {
        active = true;
        epoch++;
        hydrated = false;
        cache = null;
        hydrating = null;
        syncingPromise = null;
        syncing = false;
      }
      publish();
    },
    dispose: () => {
      active = false;
      epoch++;
      cache?.close();
      cache = null;
      listeners.clear();
    },
    actions,
  };
}

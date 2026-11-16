import { identityError } from '../identity/validation.ts';
import { rebaseItemChange, type createSharedRepository } from './repository.ts';
import type {
  ItemChanges,
  ItemMutationRequest,
  NoteMutationRequest,
  SharedItem,
  SharedNote,
  SharedSnapshot,
} from './types.ts';

export type SharedState = {
  snapshot: SharedSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  connection: 'connecting' | 'live' | 'reconnecting' | 'error';
  pending: boolean;
  noteDraft: string;
  noteConflict: SharedNote | null;
  itemConflict: SharedItem | null;
};

type PendingOperation =
  | {
      kind: 'item';
      request: ItemMutationRequest;
      base: SharedItem | null;
      rebased: boolean;
    }
  | { kind: 'note'; request: NoteMutationRequest };

type Options = {
  householdId: string;
  repository: ReturnType<typeof createSharedRepository>;
  newId: () => string;
};

// This store is scoped to one authenticated user/household by its parent.
// Pending requests are memory-only until the durable outbox milestone.
export function createSharedStore({ householdId, repository, newId }: Options) {
  let state: SharedState = {
    snapshot: null,
    loading: true,
    busy: false,
    error: null,
    connection: 'connecting',
    pending: false,
    noteDraft: '',
    noteConflict: null,
    itemConflict: null,
  };
  let active = true;
  let operation: PendingOperation | null = null;
  let draftBase: SharedNote | null = null;
  let refreshPromise: Promise<boolean> | null = null;
  let refreshAgain = false;
  const listeners = new Set<() => void>();

  function publish(patch: Partial<SharedState>) {
    if (!active) return;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }

  function adopt(incoming: SharedSnapshot) {
    const previous = state.snapshot;
    const items = new Map(previous?.items.map((item) => [item.id, item]) ?? []);
    for (const item of incoming.items) {
      if ((items.get(item.id)?.revision ?? 0) <= item.revision)
        items.set(item.id, item);
    }
    const note =
      previous && previous.note.revision > incoming.note.revision
        ? previous.note
        : incoming.note;
    const dirty = draftBase !== null;
    const noteConflict =
      draftBase &&
      draftBase.revision < note.revision &&
      state.noteDraft !== note.body
        ? note
        : null;
    publish({
      snapshot: { items: [...items.values()], note },
      ...(!dirty ? { noteDraft: note.body } : {}),
      noteConflict,
    });
  }

  function adoptItem(item: SharedItem) {
    if (state.snapshot) adopt({ ...state.snapshot, items: [item] });
  }

  function accessDenied(cause: unknown) {
    const code = (cause as { code?: string } | null)?.code;
    return code === '42501' || code === 'PGRST301' || code === 'PGRST303';
  }

  function failure(cause: unknown, writing = false) {
    if (accessDenied(cause)) {
      operation = null;
      publish({
        snapshot: null,
        noteDraft: '',
        noteConflict: null,
        itemConflict: null,
        pending: false,
        error:
          'Your household access changed. Return to your account and refresh.',
        loading: false,
      });
      draftBase = null;
      return;
    }
    const code = (cause as { code?: string } | null)?.code;
    // A SQL business rejection is definitive; a lost response is not. Unknown
    // failures retain the exact operation UUID/payload for a safe explicit retry.
    if (writing && code && !code.startsWith('PGRST')) operation = null;
    publish({
      error:
        writing && operation
          ? 'Couldn’t confirm this change. Keep this screen open and retry; the same request will not be applied twice.'
          : identityError(cause),
      pending: Boolean(operation),
    });
  }

  const refresh = (): Promise<boolean> => {
    if (!active) return Promise.resolve(false);
    if (refreshPromise) {
      refreshAgain = true;
      return refreshPromise;
    }
    refreshPromise = (async () => {
      let success = false;
      do {
        refreshAgain = false;
        publish({ loading: true });
        try {
          const snapshot = await repository.load(householdId);
          if (!active) return false;
          adopt(snapshot);
          if (!operation) publish({ error: null });
          success = true;
        } catch (cause) {
          if (active) failure(cause);
          success = false;
        }
      } while (active && refreshAgain);
      publish({ loading: false });
      return success;
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  };

  async function execute(): Promise<boolean> {
    if (!active || state.busy || !operation) return false;
    publish({ busy: true, pending: true, error: null });
    try {
      const submitted = operation;
      if (submitted.kind === 'item') {
        const result = await repository.mutate(submitted.request);
        if (!active || operation !== submitted) return false;
        if (result.item) adoptItem(result.item);
        if (result.status === 'conflict') {
          const patch =
            submitted.base && result.item && !submitted.rebased
              ? rebaseItemChange(
                  submitted.base,
                  result.item,
                  submitted.request.changes,
                )
              : null;
          if (patch && Object.keys(patch).length === 0) {
            operation = null;
            publish({ pending: false, error: null });
            return true;
          }
          if (patch && result.item) {
            operation = {
              kind: 'item',
              base: result.item,
              rebased: true,
              request: {
                ...submitted.request,
                operationId: newId(),
                baseRevision: result.item.revision,
                changes: patch,
              },
            };
            publish({ busy: false });
            return await execute();
          }
          operation = null;
          publish({
            pending: false,
            itemConflict: result.item,
            error: result.item?.deleted_at
              ? 'This grocery was removed by a housemate. Your edit was not applied.'
              : 'This grocery changed while you were editing. Review the latest version and edit again.',
          });
          return false;
        }
      } else {
        const result = await repository.saveNote(submitted.request);
        if (!active || operation !== submitted) return false;
        if (state.snapshot) adopt({ ...state.snapshot, note: result.note });
        if (result.status === 'conflict') {
          operation = null;
          publish({
            pending: false,
            noteConflict: state.snapshot?.note ?? result.note,
            error:
              'A housemate changed the note. Both versions are preserved; choose how to continue.',
          });
          return false;
        }
        const latest = state.snapshot?.note ?? result.note;
        if (
          latest.revision > result.note.revision &&
          state.noteDraft !== latest.body
        ) {
          draftBase = result.note;
          publish({ noteConflict: latest });
        } else if (state.noteDraft === submitted.request.body) {
          draftBase = null;
          publish({ noteDraft: latest.body, noteConflict: null });
        } else {
          draftBase = result.note;
        }
      }
      operation = null;
      publish({ pending: false, error: null });
      return true;
    } catch (cause) {
      if (active) failure(cause, true);
      return false;
    } finally {
      publish({ busy: false });
    }
  }

  function available() {
    return active && !state.busy && !operation && state.snapshot !== null;
  }

  async function saveNoteAt(baseRevision: number) {
    if (!available()) return false;
    operation = {
      kind: 'note',
      request: {
        operationId: newId(),
        householdId,
        baseRevision,
        body: state.noteDraft,
      },
    };
    return execute();
  }

  const actions = {
    refresh,
    addItem: async (title: string, quantity: string) => {
      if (!available()) return false;
      if (
        !title.trim() ||
        Array.from(title.trim()).length > 120 ||
        Array.from(quantity.trim()).length > 40
      ) {
        publish({
          error:
            'Enter an item name up to 120 characters and a quantity up to 40 characters.',
        });
        return false;
      }
      operation = {
        kind: 'item',
        base: null,
        rebased: false,
        request: {
          operationId: newId(),
          householdId,
          itemId: newId(),
          baseRevision: 0,
          changes: { title: title.trim(), quantity: quantity.trim() || '1' },
        },
      };
      return execute();
    },
    updateItem: async (item: SharedItem, changes: ItemChanges) => {
      if (!available()) return false;
      operation = {
        kind: 'item',
        base: item,
        rebased: false,
        request: {
          operationId: newId(),
          householdId,
          itemId: item.id,
          baseRevision: item.revision,
          changes: { ...changes },
        },
      };
      return execute();
    },
    updateNoteDraft: (body: string) => {
      if (!active || !state.snapshot) return;
      if (!draftBase && body !== state.snapshot.note.body)
        draftBase = state.snapshot.note;
      if (body === state.snapshot.note.body) draftBase = null;
      publish({
        noteDraft: body.slice(0, 2000),
        ...(draftBase === null ? { noteConflict: null } : {}),
      });
    },
    saveNote: async () => {
      if (!state.snapshot || state.noteConflict) return false;
      return saveNoteAt((draftBase ?? state.snapshot.note).revision);
    },
    keepMyNote: async () =>
      state.noteConflict ? saveNoteAt(state.noteConflict.revision) : false,
    useServerNote: () => {
      if (!state.snapshot || state.busy || operation) return;
      draftBase = null;
      publish({
        noteDraft: state.snapshot.note.body,
        noteConflict: null,
        error: null,
      });
    },
    retry: async () => (operation ? execute() : refresh()),
    dismissItemConflict: () => publish({ itemConflict: null, error: null }),
  };

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setConnection: (connection: SharedState['connection']) =>
      publish({ connection }),
    activate: () => {
      active = true;
    },
    dispose: () => {
      active = false;
      operation = null;
      listeners.clear();
    },
    actions,
  };
}

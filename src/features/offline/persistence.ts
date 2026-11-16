export type CacheScope = {
  backend: string;
  userId: string;
  householdId: string;
};

export type ScopeCache<T> = {
  load(): Promise<T | null>;
  save(value: T): Promise<void>;
  clear(): Promise<void>;
  close(): void;
};

export type OfflinePersistence = {
  open<T>(scope: CacheScope): ScopeCache<T>;
  clearUser(backend: string, userId: string): Promise<void>;
};

export type DocumentBackend = {
  read(scopeKey: string): Promise<string | null>;
  write(scope: CacheScope, scopeKey: string, payload: string): Promise<void>;
  remove(scopeKey: string): Promise<void>;
  removeUser(backend: string, userId: string): Promise<void>;
};

export class CacheClosedError extends Error {
  readonly code = 'CACHE_CLOSED';

  constructor() {
    super('This offline storage session has ended.');
    this.name = 'CacheClosedError';
  }
}

export class CacheCorruptionError extends Error {
  readonly code = 'CACHE_CORRUPT';

  constructor() {
    super('Saved offline data could not be read. It has not been changed.');
    this.name = 'CacheCorruptionError';
  }
}

function checkedScope(scope: CacheScope): CacheScope {
  if (
    !scope ||
    typeof scope.backend !== 'string' ||
    !scope.backend.trim() ||
    typeof scope.userId !== 'string' ||
    !scope.userId.trim() ||
    typeof scope.householdId !== 'string' ||
    !scope.householdId.trim()
  ) {
    throw new Error(
      'Offline storage requires a backend, account, and household.',
    );
  }
  // The lease must not change scope if its caller later mutates the input object.
  return Object.freeze({ ...scope });
}

export function cacheScopeKey(scope: CacheScope): string {
  return JSON.stringify([scope.backend, scope.userId, scope.householdId]);
}

// A document contains the cache, optimistic view, draft, and outbox together.
// Each backend writes it atomically; no edit can persist without its operation.
export function createDocumentPersistence(
  backend: DocumentBackend,
): OfflinePersistence {
  let queue: Promise<unknown> = Promise.resolve();
  const leases = new Set<{ scope: CacheScope; active: boolean }>();

  function ordered<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.catch(() => undefined).then(operation);
    queue = result;
    return result;
  }

  return {
    open<T>(input: CacheScope): ScopeCache<T> {
      const scope = checkedScope(input);
      const key = cacheScopeKey(scope);
      const lease = { scope, active: true };
      leases.add(lease);
      const assertActive = () => {
        if (!lease.active) throw new CacheClosedError();
      };

      return {
        load: () =>
          ordered(async () => {
            assertActive();
            const payload = await backend.read(key);
            assertActive();
            if (payload === null) return null;
            if (typeof payload !== 'string') throw new CacheCorruptionError();
            try {
              return JSON.parse(payload) as T;
            } catch {
              throw new CacheCorruptionError();
            }
          }),
        save: (value) => {
          // Capture the intended state when save is called, rather than a later
          // mutation of the same JavaScript object while another write is pending.
          let payload: string;
          try {
            assertActive();
            const encoded = JSON.stringify(value);
            if (encoded === undefined) throw new Error();
            payload = encoded;
          } catch (error) {
            return Promise.reject(
              error instanceof CacheClosedError
                ? error
                : new Error(
                    'The offline change could not be prepared for storage.',
                  ),
            );
          }
          return ordered(async () => {
            assertActive();
            await backend.write(scope, key, payload);
            assertActive();
          });
        },
        clear: () =>
          ordered(async () => {
            assertActive();
            await backend.remove(key);
            assertActive();
          }),
        close: () => {
          lease.active = false;
          leases.delete(lease);
        },
      };
    },
    clearUser: (backendId, userId) => {
      // Invalidate first, before any await. Old queued writes and late network
      // responses cannot recreate this account's data after the ordered purge.
      for (const lease of leases) {
        if (
          lease.scope.backend === backendId &&
          lease.scope.userId === userId
        ) {
          lease.active = false;
          leases.delete(lease);
        }
      }
      return ordered(() => backend.removeUser(backendId, userId));
    },
  };
}

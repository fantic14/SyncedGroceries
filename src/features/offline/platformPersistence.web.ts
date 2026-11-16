import {
  CacheCorruptionError,
  createDocumentPersistence,
  type OfflinePersistence,
} from './persistence';

type StoredDocument = {
  scope_key: string;
  backend: string;
  user_id: string;
  household_id: string;
  payload: string;
};

let initializing: Promise<OfflinePersistence> | undefined;

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('This browser does not provide durable offline storage.');
  }
  return new Promise((resolve, reject) => {
    let failed = false;
    const request = indexedDB.open('synced-groceries-offline-v1', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('documents', {
        keyPath: 'scope_key',
      });
      store.createIndex('by_user', ['backend', 'user_id'], { unique: false });
    };
    request.onerror = () => {
      failed = true;
      reject(request.error ?? new Error('Couldn’t open offline storage.'));
    };
    request.onblocked = () => {
      failed = true;
      reject(
        new Error('Close other app tabs, then retry opening offline storage.'),
      );
    };
    request.onsuccess = () => {
      if (failed) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

export function getOfflinePersistence(): Promise<OfflinePersistence> {
  if (!initializing) {
    initializing = openDatabase()
      .then((database) => {
        function transaction<T>(
          mode: IDBTransactionMode,
          perform: (
            store: IDBObjectStore,
            result: (value: T) => void,
            fail: (error: unknown) => void,
          ) => void,
        ): Promise<T> {
          return new Promise((resolve, reject) => {
            let value: T;
            let tx: IDBTransaction | undefined;
            let applicationFailure: unknown;
            try {
              tx = database.transaction('documents', mode);
              tx.oncomplete = () => resolve(value);
              tx.onerror = () =>
                reject(
                  applicationFailure ??
                    tx?.error ??
                    new Error('Offline storage failed.'),
                );
              tx.onabort = () =>
                reject(
                  applicationFailure ??
                    tx?.error ??
                    new Error('Offline storage was interrupted.'),
                );
              perform(
                tx.objectStore('documents'),
                (result) => {
                  value = result;
                },
                (error) => {
                  applicationFailure = error;
                  tx!.abort();
                },
              );
            } catch (error) {
              try {
                tx?.abort();
              } catch {
                /* The transaction already ended. */
              }
              reject(error);
            }
          });
        }

        return createDocumentPersistence({
          read: (key) =>
            transaction<string | null>('readonly', (store, result, fail) => {
              const request = store.get(key);
              request.onsuccess = () => {
                const record: unknown = request.result;
                if (record === undefined) {
                  result(null);
                  return;
                }
                if (
                  !record ||
                  typeof record !== 'object' ||
                  !('payload' in record) ||
                  typeof record.payload !== 'string'
                ) {
                  // Throwing in an IndexedDB event is not a Promise rejection.
                  // Abort first; transaction handlers reject the durable read.
                  fail(new CacheCorruptionError());
                  return;
                }
                result(record.payload);
              };
            }),
          write: (scope, key, payload) =>
            transaction<void>('readwrite', (store, result) => {
              const record: StoredDocument = {
                scope_key: key,
                backend: scope.backend,
                user_id: scope.userId,
                household_id: scope.householdId,
                payload,
              };
              store.put(record);
              result(undefined);
            }),
          remove: (key) =>
            transaction<void>('readwrite', (store, result) => {
              store.delete(key);
              result(undefined);
            }),
          removeUser: (backend, userId) =>
            transaction<void>('readwrite', (store, result) => {
              const request = store
                .index('by_user')
                .openKeyCursor(IDBKeyRange.only([backend, userId]));
              request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                  result(undefined);
                  return;
                }
                store.delete(cursor.primaryKey);
                cursor.continue();
              };
            }),
        });
      })
      .catch((error) => {
        initializing = undefined;
        throw error;
      });
  }
  return initializing;
}

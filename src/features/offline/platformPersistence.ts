import { openDatabaseAsync } from 'expo-sqlite';

import type { OfflinePersistence } from './persistence';
import { createSqlitePersistence } from './sqlitePersistence';

let initializing: Promise<OfflinePersistence> | undefined;

export function getOfflinePersistence(): Promise<OfflinePersistence> {
  if (!initializing) {
    initializing = (async () => {
      const database = await openDatabaseAsync(
        'synced-groceries-offline-v1.db',
      );
      try {
        return await createSqlitePersistence({
          exec: (sql) => database.execAsync(sql),
          run: async (sql, parameters) => {
            await database.runAsync(sql, ...parameters);
          },
          get: (sql, parameters) =>
            database.getFirstAsync<{ payload: string }>(sql, ...parameters),
        });
      } catch (error) {
        await database.closeAsync().catch(() => undefined);
        throw error;
      }
    })().catch((error) => {
      // Initialization failures remain visible, and a later explicit retry can
      // reopen the database. There is no in-memory fallback.
      initializing = undefined;
      throw error;
    });
  }
  return initializing;
}

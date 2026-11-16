import {
  createDocumentPersistence,
  type OfflinePersistence,
} from './persistence.ts';

export type SqliteParameter = string | number | null;

export type SqliteDriver = {
  exec(sql: string): Promise<void>;
  run(sql: string, parameters: readonly SqliteParameter[]): Promise<void>;
  get(
    sql: string,
    parameters: readonly SqliteParameter[],
  ): Promise<{ payload: string } | null>;
};

export async function createSqlitePersistence(
  database: SqliteDriver,
): Promise<OfflinePersistence> {
  await database.exec(`
    pragma journal_mode = WAL;
    pragma synchronous = FULL;
    pragma foreign_keys = ON;
    pragma busy_timeout = 5000;
    create table if not exists offline_documents_v1 (
      scope_key text primary key not null,
      backend text not null,
      user_id text not null,
      household_id text not null,
      payload text not null
    );
    create index if not exists offline_documents_user_v1
      on offline_documents_v1(backend, user_id);
  `);

  return createDocumentPersistence({
    read: async (key) =>
      (
        await database.get(
          'select payload from offline_documents_v1 where scope_key = ?',
          [key],
        )
      )?.payload ?? null,
    write: (scope, key, payload) =>
      database.run(
        `insert into offline_documents_v1
          (scope_key, backend, user_id, household_id, payload)
          values (?, ?, ?, ?, ?)
          on conflict(scope_key) do update set payload = excluded.payload`,
        [key, scope.backend, scope.userId, scope.householdId, payload],
      ),
    remove: (key) =>
      database.run('delete from offline_documents_v1 where scope_key = ?', [
        key,
      ]),
    removeUser: (backend, userId) =>
      database.run(
        'delete from offline_documents_v1 where backend = ? and user_id = ?',
        [backend, userId],
      ),
  });
}

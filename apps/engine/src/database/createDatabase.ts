import { DatabaseSync } from 'node:sqlite';

import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';

export type AetherDatabase = {
  client: DatabaseSync;
  query: NodeSQLiteDatabase;
  close: () => void;
};

export const createDatabase = (path: string): AetherDatabase => {
  const client = new DatabaseSync(path, {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });

  client.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `);
  client.enableDefensive(true);

  return {
    client,
    query: drizzle({ client }),
    close: () => {
      client.close();
    },
  };
};

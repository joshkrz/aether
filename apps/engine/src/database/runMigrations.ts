import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { DatabaseMigration } from './migrations.ts';

type AppliedMigration = {
  migrationId: string;
  checksum: string;
};

const createChecksum = (sql: string): string =>
  createHash('sha256').update(sql, 'utf8').digest('hex');

const createMigrationTable = (client: DatabaseSync): void => {
  client.exec(`
    CREATE TABLE IF NOT EXISTS aether_migrations (
      migration_id TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
  `);
};

const assertUniqueMigrationIds = (migrations: readonly DatabaseMigration[]): void => {
  const migrationIds = new Set<string>();

  for (const migration of migrations) {
    if (migrationIds.has(migration.id)) {
      throw new Error(`Duplicate database migration ID: ${migration.id}`);
    }

    migrationIds.add(migration.id);
  }
};

export const runMigrations = (
  client: DatabaseSync,
  migrations: readonly DatabaseMigration[],
): void => {
  assertUniqueMigrationIds(migrations);
  createMigrationTable(client);

  const appliedMigrations = client
    .prepare(
      `
      SELECT migration_id AS migrationId, checksum
      FROM aether_migrations
      ORDER BY migration_id
    `,
    )
    .all() as AppliedMigration[];
  const migrationById = new Map(migrations.map((migration) => [migration.id, migration]));

  for (const appliedMigration of appliedMigrations) {
    const migration = migrationById.get(appliedMigration.migrationId);

    if (migration === undefined) {
      throw new Error(`Database contains unknown migration: ${appliedMigration.migrationId}`);
    }

    if (createChecksum(migration.sql) !== appliedMigration.checksum) {
      throw new Error(`Database migration checksum mismatch: ${migration.id}`);
    }
  }

  const appliedMigrationIds = new Set(appliedMigrations.map(({ migrationId }) => migrationId));
  const insertMigration = client.prepare(`
    INSERT INTO aether_migrations (migration_id, checksum)
    VALUES (?, ?)
  `);

  for (const migration of migrations) {
    if (appliedMigrationIds.has(migration.id)) {
      continue;
    }

    client.exec('BEGIN IMMEDIATE');

    try {
      client.exec(migration.sql);
      insertMigration.run(migration.id, createChecksum(migration.sql));
      client.exec('COMMIT');
    } catch (error) {
      if (client.isTransaction) {
        client.exec('ROLLBACK');
      }

      throw error;
    }
  }
};

import { describe, expect, it } from 'vitest';

import { createDatabase } from './createDatabase.ts';
import { databaseMigrations, type DatabaseMigration } from './migrations.ts';
import { runMigrations } from './runMigrations.ts';

type CountResult = {
  count: number;
};

const migrationCount = (client: ReturnType<typeof createDatabase>['client']): number =>
  (
    client.prepare('SELECT count(*) AS count FROM aether_migrations').get() as
      CountResult | undefined
  )?.count ?? 0;

describe('runMigrations', () => {
  it('applies every known migration once', () => {
    const database = createDatabase(':memory:');

    runMigrations(database.client, databaseMigrations);
    runMigrations(database.client, databaseMigrations);

    expect(migrationCount(database.client)).toBe(databaseMigrations.length);
    expect(
      database.client
        .prepare(
          `
            SELECT name
            FROM sqlite_schema
            WHERE type = 'table'
              AND name IN (
                'installation',
                'home_assistant_connection',
                'home_assistant_user',
                'home_assistant_oauth_credential',
                'authentication_session',
                'oauth_transaction',
                'installation_energy_source',
                'installation_plant',
                'installation_zone',
                'installation_room',
                'installation_climate_controller',
                'installation_schedule',
                'installation_schedule_block',
                'installation_schedule_selection'
              )
            ORDER BY name
          `,
        )
        .all(),
    ).toEqual([
      { name: 'authentication_session' },
      { name: 'home_assistant_connection' },
      { name: 'home_assistant_oauth_credential' },
      { name: 'home_assistant_user' },
      { name: 'installation' },
      { name: 'installation_climate_controller' },
      { name: 'installation_energy_source' },
      { name: 'installation_plant' },
      { name: 'installation_room' },
      { name: 'installation_schedule' },
      { name: 'installation_schedule_block' },
      { name: 'installation_schedule_selection' },
      { name: 'installation_zone' },
      { name: 'oauth_transaction' },
    ]);

    database.close();
  });

  it('rolls back a failed migration without recording it', () => {
    const database = createDatabase(':memory:');
    const migrations: DatabaseMigration[] = [
      {
        id: 'brokenMigration',
        sql: 'CREATE TABLE mustRollback (id INTEGER); INVALID SQL;',
      },
    ];

    expect(() => runMigrations(database.client, migrations)).toThrow();
    expect(migrationCount(database.client)).toBe(0);
    expect(
      (
        database.client
          .prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name = 'mustRollback'")
          .get() as CountResult | undefined
      )?.count,
    ).toBe(0);

    database.close();
  });

  it('rejects an edited migration that has already been applied', () => {
    const database = createDatabase(':memory:');
    const originalMigration: DatabaseMigration = {
      id: 'exampleMigration',
      sql: 'CREATE TABLE example (id INTEGER);',
    };

    runMigrations(database.client, [originalMigration]);

    expect(() =>
      runMigrations(database.client, [
        {
          ...originalMigration,
          sql: 'CREATE TABLE example (id INTEGER, name TEXT);',
        },
      ]),
    ).toThrow('Database migration checksum mismatch: exampleMigration');

    database.close();
  });

  it('rejects a database migrated by a newer unknown migration set', () => {
    const database = createDatabase(':memory:');

    runMigrations(database.client, [
      {
        id: 'futureMigration',
        sql: 'CREATE TABLE futureTable (id INTEGER);',
      },
    ]);

    expect(() => runMigrations(database.client, [])).toThrow(
      'Database contains unknown migration: futureMigration',
    );

    database.close();
  });
});

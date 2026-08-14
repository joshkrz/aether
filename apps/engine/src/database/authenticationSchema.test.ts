import { describe, expect, it } from 'vitest';

import { getTableName } from 'drizzle-orm';

import { createDatabase } from './createDatabase.ts';
import { databaseMigrations } from './migrations.ts';
import { runMigrations } from './runMigrations.ts';
import {
  authenticationSessionTable,
  homeAssistantConnectionTable,
  homeAssistantOauthCredentialTable,
  homeAssistantUserTable,
  oauthTransactionTable,
} from './schema.ts';

const tokenHash = 'a'.repeat(64);
const csrfTokenHash = 'b'.repeat(64);
const stateHash = 'c'.repeat(64);
const browserBindingHash = 'd'.repeat(64);

const seedConnectionAndUser = (database: ReturnType<typeof createDatabase>): void => {
  database.client.exec(`
    INSERT INTO home_assistant_connection (
      singleton_key,
      origin,
      created_at_epoch_seconds,
      updated_at_epoch_seconds
    ) VALUES (1, 'http://homeassistant.local:8123', 1000, 1000);

    INSERT INTO home_assistant_user (
      id,
      connection_singleton_key,
      display_name,
      is_admin,
      is_owner,
      is_active,
      verified_at_epoch_seconds
    ) VALUES ('ha-user', 1, 'Home Assistant User', 1, 1, 1, 1000);
  `);
};

const insertCredential = (
  database: ReturnType<typeof createDatabase>,
  id: string,
  purpose: 'engine' | 'user',
): void => {
  database.client
    .prepare(
      `
        INSERT INTO home_assistant_oauth_credential (
          id,
          connection_singleton_key,
          home_assistant_user_id,
          purpose,
          token_encryption_version,
          encrypted_token_bundle,
          access_token_expires_at_epoch_seconds,
          created_at_epoch_seconds,
          updated_at_epoch_seconds
        ) VALUES (?, 1, 'ha-user', ?, 1, X'0102', 2000, 1000, 1000)
      `,
    )
    .run(id, purpose);
};

describe('Home Assistant authentication database schema', () => {
  it('maps every authentication table through Drizzle', () => {
    expect(
      [
        homeAssistantConnectionTable,
        homeAssistantUserTable,
        homeAssistantOauthCredentialTable,
        authenticationSessionTable,
        oauthTransactionTable,
      ].map((table) => getTableName(table)),
    ).toEqual([
      'home_assistant_connection',
      'home_assistant_user',
      'home_assistant_oauth_credential',
      'authentication_session',
      'oauth_transaction',
    ]);
  });

  it('enforces one valid Home Assistant connection and valid user roles', () => {
    const database = createDatabase(':memory:');
    runMigrations(database.client, databaseMigrations);
    seedConnectionAndUser(database);

    expect(() =>
      database.client.exec(`
        INSERT INTO home_assistant_connection (
          singleton_key,
          origin,
          created_at_epoch_seconds,
          updated_at_epoch_seconds
        ) VALUES (2, 'http://another-home-assistant.local:8123', 1000, 1000);
      `),
    ).toThrow();
    expect(() =>
      database.client.exec(`
        INSERT INTO home_assistant_user (
          id,
          connection_singleton_key,
          display_name,
          is_admin,
          is_owner,
          is_active,
          verified_at_epoch_seconds
        ) VALUES ('invalid-owner', 1, 'Invalid Owner', 0, 1, 1, 1000);
      `),
    ).toThrow();

    database.close();
  });

  it('keeps active engine and user OAuth grants separate and replaceable', () => {
    const database = createDatabase(':memory:');
    runMigrations(database.client, databaseMigrations);
    seedConnectionAndUser(database);

    insertCredential(database, 'engine-1', 'engine');
    insertCredential(database, 'user-1', 'user');

    expect(() => insertCredential(database, 'engine-2', 'engine')).toThrow();
    expect(() => insertCredential(database, 'user-2', 'user')).toThrow();

    database.client
      .prepare(
        `
          UPDATE home_assistant_oauth_credential
          SET revoked_at_epoch_seconds = 1100,
              updated_at_epoch_seconds = 1100
          WHERE id = 'engine-1'
        `,
      )
      .run();
    insertCredential(database, 'engine-2', 'engine');

    expect(
      database.client
        .prepare(
          `
            SELECT id, purpose
            FROM home_assistant_oauth_credential
            WHERE revoked_at_epoch_seconds IS NULL
            ORDER BY purpose
          `,
        )
        .all(),
    ).toEqual([
      { id: 'engine-2', purpose: 'engine' },
      { id: 'user-1', purpose: 'user' },
    ]);

    database.close();
  });

  it('supports a bootstrap session without coupling it to an OAuth credential', () => {
    const database = createDatabase(':memory:');
    runMigrations(database.client, databaseMigrations);
    seedConnectionAndUser(database);
    insertCredential(database, 'engine-1', 'engine');

    database.client
      .prepare(
        `
          INSERT INTO authentication_session (
            token_hash,
            csrf_token_hash,
            home_assistant_user_id,
            oauth_credential_id,
            created_at_epoch_seconds,
            last_used_at_epoch_seconds,
            expires_at_epoch_seconds
          ) VALUES (?, ?, 'ha-user', NULL, 1000, 1000, 2000)
        `,
      )
      .run(tokenHash, csrfTokenHash);

    expect(
      database.client
        .prepare(
          `
            SELECT home_assistant_user_id, oauth_credential_id
            FROM authentication_session
            WHERE token_hash = ?
          `,
        )
        .get(tokenHash),
    ).toEqual({
      home_assistant_user_id: 'ha-user',
      oauth_credential_id: null,
    });

    database.close();
  });

  it('constrains OAuth transactions and removes auth data with its HA connection', () => {
    const database = createDatabase(':memory:');
    runMigrations(database.client, databaseMigrations);
    seedConnectionAndUser(database);

    database.client
      .prepare(
        `
          INSERT INTO oauth_transaction (
            state_hash,
            browser_binding_hash,
            connection_singleton_key,
            purpose,
            return_path,
            created_at_epoch_seconds,
            expires_at_epoch_seconds
          ) VALUES (?, ?, 1, 'engine_setup', '/setup', 1000, 1100)
        `,
      )
      .run(stateHash, browserBindingHash);

    expect(() =>
      database.client
        .prepare(
          `
            INSERT INTO oauth_transaction (
              state_hash,
              browser_binding_hash,
              connection_singleton_key,
              purpose,
              return_path,
              created_at_epoch_seconds,
              expires_at_epoch_seconds
            ) VALUES (?, ?, 1, 'user_login', '//other-host', 1000, 1100)
          `,
        )
        .run('e'.repeat(64), 'f'.repeat(64)),
    ).toThrow();

    database.client.prepare('DELETE FROM home_assistant_connection WHERE singleton_key = 1').run();

    expect(
      database.client.prepare('SELECT count(*) AS count FROM home_assistant_user').get(),
    ).toEqual({ count: 0 });
    expect(
      database.client.prepare('SELECT count(*) AS count FROM oauth_transaction').get(),
    ).toEqual({ count: 0 });

    database.close();
  });
});

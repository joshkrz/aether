import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../database/createDatabase.ts';
import { databaseMigrations } from '../database/migrations.ts';
import { runMigrations } from '../database/runMigrations.ts';
import {
  createAuthRepository,
  type AuthRepository,
  type CompleteAuthorizationInput,
  type VerifiedHomeAssistantUser,
} from './authRepository.ts';
import { hashAuthSecret } from './tokenEncryption.ts';

const authKey = Buffer.alloc(32, 7);
const homeAssistantOrigin = 'http://homeassistant.local:8123';
const temporaryDirectories: string[] = [];

const adminUser: VerifiedHomeAssistantUser = {
  displayName: 'Aether Administrator',
  id: 'ha-admin',
  isActive: true,
  isAdmin: true,
  isOwner: true,
};

const regularUser: VerifiedHomeAssistantUser = {
  displayName: 'Dashboard User',
  id: 'ha-user',
  isActive: true,
  isAdmin: false,
  isOwner: false,
};

const secret = (label: string): string => `${label}-`.padEnd(43, 'x');

const authorizationInput = ({
  credentialId,
  label,
  nowEpochSeconds,
  user,
}: {
  credentialId: string;
  label: string;
  nowEpochSeconds: number;
  user: VerifiedHomeAssistantUser;
}): CompleteAuthorizationInput => ({
  credential: {
    accessTokenExpiresAtEpochSeconds: nowEpochSeconds + 1_800,
    id: credentialId,
    tokenBundle: {
      accessToken: `${label}-access-token`,
      refreshToken: `${label}-refresh-token`,
      tokenType: 'Bearer',
    },
  },
  nowEpochSeconds,
  session: {
    csrfToken: secret(`${label}-csrf`),
    expiresAtEpochSeconds: nowEpochSeconds + 3_600,
    token: secret(`${label}-session`),
  },
  user,
});

const createMigratedDatabase = (path = ':memory:') => {
  const database = createDatabase(path);
  runMigrations(database.client, databaseMigrations);
  return database;
};

const beginEngineSetup = (repository: AuthRepository, nowEpochSeconds = 1_000) => {
  const stateSecret = secret(`engine-state-${nowEpochSeconds}`);
  const browserBindingSecret = secret(`engine-browser-${nowEpochSeconds}`);
  const transaction = repository.beginOAuthTransaction({
    browserBindingSecret,
    createdAtEpochSeconds: nowEpochSeconds,
    expiresAtEpochSeconds: nowEpochSeconds + 300,
    homeAssistantOrigin: `${homeAssistantOrigin}/`,
    purpose: 'engine_setup',
    returnPath: '/setup',
    stateSecret,
  });

  return { browserBindingSecret, stateSecret, transaction };
};

const connectEngine = (repository: AuthRepository, nowEpochSeconds = 1_000) => {
  const oauth = beginEngineSetup(repository, nowEpochSeconds);
  expect(
    repository.consumeOAuthTransaction(
      oauth.stateSecret,
      oauth.browserBindingSecret,
      nowEpochSeconds + 1,
    ),
  ).toEqual(oauth.transaction);
  const input = authorizationInput({
    credentialId: 'engine-credential',
    label: 'engine',
    nowEpochSeconds: nowEpochSeconds + 2,
    user: adminUser,
  });
  const session = repository.completeEngineAuthorization(input);

  return { input, session };
};

const createTemporaryDatabasePath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'aether-auth-repository-'));
  temporaryDirectories.push(directory);
  return join(directory, 'aether.sqlite');
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('createAuthRepository', () => {
  it('hashes, binds, expires, and consumes OAuth transactions exactly once', () => {
    const database = createMigratedDatabase();
    const repository = createAuthRepository(database, authKey);
    const oauth = beginEngineSetup(repository);

    expect(oauth.transaction).toEqual({
      createdAtEpochSeconds: 1_000,
      expiresAtEpochSeconds: 1_300,
      homeAssistantOrigin,
      purpose: 'engine_setup',
      returnPath: '/setup',
    });
    expect(
      database.client
        .prepare('SELECT state_hash, browser_binding_hash FROM oauth_transaction WHERE purpose = ?')
        .get('engine_setup'),
    ).toEqual({
      browser_binding_hash: hashAuthSecret(oauth.browserBindingSecret),
      state_hash: hashAuthSecret(oauth.stateSecret),
    });
    expect(
      repository.consumeOAuthTransaction(oauth.stateSecret, secret('wrong-browser'), 1_001),
    ).toBeUndefined();
    expect(
      repository.consumeOAuthTransaction(oauth.stateSecret, oauth.browserBindingSecret, 1_001),
    ).toEqual(oauth.transaction);
    expect(
      repository.consumeOAuthTransaction(oauth.stateSecret, oauth.browserBindingSecret, 1_002),
    ).toBeUndefined();
    expect(repository.cleanupExpiredRecords(1_002)).toEqual({
      deletedOauthTransactions: 1,
      deletedSessions: 0,
    });

    const expired = beginEngineSetup(repository, 2_000);
    expect(
      repository.consumeOAuthTransaction(expired.stateSecret, expired.browserBindingSecret, 2_300),
    ).toBeUndefined();
    expect(repository.cleanupExpiredRecords(2_300).deletedOauthTransactions).toBe(1);

    database.close();
  });

  it('rejects unsafe initial connection and redirect inputs before writing', () => {
    const database = createMigratedDatabase();
    const repository = createAuthRepository(database, authKey);

    expect(() =>
      repository.beginOAuthTransaction({
        browserBindingSecret: secret('browser'),
        createdAtEpochSeconds: 1_000,
        expiresAtEpochSeconds: 1_300,
        homeAssistantOrigin: 'http://homeassistant.local:8123/config',
        purpose: 'engine_setup',
        returnPath: '/setup',
        stateSecret: secret('state'),
      }),
    ).toThrow('Home Assistant origin must not contain');
    expect(() =>
      repository.beginOAuthTransaction({
        browserBindingSecret: secret('browser'),
        createdAtEpochSeconds: 1_000,
        expiresAtEpochSeconds: 1_300,
        homeAssistantOrigin,
        purpose: 'engine_setup',
        returnPath: '//attacker.example',
        stateSecret: secret('state'),
      }),
    ).toThrow('OAuth return path must be a safe application-relative path');
    expect(repository.loadHomeAssistantConnection()).toBeUndefined();

    database.close();
  });

  it('rejects ordinary user authorization before the engine connection is complete', () => {
    const database = createMigratedDatabase();
    const repository = createAuthRepository(database, authKey);
    beginEngineSetup(repository);

    expect(() =>
      repository.completeUserAuthorization(
        authorizationInput({
          credentialId: 'premature-user-credential',
          label: 'premature-user',
          nowEpochSeconds: 1_100,
          user: regularUser,
        }),
      ),
    ).toThrow('Home Assistant engine must be connected before user authorization');

    database.close();
  });

  it('atomically stores an encrypted engine grant and independent bootstrap session', () => {
    const database = createMigratedDatabase();
    const repository = createAuthRepository(database, authKey);
    const { input, session } = connectEngine(repository);

    expect(session).not.toHaveProperty('oauthCredentialId');
    expect(repository.loadHomeAssistantConnection()).toEqual({
      connectedAtEpochSeconds: 1_002,
      createdAtEpochSeconds: 1_000,
      origin: homeAssistantOrigin,
      updatedAtEpochSeconds: 1_002,
    });
    expect(repository.loadActiveEngineCredential()).toMatchObject({
      homeAssistantOrigin,
      homeAssistantUserId: adminUser.id,
      id: 'engine-credential',
      purpose: 'engine',
      tokenBundle: input.credential.tokenBundle,
    });
    const storedCredential = database.client
      .prepare(
        `
          SELECT encrypted_token_bundle
          FROM home_assistant_oauth_credential
          WHERE purpose = 'engine'
        `,
      )
      .get() as { encrypted_token_bundle: Uint8Array };
    const serializedCiphertext = Buffer.from(storedCredential.encrypted_token_bundle).toString(
      'utf8',
    );
    expect(serializedCiphertext).not.toContain(input.credential.tokenBundle.accessToken);
    expect(serializedCiphertext).not.toContain(input.credential.tokenBundle.refreshToken);

    expect(repository.loadActiveSession(input.session.token, 1_003)).toEqual(session);
    expect(
      repository.verifySessionCsrf(input.session.token, input.session.csrfToken, 1_003),
    ).toEqual(session);
    expect(
      repository.verifySessionCsrf(input.session.token, secret('wrong-csrf'), 1_003),
    ).toBeUndefined();
    expect(repository.touchSession(input.session.token, 1_010)).toBe(true);
    expect(repository.loadActiveSession(input.session.token, 1_011)?.lastUsedAtEpochSeconds).toBe(
      1_010,
    );
    expect(repository.revokeSession(input.session.token, 1_020)).toEqual({ status: 'revoked' });
    expect(repository.loadActiveSession(input.session.token, 1_021)).toBeUndefined();
    expect(repository.loadActiveEngineCredential()).toBeDefined();
    expect(() => beginEngineSetup(repository, 2_000)).toThrow(
      'Home Assistant connection is already configured',
    );

    database.close();
  });

  it('shares one user grant across multiple sessions without coupling it to the engine', () => {
    const database = createMigratedDatabase();
    const repository = createAuthRepository(database, authKey);
    connectEngine(repository);
    const firstInput = authorizationInput({
      credentialId: 'user-credential',
      label: 'user-first',
      nowEpochSeconds: 1_100,
      user: regularUser,
    });
    const secondInput = authorizationInput({
      credentialId: 'ignored-replacement-id',
      label: 'user-second',
      nowEpochSeconds: 1_200,
      user: regularUser,
    });
    const firstSession = repository.completeUserAuthorization(firstInput);
    const secondSession = repository.completeUserAuthorization(secondInput);

    expect(firstSession.oauthCredentialId).toBe('user-credential');
    expect(secondSession.oauthCredentialId).toBe('user-credential');
    expect(repository.loadActiveUserCredential(regularUser.id)).toMatchObject({
      id: 'user-credential',
      tokenBundle: secondInput.credential.tokenBundle,
    });
    expect(
      database.client
        .prepare(
          `
            SELECT count(*) AS count
            FROM home_assistant_oauth_credential
            WHERE purpose = 'user' AND revoked_at_epoch_seconds IS NULL
          `,
        )
        .get(),
    ).toEqual({ count: 1 });

    expect(repository.revokeSession(firstInput.session.token, 1_300)).toEqual({
      status: 'revoked',
    });
    expect(repository.loadActiveSession(secondInput.session.token, 1_301)).toEqual(secondSession);
    expect(repository.revokeSession(secondInput.session.token, 1_302)).toEqual({
      status: 'revoked',
      userCredentialIdWithNoRemainingSessions: 'user-credential',
    });
    expect(repository.markCredentialRevoked('user-credential', 1_303)).toBe(true);
    expect(repository.loadActiveUserCredential(regularUser.id)).toBeUndefined();
    expect(repository.loadActiveEngineCredential()).toBeDefined();

    database.close();
  });

  it('stops authenticating every session backed by a revoked user grant', () => {
    const database = createMigratedDatabase();
    const repository = createAuthRepository(database, authKey);
    connectEngine(repository);
    const input = authorizationInput({
      credentialId: 'revoked-user-credential',
      label: 'revoked-user',
      nowEpochSeconds: 1_100,
      user: regularUser,
    });
    repository.completeUserAuthorization(input);

    expect(repository.loadActiveSession(input.session.token, 1_101)).toBeDefined();
    expect(repository.markCredentialRevoked('revoked-user-credential', 1_102)).toBe(true);
    expect(repository.loadActiveSession(input.session.token, 1_103)).toBeUndefined();

    database.close();
  });

  it('updates refreshed tokens without changing the credential identity', () => {
    const database = createMigratedDatabase();
    const repository = createAuthRepository(database, authKey);
    connectEngine(repository);
    const refreshedBundle = {
      accessToken: 'refreshed-access-token',
      refreshToken: 'unchanged-refresh-token',
      tokenType: 'Bearer',
    } as const;

    expect(
      repository.updateCredentialTokens('engine-credential', refreshedBundle, 4_000, 2_000),
    ).toBe(true);
    expect(repository.loadActiveEngineCredential()).toMatchObject({
      id: 'engine-credential',
      tokenBundle: refreshedBundle,
      updatedAtEpochSeconds: 2_000,
    });
    expect(repository.updateCredentialTokens('missing', refreshedBundle, 4_000, 2_000)).toBe(false);

    database.close();
  });

  it('rolls back user, credential, and connection changes when session creation fails', () => {
    const database = createMigratedDatabase();
    const repository = createAuthRepository(database, authKey);
    const original = connectEngine(repository);
    const failingInput = authorizationInput({
      credentialId: 'unused-engine-id',
      label: 'replacement-engine',
      nowEpochSeconds: 1_100,
      user: { ...adminUser, displayName: 'Name That Must Roll Back' },
    });
    failingInput.session.token = original.input.session.token;

    expect(() => repository.completeEngineAuthorization(failingInput)).toThrow();
    expect(repository.loadActiveEngineCredential()).toMatchObject({
      tokenBundle: original.input.credential.tokenBundle,
      updatedAtEpochSeconds: 1_002,
    });
    expect(repository.loadActiveSession(original.input.session.token, 1_101)?.displayName).toBe(
      adminUser.displayName,
    );
    expect(repository.loadHomeAssistantConnection()?.updatedAtEpochSeconds).toBe(1_002);

    database.close();
  });

  it('decrypts persisted credentials after restart and rejects the wrong key', () => {
    const path = createTemporaryDatabasePath();
    const firstDatabase = createMigratedDatabase(path);
    const firstRepository = createAuthRepository(firstDatabase, authKey);
    const { input } = connectEngine(firstRepository);
    firstDatabase.close();

    const reopenedDatabase = createMigratedDatabase(path);
    expect(
      createAuthRepository(reopenedDatabase, authKey).loadActiveEngineCredential(),
    ).toMatchObject({
      tokenBundle: input.credential.tokenBundle,
    });
    expect(() =>
      createAuthRepository(reopenedDatabase, Buffer.alloc(32, 9)).loadActiveEngineCredential(),
    ).toThrow('could not be authenticated');

    reopenedDatabase.close();
  });
});

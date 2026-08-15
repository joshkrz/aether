import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDatabase } from '../database/createDatabase.ts';
import { databaseMigrations } from '../database/migrations.ts';
import { runMigrations } from '../database/runMigrations.ts';
import {
  createAuthRepository,
  type AuthRepository,
  type CompleteAuthorizationInput,
  type VerifiedHomeAssistantUser,
} from './authRepository.ts';
import { createAuthSessionService } from './authSessionService.ts';
import type { HomeAssistantOAuthClient } from './homeAssistantOAuthClient.ts';

const authKey = Buffer.alloc(32, 7);
const homeAssistantOrigin = 'http://homeassistant.local:8123';
const idleLifetimeSeconds = 7 * 24 * 60 * 60;
const absoluteLifetimeSeconds = 30 * 24 * 60 * 60;

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
    expiresAtEpochSeconds: nowEpochSeconds + absoluteLifetimeSeconds,
    token: secret(`${label}-session`),
  },
  user,
});

const databases: Array<ReturnType<typeof createDatabase>> = [];

const createRepository = (): AuthRepository => {
  const database = createDatabase(':memory:');
  runMigrations(database.client, databaseMigrations);
  databases.push(database);
  return createAuthRepository(database, authKey);
};

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

const connectEngine = (repository: AuthRepository, nowEpochSeconds = 1_000) => {
  repository.beginOAuthTransaction({
    browserBindingSecret: secret('engine-browser'),
    createdAtEpochSeconds: nowEpochSeconds,
    expiresAtEpochSeconds: nowEpochSeconds + 600,
    homeAssistantOrigin,
    purpose: 'engine_setup',
    returnPath: '/setup',
    stateSecret: secret('engine-state'),
  });
  const input = authorizationInput({
    credentialId: 'engine-credential',
    label: 'engine',
    nowEpochSeconds: nowEpochSeconds + 1,
    user: adminUser,
  });
  const session = repository.completeEngineSetupAuthorization(input);
  return { input, session };
};

const createUserSession = (repository: AuthRepository, label: string, nowEpochSeconds: number) => {
  const input = authorizationInput({
    credentialId: 'user-credential',
    label,
    nowEpochSeconds,
    user: regularUser,
  });
  const session = repository.completeUserAuthorization(input);
  return { input, session };
};

const createFakeClient = (revokeError?: Error) => {
  const revokeRefreshToken = vi.fn(() =>
    revokeError === undefined ? Promise.resolve() : Promise.reject(revokeError),
  );
  const client: HomeAssistantOAuthClient = {
    buildAuthorizationUrl: () => {
      throw new Error('Unexpected authorization URL request');
    },
    exchangeAuthorizationCode: () => Promise.reject(new Error('Unexpected code exchange')),
    getCurrentUser: () => Promise.reject(new Error('Unexpected identity lookup')),
    refreshAccessToken: () => Promise.reject(new Error('Unexpected token refresh')),
    revokeRefreshToken,
  };
  return { client, revokeRefreshToken };
};

describe('createAuthSessionService', () => {
  it('authenticates sessions and writes activity at most once per hour', async () => {
    const repository = createRepository();
    const { input } = connectEngine(repository);
    const fakeClient = createFakeClient();
    let nowEpochSeconds = input.nowEpochSeconds + 3_599;
    const service = createAuthSessionService({
      authRepository: repository,
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: () => undefined,
    });

    await expect(service.authenticateSession(input.session.token)).resolves.toMatchObject({
      session: { lastUsedAtEpochSeconds: input.nowEpochSeconds },
      status: 'authenticated',
    });
    expect(
      repository.loadActiveSession(input.session.token, nowEpochSeconds)?.lastUsedAtEpochSeconds,
    ).toBe(input.nowEpochSeconds);

    nowEpochSeconds = input.nowEpochSeconds + 3_600;
    await expect(service.authenticateSession(input.session.token)).resolves.toMatchObject({
      session: { lastUsedAtEpochSeconds: nowEpochSeconds },
      status: 'authenticated',
    });
    expect(
      repository.loadActiveSession(input.session.token, nowEpochSeconds)?.lastUsedAtEpochSeconds,
    ).toBe(nowEpochSeconds);
    expect(fakeClient.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it('rejects and locally revokes an idle final user session', async () => {
    const repository = createRepository();
    connectEngine(repository);
    const { input } = createUserSession(repository, 'idle-user', 2_000);
    const fakeClient = createFakeClient();
    const nowEpochSeconds = input.nowEpochSeconds + idleLifetimeSeconds;
    const service = createAuthSessionService({
      authRepository: repository,
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: () => undefined,
    });

    await expect(service.authenticateSession(input.session.token)).resolves.toEqual({
      status: 'unauthenticated',
    });
    expect(repository.loadActiveSession(input.session.token, nowEpochSeconds)).toBeUndefined();
    expect(repository.loadActiveUserCredential(regularUser.id)).toBeUndefined();
    expect(fakeClient.revokeRefreshToken).toHaveBeenCalledWith(
      homeAssistantOrigin,
      input.credential.tokenBundle.refreshToken,
    );
    expect(repository.loadActiveEngineCredential()).toBeDefined();
  });

  it('rejects an absolutely expired session without starting unattended cleanup', async () => {
    const repository = createRepository();
    connectEngine(repository);
    const { input } = createUserSession(repository, 'absolute-user', 2_000);
    const fakeClient = createFakeClient();
    const nowEpochSeconds = input.session.expiresAtEpochSeconds;
    const service = createAuthSessionService({
      authRepository: repository,
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: () => undefined,
    });

    await expect(service.authenticateSession(input.session.token)).resolves.toEqual({
      status: 'unauthenticated',
    });
    expect(fakeClient.revokeRefreshToken).not.toHaveBeenCalled();
    expect(repository.loadActiveUserCredential(regularUser.id)).toBeDefined();
  });

  it('requires a matching CSRF token before authenticating or recording activity', async () => {
    const repository = createRepository();
    const { input } = connectEngine(repository);
    const fakeClient = createFakeClient();
    const nowEpochSeconds = input.nowEpochSeconds + 3_600;
    const service = createAuthSessionService({
      authRepository: repository,
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: () => undefined,
    });

    await expect(
      service.authenticateSessionWithCsrf(input.session.token, secret('incorrect-csrf')),
    ).resolves.toEqual({ status: 'unauthenticated' });
    expect(
      repository.loadActiveSession(input.session.token, nowEpochSeconds)?.lastUsedAtEpochSeconds,
    ).toBe(input.nowEpochSeconds);

    await expect(
      service.authenticateSessionWithCsrf(input.session.token, input.session.csrfToken),
    ).resolves.toMatchObject({
      session: { lastUsedAtEpochSeconds: nowEpochSeconds },
      status: 'authenticated',
    });
  });

  it('logs out the bootstrap session without revoking the engine grant', async () => {
    const repository = createRepository();
    const { input } = connectEngine(repository);
    const fakeClient = createFakeClient();
    const service = createAuthSessionService({
      authRepository: repository,
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => 2_000,
      onWarning: () => undefined,
    });

    await expect(service.logout(input.session.token, input.session.csrfToken)).resolves.toEqual({
      status: 'logged_out',
    });
    expect(repository.loadActiveSession(input.session.token, 2_001)).toBeUndefined();
    expect(repository.loadActiveEngineCredential()).toBeDefined();
    expect(fakeClient.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it('does not log out a session when CSRF verification fails', async () => {
    const repository = createRepository();
    const { input } = connectEngine(repository);
    const fakeClient = createFakeClient();
    const service = createAuthSessionService({
      authRepository: repository,
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => 2_000,
      onWarning: () => undefined,
    });

    await expect(service.logout(input.session.token, secret('incorrect-csrf'))).resolves.toEqual({
      status: 'unauthenticated',
    });
    expect(repository.loadActiveSession(input.session.token, 2_001)).toBeDefined();
  });

  it('retains a shared user grant until its final session logs out', async () => {
    const repository = createRepository();
    connectEngine(repository);
    const first = createUserSession(repository, 'first-user', 2_000);
    const second = createUserSession(repository, 'second-user', 2_100);
    const fakeClient = createFakeClient();
    let nowEpochSeconds = 2_200;
    const service = createAuthSessionService({
      authRepository: repository,
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: () => undefined,
    });

    await expect(
      service.logout(first.input.session.token, first.input.session.csrfToken),
    ).resolves.toEqual({ status: 'logged_out' });
    expect(repository.loadActiveUserCredential(regularUser.id)).toBeDefined();
    expect(fakeClient.revokeRefreshToken).not.toHaveBeenCalled();

    nowEpochSeconds = 2_201;
    await expect(
      service.logout(second.input.session.token, second.input.session.csrfToken),
    ).resolves.toEqual({ status: 'logged_out' });
    expect(repository.loadActiveUserCredential(regularUser.id)).toBeUndefined();
    expect(fakeClient.revokeRefreshToken).toHaveBeenCalledOnce();
    expect(fakeClient.revokeRefreshToken).toHaveBeenCalledWith(
      homeAssistantOrigin,
      second.input.credential.tokenBundle.refreshToken,
    );
    expect(repository.loadActiveEngineCredential()).toBeDefined();
  });

  it('keeps logout successful and emits a safe warning when remote revocation fails', async () => {
    const repository = createRepository();
    connectEngine(repository);
    const { input } = createUserSession(repository, 'warning-user', 2_000);
    const remoteError = new Error(`Failed with ${input.credential.tokenBundle.refreshToken}`);
    const fakeClient = createFakeClient(remoteError);
    const warnings: unknown[] = [];
    const service = createAuthSessionService({
      authRepository: repository,
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => 2_100,
      onWarning: (warning) => warnings.push(warning),
    });

    await expect(service.logout(input.session.token, input.session.csrfToken)).resolves.toEqual({
      status: 'logged_out',
    });
    expect(repository.loadActiveUserCredential(regularUser.id)).toBeUndefined();
    expect(warnings).toEqual([
      {
        code: 'refresh_token_revocation_failed',
        stage: 'last_session_logout',
      },
    ]);
    expect(JSON.stringify(warnings)).not.toContain(input.credential.tokenBundle.refreshToken);
    expect(JSON.stringify(warnings)).not.toContain(remoteError.message);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDatabase } from '../database/createDatabase.ts';
import { databaseMigrations } from '../database/migrations.ts';
import { runMigrations } from '../database/runMigrations.ts';
import {
  createAuthRepository,
  type AuthRepository,
  type VerifiedHomeAssistantUser,
} from './authRepository.ts';
import type { HomeAssistantOAuthClient } from './homeAssistantOAuthClient.ts';
import { createOAuthFlowService } from './oauthFlowService.ts';

const authKey = Buffer.alloc(32, 7);
const aetherOrigin = 'https://aether.example.com';
const homeAssistantOrigin = 'http://homeassistant.local:8123';
const sessionLifetimeSeconds = 30 * 24 * 60 * 60;

const adminUser = {
  displayName: 'Aether Administrator',
  id: 'ha-admin',
  isActive: true,
  isAdmin: true,
  isOwner: true,
} satisfies VerifiedHomeAssistantUser;

const regularUser = {
  displayName: 'Dashboard User',
  id: 'ha-user',
  isActive: true,
  isAdmin: false,
  isOwner: false,
} satisfies VerifiedHomeAssistantUser;

type TokenSet = Awaited<ReturnType<HomeAssistantOAuthClient['exchangeAuthorizationCode']>>;
type CurrentUser = Awaited<ReturnType<HomeAssistantOAuthClient['getCurrentUser']>>;

type FakeClientOptions = {
  currentUserErrors?: Error[];
  revokeError?: Error;
  tokenSets?: TokenSet[];
  users?: CurrentUser[];
};

const secret = (label: string): string => `${label}-`.padEnd(43, 'x');

const tokenSet = (label: string): TokenSet => ({
  accessToken: `${label}-access-token`,
  expiresInSeconds: 1_800,
  refreshToken: `${label}-refresh-token`,
  tokenType: 'Bearer',
});

const tokenBundle = (tokens: TokenSet) => ({
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken,
  tokenType: tokens.tokenType,
});

const sequence = <Value>(values: Value[], name: string): (() => Value) => {
  let index = 0;

  return () => {
    const value = values[index];
    index += 1;

    if (value === undefined) {
      throw new Error(`${name} sequence is exhausted`);
    }

    return value;
  };
};

const createFakeClient = (options: FakeClientOptions = {}) => {
  const nextTokenSet = sequence(options.tokenSets ?? [tokenSet('default')], 'token');
  const nextUser = sequence(options.users ?? [adminUser], 'user');
  const currentUserErrors = [...(options.currentUserErrors ?? [])];
  const exchangeAuthorizationCode = vi.fn(() => Promise.resolve(nextTokenSet()));
  const getCurrentUser = vi.fn(() => {
    const error = currentUserErrors.shift();
    return error === undefined ? Promise.resolve(nextUser()) : Promise.reject(error);
  });
  const revokeRefreshToken = vi.fn(() =>
    options.revokeError === undefined ? Promise.resolve() : Promise.reject(options.revokeError),
  );
  const client: HomeAssistantOAuthClient = {
    buildAuthorizationUrl: (origin, state) => {
      const url = new URL('/auth/authorize', origin);
      url.searchParams.set('client_id', aetherOrigin);
      url.searchParams.set('redirect_uri', `${aetherOrigin}/api/v1/auth/callback`);
      url.searchParams.set('state', state);
      return url.toString();
    },
    exchangeAuthorizationCode,
    getCurrentUser,
    refreshAccessToken: () => Promise.reject(new Error('Unexpected token refresh')),
    revokeRefreshToken,
  };

  return {
    client,
    exchangeAuthorizationCode,
    getCurrentUser,
    revokeRefreshToken,
  };
};

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

const extractState = (authorizationUrl: string): string => {
  const state = new URL(authorizationUrl).searchParams.get('state');

  if (state === null) {
    throw new Error('Authorization URL did not contain state');
  }

  return state;
};

describe('createOAuthFlowService', () => {
  it('begins a browser-bound single-use transaction that expires after ten minutes', () => {
    const authRepository = createRepository();
    const fakeClient = createFakeClient();
    const secrets = [secret('state'), secret('browser-binding')];
    const service = createOAuthFlowService({
      authRepository,
      generateSecret: sequence(secrets, 'secret'),
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => 1_000,
      onWarning: () => undefined,
    });

    const result = service.beginAuthorization({
      homeAssistantOrigin,
      purpose: 'engine_setup',
      returnPath: '/setup',
    });

    expect(result).toEqual({
      authorizationUrl: expect.stringContaining('/auth/authorize?'),
      browserBindingSecret: secrets[1],
      expiresAtEpochSeconds: 1_600,
    });
    expect(extractState(result.authorizationUrl)).toBe(secrets[0]);
    expect(authRepository.consumeOAuthTransaction(secrets[0]!, secrets[1]!, 1_599)).toMatchObject({
      expiresAtEpochSeconds: 1_600,
      purpose: 'engine_setup',
    });
  });

  it('stores the engine grant and creates a thirty-day bootstrap session during setup', async () => {
    const authRepository = createRepository();
    const fakeClient = createFakeClient({ tokenSets: [tokenSet('engine')], users: [adminUser] });
    let nowEpochSeconds = 1_000;
    const secrets = [
      secret('setup-state'),
      secret('setup-browser'),
      secret('setup-session'),
      secret('setup-csrf'),
    ];
    const service = createOAuthFlowService({
      authRepository,
      generateId: () => 'engine-credential',
      generateSecret: sequence(secrets, 'secret'),
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: () => undefined,
    });
    const started = service.beginAuthorization({
      homeAssistantOrigin,
      purpose: 'engine_setup',
      returnPath: '/setup/complete',
    });
    nowEpochSeconds = 1_001;

    await expect(
      service.completeAuthorization({
        authorizationCode: 'authorization-code',
        browserBindingSecret: started.browserBindingSecret,
        stateSecret: extractState(started.authorizationUrl),
      }),
    ).resolves.toEqual({
      csrfToken: secrets[3],
      expiresAtEpochSeconds: 1_001 + sessionLifetimeSeconds,
      purpose: 'engine_setup',
      returnPath: '/setup/complete',
      sessionToken: secrets[2],
      status: 'session_created',
      user: adminUser,
    });
    expect(authRepository.loadActiveEngineCredential()).toMatchObject({
      accessTokenExpiresAtEpochSeconds: 2_801,
      id: 'engine-credential',
      tokenBundle: tokenBundle(tokenSet('engine')),
    });
    expect(authRepository.loadActiveSession(secrets[2]!, 1_002)).toMatchObject({
      expiresAtEpochSeconds: 1_001 + sessionLifetimeSeconds,
      homeAssistantUserId: adminUser.id,
    });
  });

  it('reconnects the engine, preserves its session, and revokes the replaced grant', async () => {
    const authRepository = createRepository();
    const initialTokens = tokenSet('initial-engine');
    const replacementTokens = tokenSet('replacement-engine');
    const fakeClient = createFakeClient({
      tokenSets: [initialTokens, replacementTokens],
      users: [adminUser, adminUser],
    });
    let nowEpochSeconds = 1_000;
    const secrets = [
      secret('setup-state'),
      secret('setup-browser'),
      secret('setup-session'),
      secret('setup-csrf'),
      secret('reconnect-state'),
      secret('reconnect-browser'),
    ];
    const service = createOAuthFlowService({
      authRepository,
      generateId: sequence(['engine-credential', 'ignored-replacement-id'], 'ID'),
      generateSecret: sequence(secrets, 'secret'),
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: () => undefined,
    });
    const setup = service.beginAuthorization({
      homeAssistantOrigin,
      purpose: 'engine_setup',
      returnPath: '/setup',
    });
    nowEpochSeconds = 1_001;
    await service.completeAuthorization({
      authorizationCode: 'setup-code',
      browserBindingSecret: setup.browserBindingSecret,
      stateSecret: extractState(setup.authorizationUrl),
    });
    const originalSession = authRepository.loadActiveSession(secrets[2]!, 1_002);

    nowEpochSeconds = 2_000;
    const reconnect = service.beginAuthorization({
      purpose: 'engine_reconnect',
      returnPath: '/settings/home-assistant',
    });
    nowEpochSeconds = 2_001;

    await expect(
      service.completeAuthorization({
        authorizationCode: 'reconnect-code',
        browserBindingSecret: reconnect.browserBindingSecret,
        stateSecret: extractState(reconnect.authorizationUrl),
      }),
    ).resolves.toEqual({
      purpose: 'engine_reconnect',
      returnPath: '/settings/home-assistant',
      status: 'engine_reconnected',
    });
    expect(authRepository.loadActiveEngineCredential()).toMatchObject({
      id: 'engine-credential',
      tokenBundle: tokenBundle(replacementTokens),
    });
    expect(authRepository.loadActiveSession(secrets[2]!, 2_002)).toEqual(originalSession);
    expect(fakeClient.revokeRefreshToken).toHaveBeenCalledWith(
      homeAssistantOrigin,
      initialTokens.refreshToken,
    );
  });

  it('creates a grant-backed session for a regular user', async () => {
    const authRepository = createRepository();
    const fakeClient = createFakeClient({
      tokenSets: [tokenSet('engine'), tokenSet('user')],
      users: [adminUser, regularUser],
    });
    let nowEpochSeconds = 1_000;
    const secrets = [
      secret('setup-state'),
      secret('setup-browser'),
      secret('setup-session'),
      secret('setup-csrf'),
      secret('user-state'),
      secret('user-browser'),
      secret('user-session'),
      secret('user-csrf'),
    ];
    const service = createOAuthFlowService({
      authRepository,
      generateId: sequence(['engine-credential', 'user-credential'], 'ID'),
      generateSecret: sequence(secrets, 'secret'),
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: () => undefined,
    });
    const setup = service.beginAuthorization({
      homeAssistantOrigin,
      purpose: 'engine_setup',
      returnPath: '/setup',
    });
    nowEpochSeconds = 1_001;
    await service.completeAuthorization({
      authorizationCode: 'setup-code',
      browserBindingSecret: setup.browserBindingSecret,
      stateSecret: extractState(setup.authorizationUrl),
    });
    nowEpochSeconds = 2_000;
    const login = service.beginAuthorization({ purpose: 'user_login', returnPath: '/dashboard' });
    nowEpochSeconds = 2_001;

    await expect(
      service.completeAuthorization({
        authorizationCode: 'user-code',
        browserBindingSecret: login.browserBindingSecret,
        stateSecret: extractState(login.authorizationUrl),
      }),
    ).resolves.toMatchObject({
      purpose: 'user_login',
      returnPath: '/dashboard',
      sessionToken: secrets[6],
      status: 'session_created',
      user: regularUser,
    });
    expect(authRepository.loadActiveSession(secrets[6]!, 2_002)).toMatchObject({
      homeAssistantUserId: regularUser.id,
      oauthCredentialId: 'user-credential',
    });
  });

  it('rejects expired and replayed transactions before contacting Home Assistant', async () => {
    const authRepository = createRepository();
    const fakeClient = createFakeClient();
    let nowEpochSeconds = 1_000;
    const secrets = [secret('state'), secret('browser')];
    const service = createOAuthFlowService({
      authRepository,
      generateSecret: sequence(secrets, 'secret'),
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: () => undefined,
    });
    const started = service.beginAuthorization({
      homeAssistantOrigin,
      purpose: 'engine_setup',
      returnPath: '/setup',
    });
    const completion = {
      authorizationCode: 'authorization-code',
      browserBindingSecret: started.browserBindingSecret,
      stateSecret: extractState(started.authorizationUrl),
    };
    nowEpochSeconds = 1_600;

    await expect(service.completeAuthorization(completion)).resolves.toEqual({
      status: 'invalid_transaction',
    });
    await expect(service.completeAuthorization(completion)).resolves.toEqual({
      status: 'invalid_transaction',
    });
    expect(fakeClient.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('consumes a denied authorization without contacting Home Assistant', async () => {
    const authRepository = createRepository();
    const fakeClient = createFakeClient();
    let nowEpochSeconds = 1_000;
    const secrets = [secret('state'), secret('browser')];
    const service = createOAuthFlowService({
      authRepository,
      generateSecret: sequence(secrets, 'secret'),
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: () => undefined,
    });
    const started = service.beginAuthorization({
      homeAssistantOrigin,
      purpose: 'engine_setup',
      returnPath: '/setup',
    });
    const completion = {
      browserBindingSecret: started.browserBindingSecret,
      stateSecret: extractState(started.authorizationUrl),
    };
    nowEpochSeconds = 1_001;

    await expect(service.completeAuthorization(completion)).resolves.toEqual({
      status: 'authorization_denied',
    });
    await expect(
      service.completeAuthorization({ ...completion, authorizationCode: 'replayed-code' }),
    ).resolves.toEqual({ status: 'invalid_transaction' });
    expect(fakeClient.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('revokes a new grant when identity verification fails', async () => {
    const authRepository = createRepository();
    const identityError = new Error('Identity lookup failed');
    const tokens = tokenSet('unverified');
    const fakeClient = createFakeClient({
      currentUserErrors: [identityError],
      tokenSets: [tokens],
    });
    let nowEpochSeconds = 1_000;
    const service = createOAuthFlowService({
      authRepository,
      generateSecret: sequence([secret('state'), secret('browser')], 'secret'),
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: () => undefined,
    });
    const started = service.beginAuthorization({
      homeAssistantOrigin,
      purpose: 'engine_setup',
      returnPath: '/setup',
    });
    nowEpochSeconds = 1_001;

    await expect(
      service.completeAuthorization({
        authorizationCode: 'authorization-code',
        browserBindingSecret: started.browserBindingSecret,
        stateSecret: extractState(started.authorizationUrl),
      }),
    ).rejects.toBe(identityError);
    expect(fakeClient.revokeRefreshToken).toHaveBeenCalledWith(
      homeAssistantOrigin,
      tokens.refreshToken,
    );
  });

  it('revokes a new engine grant when the verified user is not an administrator', async () => {
    const authRepository = createRepository();
    const tokens = tokenSet('non-admin-engine');
    const fakeClient = createFakeClient({ tokenSets: [tokens], users: [regularUser] });
    let nowEpochSeconds = 1_000;
    const service = createOAuthFlowService({
      authRepository,
      generateId: () => 'engine-credential',
      generateSecret: sequence(
        [secret('state'), secret('browser'), secret('session'), secret('csrf')],
        'secret',
      ),
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: () => undefined,
    });
    const started = service.beginAuthorization({
      homeAssistantOrigin,
      purpose: 'engine_setup',
      returnPath: '/setup',
    });
    nowEpochSeconds = 1_001;

    await expect(
      service.completeAuthorization({
        authorizationCode: 'authorization-code',
        browserBindingSecret: started.browserBindingSecret,
        stateSecret: extractState(started.authorizationUrl),
      }),
    ).rejects.toThrow('Engine authorization requires a Home Assistant administrator');
    expect(authRepository.loadActiveEngineCredential()).toBeUndefined();
    expect(fakeClient.revokeRefreshToken).toHaveBeenCalledWith(
      homeAssistantOrigin,
      tokens.refreshToken,
    );
  });

  it('revokes a new grant when session persistence fails', async () => {
    const authRepository = createRepository();
    const userTokens = tokenSet('user-that-must-roll-back');
    const fakeClient = createFakeClient({
      tokenSets: [tokenSet('engine'), userTokens],
      users: [adminUser, regularUser],
    });
    let nowEpochSeconds = 1_000;
    const duplicateSessionToken = secret('duplicate-session');
    const service = createOAuthFlowService({
      authRepository,
      generateId: sequence(['engine-credential', 'user-credential'], 'ID'),
      generateSecret: sequence(
        [
          secret('setup-state'),
          secret('setup-browser'),
          duplicateSessionToken,
          secret('setup-csrf'),
          secret('user-state'),
          secret('user-browser'),
          duplicateSessionToken,
          secret('user-csrf'),
        ],
        'secret',
      ),
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: () => undefined,
    });
    const setup = service.beginAuthorization({
      homeAssistantOrigin,
      purpose: 'engine_setup',
      returnPath: '/setup',
    });
    nowEpochSeconds = 1_001;
    await service.completeAuthorization({
      authorizationCode: 'setup-code',
      browserBindingSecret: setup.browserBindingSecret,
      stateSecret: extractState(setup.authorizationUrl),
    });
    nowEpochSeconds = 2_000;
    const login = service.beginAuthorization({ purpose: 'user_login', returnPath: '/dashboard' });
    nowEpochSeconds = 2_001;

    await expect(
      service.completeAuthorization({
        authorizationCode: 'user-code',
        browserBindingSecret: login.browserBindingSecret,
        stateSecret: extractState(login.authorizationUrl),
      }),
    ).rejects.toThrow();
    expect(authRepository.loadActiveUserCredential(regularUser.id)).toBeUndefined();
    expect(fakeClient.revokeRefreshToken).toHaveBeenLastCalledWith(
      homeAssistantOrigin,
      userTokens.refreshToken,
    );
  });

  it('keeps successful reconnection when old-token revocation fails and emits a safe warning', async () => {
    const authRepository = createRepository();
    const oldTokens = tokenSet('old-secret');
    const newTokens = tokenSet('new-secret');
    const fakeClient = createFakeClient({
      revokeError: new Error(`Failed with ${oldTokens.refreshToken}`),
      tokenSets: [oldTokens, newTokens],
      users: [adminUser, adminUser],
    });
    const warnings: unknown[] = [];
    let nowEpochSeconds = 1_000;
    const service = createOAuthFlowService({
      authRepository,
      generateId: sequence(['engine-credential', 'ignored-replacement-id'], 'ID'),
      generateSecret: sequence(
        [
          secret('setup-state'),
          secret('setup-browser'),
          secret('setup-session'),
          secret('setup-csrf'),
          secret('reconnect-state'),
          secret('reconnect-browser'),
        ],
        'secret',
      ),
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: (warning) => warnings.push(warning),
    });
    const setup = service.beginAuthorization({
      homeAssistantOrigin,
      purpose: 'engine_setup',
      returnPath: '/setup',
    });
    nowEpochSeconds = 1_001;
    await service.completeAuthorization({
      authorizationCode: 'setup-code',
      browserBindingSecret: setup.browserBindingSecret,
      stateSecret: extractState(setup.authorizationUrl),
    });
    nowEpochSeconds = 2_000;
    const reconnect = service.beginAuthorization({
      purpose: 'engine_reconnect',
      returnPath: '/settings',
    });
    nowEpochSeconds = 2_001;

    await expect(
      service.completeAuthorization({
        authorizationCode: 'reconnect-code',
        browserBindingSecret: reconnect.browserBindingSecret,
        stateSecret: extractState(reconnect.authorizationUrl),
      }),
    ).resolves.toMatchObject({ status: 'engine_reconnected' });
    expect(authRepository.loadActiveEngineCredential()).toMatchObject({
      tokenBundle: tokenBundle(newTokens),
    });
    expect(warnings).toEqual([
      {
        code: 'refresh_token_revocation_failed',
        purpose: 'engine_reconnect',
        stage: 'replaced_grant_cleanup',
      },
    ]);
    expect(JSON.stringify(warnings)).not.toContain(oldTokens.refreshToken);
    expect(JSON.stringify(warnings)).not.toContain(newTokens.refreshToken);
  });

  it('preserves the original failure and emits a safe warning when new-token cleanup fails', async () => {
    const authRepository = createRepository();
    const identityError = new Error('Identity lookup failed');
    const tokens = tokenSet('orphan-secret');
    const fakeClient = createFakeClient({
      currentUserErrors: [identityError],
      revokeError: new Error(`Failed with ${tokens.refreshToken}`),
      tokenSets: [tokens],
    });
    const warnings: unknown[] = [];
    let nowEpochSeconds = 1_000;
    const service = createOAuthFlowService({
      authRepository,
      generateSecret: sequence([secret('state'), secret('browser')], 'secret'),
      homeAssistantClient: fakeClient.client,
      nowEpochSeconds: () => nowEpochSeconds,
      onWarning: (warning) => warnings.push(warning),
    });
    const started = service.beginAuthorization({
      homeAssistantOrigin,
      purpose: 'engine_setup',
      returnPath: '/setup',
    });
    nowEpochSeconds = 1_001;

    await expect(
      service.completeAuthorization({
        authorizationCode: 'authorization-code',
        browserBindingSecret: started.browserBindingSecret,
        stateSecret: extractState(started.authorizationUrl),
      }),
    ).rejects.toBe(identityError);
    expect(warnings).toEqual([
      {
        code: 'refresh_token_revocation_failed',
        purpose: 'engine_setup',
        stage: 'new_grant_cleanup',
      },
    ]);
    expect(JSON.stringify(warnings)).not.toContain(tokens.refreshToken);
  });
});

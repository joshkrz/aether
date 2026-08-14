import { and, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';

import type { AetherDatabase } from '../database/createDatabase.ts';
import {
  authenticationSessionTable,
  homeAssistantConnectionTable,
  homeAssistantOauthCredentialTable,
  homeAssistantUserTable,
  oauthTransactionTable,
} from '../database/schema.ts';
import {
  authSecretMatchesHash,
  decryptTokenBundle,
  encryptTokenBundle,
  hashAuthSecret,
  tokenEncryptionVersion,
  type HomeAssistantTokenBundle,
} from './tokenEncryption.ts';

const homeAssistantConnectionSingletonKey = 1;
const minimumSecretLength = 32;

type OAuthTransactionPurpose = 'engine_setup' | 'engine_reconnect' | 'user_login';
type OAuthCredentialPurpose = 'engine' | 'user';

type HomeAssistantConnection = {
  connectedAtEpochSeconds?: number;
  createdAtEpochSeconds: number;
  origin: string;
  updatedAtEpochSeconds: number;
};

export type VerifiedHomeAssistantUser = {
  displayName: string;
  id: string;
  isActive: boolean;
  isAdmin: boolean;
  isOwner: boolean;
};

type OAuthTransaction = {
  createdAtEpochSeconds: number;
  expiresAtEpochSeconds: number;
  homeAssistantOrigin: string;
  purpose: OAuthTransactionPurpose;
  returnPath: string;
};

type OAuthCredential = {
  accessTokenExpiresAtEpochSeconds: number;
  createdAtEpochSeconds: number;
  homeAssistantOrigin: string;
  homeAssistantUserId: string;
  id: string;
  purpose: OAuthCredentialPurpose;
  tokenBundle: HomeAssistantTokenBundle;
  updatedAtEpochSeconds: number;
};

type AuthenticatedSession = {
  createdAtEpochSeconds: number;
  displayName: string;
  expiresAtEpochSeconds: number;
  homeAssistantUserId: string;
  isAdmin: boolean;
  isOwner: boolean;
  lastUsedAtEpochSeconds: number;
  oauthCredentialId?: string;
};

type BeginOAuthTransactionInput = {
  browserBindingSecret: string;
  createdAtEpochSeconds: number;
  expiresAtEpochSeconds: number;
  homeAssistantOrigin?: string;
  purpose: OAuthTransactionPurpose;
  returnPath: string;
  stateSecret: string;
};

export type CompleteAuthorizationInput = {
  credential: {
    accessTokenExpiresAtEpochSeconds: number;
    id: string;
    tokenBundle: HomeAssistantTokenBundle;
  };
  nowEpochSeconds: number;
  session: {
    csrfToken: string;
    expiresAtEpochSeconds: number;
    token: string;
  };
  user: VerifiedHomeAssistantUser;
};

type RevokeSessionResult =
  | { status: 'not_found' }
  | {
      status: 'revoked';
      userCredentialIdWithNoRemainingSessions?: string;
    };

export type AuthRepository = {
  beginOAuthTransaction: (input: BeginOAuthTransactionInput) => OAuthTransaction;
  cleanupExpiredRecords: (nowEpochSeconds: number) => {
    deletedOauthTransactions: number;
    deletedSessions: number;
  };
  completeEngineAuthorization: (input: CompleteAuthorizationInput) => AuthenticatedSession;
  completeUserAuthorization: (input: CompleteAuthorizationInput) => AuthenticatedSession;
  consumeOAuthTransaction: (
    stateSecret: string,
    browserBindingSecret: string,
    nowEpochSeconds: number,
  ) => OAuthTransaction | undefined;
  loadActiveEngineCredential: () => OAuthCredential | undefined;
  loadActiveSession: (
    sessionToken: string,
    nowEpochSeconds: number,
  ) => AuthenticatedSession | undefined;
  loadActiveUserCredential: (homeAssistantUserId: string) => OAuthCredential | undefined;
  loadHomeAssistantConnection: () => HomeAssistantConnection | undefined;
  markCredentialRevoked: (credentialId: string, nowEpochSeconds: number) => boolean;
  revokeSession: (sessionToken: string, nowEpochSeconds: number) => RevokeSessionResult;
  touchSession: (sessionToken: string, nowEpochSeconds: number) => boolean;
  updateCredentialTokens: (
    credentialId: string,
    tokenBundle: HomeAssistantTokenBundle,
    accessTokenExpiresAtEpochSeconds: number,
    nowEpochSeconds: number,
  ) => boolean;
  verifySessionCsrf: (
    sessionToken: string,
    csrfToken: string,
    nowEpochSeconds: number,
  ) => AuthenticatedSession | undefined;
};

type CredentialRow = typeof homeAssistantOauthCredentialTable.$inferSelect;
type SessionRow = typeof authenticationSessionTable.$inferSelect;

const assertNonEmptyText = (value: string, name: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
};

const assertSecret = (value: string, name: string): void => {
  if (value.length < minimumSecretLength) {
    throw new Error(`${name} must contain at least ${minimumSecretLength} characters`);
  }
};

const assertEpochSeconds = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer epoch timestamp`);
  }
};

const assertPeriod = (
  createdAtEpochSeconds: number,
  expiresAtEpochSeconds: number,
  name: string,
): void => {
  assertEpochSeconds(createdAtEpochSeconds, `${name} creation time`);
  assertEpochSeconds(expiresAtEpochSeconds, `${name} expiry time`);

  if (expiresAtEpochSeconds <= createdAtEpochSeconds) {
    throw new Error(`${name} expiry time must be after its creation time`);
  }
};

const normalizeHomeAssistantOrigin = (configuredOrigin: string): string => {
  let origin: URL;

  try {
    origin = new URL(configuredOrigin);
  } catch {
    throw new Error('Home Assistant origin must be a valid absolute HTTP(S) origin');
  }

  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    throw new Error('Home Assistant origin must use HTTP or HTTPS');
  }

  if (
    origin.username.length > 0 ||
    origin.password.length > 0 ||
    (origin.pathname !== '' && origin.pathname !== '/') ||
    origin.search.length > 0 ||
    origin.hash.length > 0
  ) {
    throw new Error('Home Assistant origin must not contain credentials, a path, query, or hash');
  }

  return origin.origin;
};

const assertSafeReturnPath = (returnPath: string): void => {
  const containsControlCharacter = [...returnPath].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });

  if (
    !returnPath.startsWith('/') ||
    returnPath.startsWith('//') ||
    returnPath.includes('\\') ||
    containsControlCharacter
  ) {
    throw new Error('OAuth return path must be a safe application-relative path');
  }
};

const assertVerifiedUser = (user: VerifiedHomeAssistantUser): void => {
  assertNonEmptyText(user.id, 'Home Assistant user ID');
  assertNonEmptyText(user.displayName, 'Home Assistant user display name');

  if (user.isOwner && !user.isAdmin) {
    throw new Error('A Home Assistant owner must also be an administrator');
  }

  if (!user.isActive) {
    throw new Error('Home Assistant user must be active');
  }
};

const assertCompleteAuthorizationInput = (input: CompleteAuthorizationInput): void => {
  assertVerifiedUser(input.user);
  assertNonEmptyText(input.credential.id, 'OAuth credential ID');
  assertEpochSeconds(input.nowEpochSeconds, 'Authorization time');
  assertEpochSeconds(input.credential.accessTokenExpiresAtEpochSeconds, 'Access token expiry time');

  if (input.credential.accessTokenExpiresAtEpochSeconds <= input.nowEpochSeconds) {
    throw new Error('Access token expiry time must be after the authorization time');
  }

  assertSecret(input.session.token, 'Session token');
  assertSecret(input.session.csrfToken, 'CSRF token');
  assertPeriod(input.nowEpochSeconds, input.session.expiresAtEpochSeconds, 'Session');
};

const credentialEncryptionContext = (row: {
  homeAssistantUserId: string;
  id: string;
  purpose: OAuthCredentialPurpose;
}): string => `home-assistant-oauth:${row.id}:${row.purpose}:${row.homeAssistantUserId}`;

const mapConnection = (
  row: typeof homeAssistantConnectionTable.$inferSelect,
): HomeAssistantConnection => {
  const base = {
    createdAtEpochSeconds: row.createdAtEpochSeconds,
    origin: row.origin,
    updatedAtEpochSeconds: row.updatedAtEpochSeconds,
  };

  return row.connectedAtEpochSeconds === null
    ? base
    : { ...base, connectedAtEpochSeconds: row.connectedAtEpochSeconds };
};

const mapCredential = (
  row: CredentialRow,
  homeAssistantOrigin: string,
  authKey: Buffer,
): OAuthCredential => ({
  accessTokenExpiresAtEpochSeconds: row.accessTokenExpiresAtEpochSeconds,
  createdAtEpochSeconds: row.createdAtEpochSeconds,
  homeAssistantOrigin,
  homeAssistantUserId: row.homeAssistantUserId,
  id: row.id,
  purpose: row.purpose,
  tokenBundle: decryptTokenBundle(
    row.encryptedTokenBundle,
    row.tokenEncryptionVersion,
    authKey,
    credentialEncryptionContext(row),
  ),
  updatedAtEpochSeconds: row.updatedAtEpochSeconds,
});

const mapSession = (
  row: SessionRow,
  user: typeof homeAssistantUserTable.$inferSelect,
): AuthenticatedSession => {
  const base = {
    createdAtEpochSeconds: row.createdAtEpochSeconds,
    displayName: user.displayName,
    expiresAtEpochSeconds: row.expiresAtEpochSeconds,
    homeAssistantUserId: user.id,
    isAdmin: user.isAdmin,
    isOwner: user.isOwner,
    lastUsedAtEpochSeconds: row.lastUsedAtEpochSeconds,
  };

  return row.oauthCredentialId === null
    ? base
    : { ...base, oauthCredentialId: row.oauthCredentialId };
};

const userValues = (user: VerifiedHomeAssistantUser, verifiedAtEpochSeconds: number) => ({
  connectionSingletonKey: homeAssistantConnectionSingletonKey,
  displayName: user.displayName.trim(),
  id: user.id.trim(),
  isActive: user.isActive,
  isAdmin: user.isAdmin,
  isOwner: user.isOwner,
  verifiedAtEpochSeconds,
});

export const createAuthRepository = (database: AetherDatabase, authKey: Buffer): AuthRepository => {
  const loadConnectionRow = () =>
    database.query
      .select()
      .from(homeAssistantConnectionTable)
      .where(eq(homeAssistantConnectionTable.singletonKey, homeAssistantConnectionSingletonKey))
      .get();

  const loadSessionRows = (sessionToken: string, nowEpochSeconds: number) => {
    assertSecret(sessionToken, 'Session token');
    assertEpochSeconds(nowEpochSeconds, 'Session lookup time');

    const rows = database.query
      .select({
        session: authenticationSessionTable,
        user: homeAssistantUserTable,
      })
      .from(authenticationSessionTable)
      .innerJoin(
        homeAssistantUserTable,
        eq(authenticationSessionTable.homeAssistantUserId, homeAssistantUserTable.id),
      )
      .where(
        and(
          eq(authenticationSessionTable.tokenHash, hashAuthSecret(sessionToken)),
          isNull(authenticationSessionTable.revokedAtEpochSeconds),
          gt(authenticationSessionTable.expiresAtEpochSeconds, nowEpochSeconds),
          eq(homeAssistantUserTable.isActive, true),
        ),
      )
      .get();

    if (rows?.session.oauthCredentialId === null || rows === undefined) {
      return rows;
    }

    const activeUserCredential = database.query
      .select({ id: homeAssistantOauthCredentialTable.id })
      .from(homeAssistantOauthCredentialTable)
      .where(
        and(
          eq(homeAssistantOauthCredentialTable.id, rows.session.oauthCredentialId),
          eq(homeAssistantOauthCredentialTable.purpose, 'user'),
          isNull(homeAssistantOauthCredentialTable.revokedAtEpochSeconds),
        ),
      )
      .get();

    return activeUserCredential === undefined ? undefined : rows;
  };

  const loadCredential = (
    purpose: OAuthCredentialPurpose,
    homeAssistantUserId?: string,
  ): OAuthCredential | undefined => {
    const connection = loadConnectionRow();

    if (connection === undefined) {
      return undefined;
    }

    const where =
      homeAssistantUserId === undefined
        ? and(
            eq(homeAssistantOauthCredentialTable.purpose, purpose),
            isNull(homeAssistantOauthCredentialTable.revokedAtEpochSeconds),
          )
        : and(
            eq(homeAssistantOauthCredentialTable.purpose, purpose),
            eq(homeAssistantOauthCredentialTable.homeAssistantUserId, homeAssistantUserId),
            isNull(homeAssistantOauthCredentialTable.revokedAtEpochSeconds),
          );
    const row = database.query.select().from(homeAssistantOauthCredentialTable).where(where).get();

    return row === undefined ? undefined : mapCredential(row, connection.origin, authKey);
  };

  const completeAuthorization = (
    input: CompleteAuthorizationInput,
    purpose: OAuthCredentialPurpose,
    bootstrapSession: boolean,
  ): AuthenticatedSession => {
    assertCompleteAuthorizationInput(input);
    const user = {
      ...input.user,
      displayName: input.user.displayName.trim(),
      id: input.user.id.trim(),
    };

    if (purpose === 'engine' && !user.isAdmin) {
      throw new Error('Engine authorization requires a Home Assistant administrator');
    }

    const sessionTokenHash = hashAuthSecret(input.session.token);
    const csrfTokenHash = hashAuthSecret(input.session.csrfToken);

    return database.query.transaction((transaction) => {
      const connection = transaction
        .select()
        .from(homeAssistantConnectionTable)
        .where(eq(homeAssistantConnectionTable.singletonKey, homeAssistantConnectionSingletonKey))
        .get();

      if (connection === undefined) {
        throw new Error('Home Assistant connection must be prepared before authorization');
      }

      if (purpose === 'user' && connection.connectedAtEpochSeconds === null) {
        throw new Error('Home Assistant engine must be connected before user authorization');
      }

      const values = userValues(user, input.nowEpochSeconds);
      transaction
        .insert(homeAssistantUserTable)
        .values(values)
        .onConflictDoUpdate({
          target: homeAssistantUserTable.id,
          set: values,
        })
        .run();

      const existingCredential = transaction
        .select()
        .from(homeAssistantOauthCredentialTable)
        .where(
          and(
            eq(homeAssistantOauthCredentialTable.purpose, purpose),
            purpose === 'engine'
              ? eq(
                  homeAssistantOauthCredentialTable.connectionSingletonKey,
                  homeAssistantConnectionSingletonKey,
                )
              : eq(homeAssistantOauthCredentialTable.homeAssistantUserId, user.id),
            isNull(homeAssistantOauthCredentialTable.revokedAtEpochSeconds),
          ),
        )
        .get();
      const credentialId = existingCredential?.id ?? input.credential.id.trim();
      const encryptedTokenBundle = encryptTokenBundle(
        input.credential.tokenBundle,
        authKey,
        credentialEncryptionContext({
          homeAssistantUserId: user.id,
          id: credentialId,
          purpose,
        }),
      );

      if (existingCredential === undefined) {
        transaction
          .insert(homeAssistantOauthCredentialTable)
          .values({
            accessTokenExpiresAtEpochSeconds: input.credential.accessTokenExpiresAtEpochSeconds,
            connectionSingletonKey: homeAssistantConnectionSingletonKey,
            createdAtEpochSeconds: input.nowEpochSeconds,
            encryptedTokenBundle,
            homeAssistantUserId: user.id,
            id: credentialId,
            purpose,
            revokedAtEpochSeconds: null,
            tokenEncryptionVersion,
            updatedAtEpochSeconds: input.nowEpochSeconds,
          })
          .run();
      } else {
        transaction
          .update(homeAssistantOauthCredentialTable)
          .set({
            accessTokenExpiresAtEpochSeconds: input.credential.accessTokenExpiresAtEpochSeconds,
            encryptedTokenBundle,
            homeAssistantUserId: user.id,
            tokenEncryptionVersion,
            updatedAtEpochSeconds: input.nowEpochSeconds,
          })
          .where(eq(homeAssistantOauthCredentialTable.id, existingCredential.id))
          .run();
      }

      if (purpose === 'engine') {
        transaction
          .update(homeAssistantConnectionTable)
          .set({
            connectedAtEpochSeconds: connection.connectedAtEpochSeconds ?? input.nowEpochSeconds,
            updatedAtEpochSeconds: input.nowEpochSeconds,
          })
          .where(eq(homeAssistantConnectionTable.singletonKey, homeAssistantConnectionSingletonKey))
          .run();
      }

      transaction
        .insert(authenticationSessionTable)
        .values({
          createdAtEpochSeconds: input.nowEpochSeconds,
          csrfTokenHash,
          expiresAtEpochSeconds: input.session.expiresAtEpochSeconds,
          homeAssistantUserId: user.id,
          lastUsedAtEpochSeconds: input.nowEpochSeconds,
          oauthCredentialId: bootstrapSession ? null : credentialId,
          revokedAtEpochSeconds: null,
          tokenHash: sessionTokenHash,
        })
        .run();

      return {
        createdAtEpochSeconds: input.nowEpochSeconds,
        displayName: user.displayName,
        expiresAtEpochSeconds: input.session.expiresAtEpochSeconds,
        homeAssistantUserId: user.id,
        isAdmin: user.isAdmin,
        isOwner: user.isOwner,
        lastUsedAtEpochSeconds: input.nowEpochSeconds,
        ...(bootstrapSession ? {} : { oauthCredentialId: credentialId }),
      };
    });
  };

  return {
    beginOAuthTransaction: (input) => {
      assertSecret(input.stateSecret, 'OAuth state secret');
      assertSecret(input.browserBindingSecret, 'OAuth browser-binding secret');
      assertPeriod(input.createdAtEpochSeconds, input.expiresAtEpochSeconds, 'OAuth transaction');
      assertSafeReturnPath(input.returnPath);

      return database.query.transaction((transaction) => {
        const existingConnection = transaction
          .select()
          .from(homeAssistantConnectionTable)
          .where(eq(homeAssistantConnectionTable.singletonKey, homeAssistantConnectionSingletonKey))
          .get();
        let homeAssistantOrigin: string;

        if (input.purpose === 'engine_setup') {
          if (existingConnection?.connectedAtEpochSeconds != null) {
            throw new Error('Home Assistant connection is already configured');
          }

          if (input.homeAssistantOrigin === undefined) {
            throw new Error('Home Assistant origin is required for initial engine setup');
          }

          homeAssistantOrigin = normalizeHomeAssistantOrigin(input.homeAssistantOrigin);

          if (existingConnection === undefined) {
            transaction
              .insert(homeAssistantConnectionTable)
              .values({
                connectedAtEpochSeconds: null,
                createdAtEpochSeconds: input.createdAtEpochSeconds,
                origin: homeAssistantOrigin,
                singletonKey: homeAssistantConnectionSingletonKey,
                updatedAtEpochSeconds: input.createdAtEpochSeconds,
              })
              .run();
          } else {
            transaction
              .delete(oauthTransactionTable)
              .where(
                eq(
                  oauthTransactionTable.connectionSingletonKey,
                  homeAssistantConnectionSingletonKey,
                ),
              )
              .run();
            transaction
              .update(homeAssistantConnectionTable)
              .set({
                origin: homeAssistantOrigin,
                updatedAtEpochSeconds: input.createdAtEpochSeconds,
              })
              .where(
                eq(homeAssistantConnectionTable.singletonKey, homeAssistantConnectionSingletonKey),
              )
              .run();
          }
        } else {
          if (existingConnection?.connectedAtEpochSeconds == null) {
            throw new Error('Home Assistant connection must be configured before this OAuth flow');
          }

          if (input.homeAssistantOrigin !== undefined) {
            throw new Error(
              'Home Assistant origin may only be supplied during initial engine setup',
            );
          }

          homeAssistantOrigin = existingConnection.origin;
        }

        transaction
          .insert(oauthTransactionTable)
          .values({
            browserBindingHash: hashAuthSecret(input.browserBindingSecret),
            connectionSingletonKey: homeAssistantConnectionSingletonKey,
            consumedAtEpochSeconds: null,
            createdAtEpochSeconds: input.createdAtEpochSeconds,
            expiresAtEpochSeconds: input.expiresAtEpochSeconds,
            purpose: input.purpose,
            returnPath: input.returnPath,
            stateHash: hashAuthSecret(input.stateSecret),
          })
          .run();

        return {
          createdAtEpochSeconds: input.createdAtEpochSeconds,
          expiresAtEpochSeconds: input.expiresAtEpochSeconds,
          homeAssistantOrigin,
          purpose: input.purpose,
          returnPath: input.returnPath,
        };
      });
    },
    cleanupExpiredRecords: (nowEpochSeconds) => {
      assertEpochSeconds(nowEpochSeconds, 'Auth cleanup time');
      const deletedOauthTransactions = Number(
        database.query
          .delete(oauthTransactionTable)
          .where(
            or(
              lte(oauthTransactionTable.expiresAtEpochSeconds, nowEpochSeconds),
              isNotNull(oauthTransactionTable.consumedAtEpochSeconds),
            ),
          )
          .run().changes,
      );
      const deletedSessions = Number(
        database.query
          .delete(authenticationSessionTable)
          .where(
            or(
              lte(authenticationSessionTable.expiresAtEpochSeconds, nowEpochSeconds),
              isNotNull(authenticationSessionTable.revokedAtEpochSeconds),
            ),
          )
          .run().changes,
      );

      return { deletedOauthTransactions, deletedSessions };
    },
    completeEngineAuthorization: (input) => completeAuthorization(input, 'engine', true),
    completeUserAuthorization: (input) => completeAuthorization(input, 'user', false),
    consumeOAuthTransaction: (stateSecret, browserBindingSecret, nowEpochSeconds) => {
      assertSecret(stateSecret, 'OAuth state secret');
      assertSecret(browserBindingSecret, 'OAuth browser-binding secret');
      assertEpochSeconds(nowEpochSeconds, 'OAuth callback time');
      const consumed = database.query
        .update(oauthTransactionTable)
        .set({ consumedAtEpochSeconds: nowEpochSeconds })
        .where(
          and(
            eq(oauthTransactionTable.stateHash, hashAuthSecret(stateSecret)),
            eq(oauthTransactionTable.browserBindingHash, hashAuthSecret(browserBindingSecret)),
            isNull(oauthTransactionTable.consumedAtEpochSeconds),
            gt(oauthTransactionTable.expiresAtEpochSeconds, nowEpochSeconds),
          ),
        )
        .returning()
        .get();

      if (consumed === undefined) {
        return undefined;
      }

      const connection = loadConnectionRow();

      if (connection === undefined) {
        throw new Error('OAuth transaction references a missing Home Assistant connection');
      }

      return {
        createdAtEpochSeconds: consumed.createdAtEpochSeconds,
        expiresAtEpochSeconds: consumed.expiresAtEpochSeconds,
        homeAssistantOrigin: connection.origin,
        purpose: consumed.purpose,
        returnPath: consumed.returnPath,
      };
    },
    loadActiveEngineCredential: () => loadCredential('engine'),
    loadActiveSession: (sessionToken, nowEpochSeconds) => {
      const rows = loadSessionRows(sessionToken, nowEpochSeconds);
      return rows === undefined ? undefined : mapSession(rows.session, rows.user);
    },
    loadActiveUserCredential: (homeAssistantUserId) => {
      assertNonEmptyText(homeAssistantUserId, 'Home Assistant user ID');
      return loadCredential('user', homeAssistantUserId);
    },
    loadHomeAssistantConnection: () => {
      const row = loadConnectionRow();
      return row === undefined ? undefined : mapConnection(row);
    },
    markCredentialRevoked: (credentialId, nowEpochSeconds) => {
      assertNonEmptyText(credentialId, 'OAuth credential ID');
      assertEpochSeconds(nowEpochSeconds, 'Credential revocation time');

      return (
        database.query
          .update(homeAssistantOauthCredentialTable)
          .set({
            revokedAtEpochSeconds: nowEpochSeconds,
            updatedAtEpochSeconds: nowEpochSeconds,
          })
          .where(
            and(
              eq(homeAssistantOauthCredentialTable.id, credentialId),
              isNull(homeAssistantOauthCredentialTable.revokedAtEpochSeconds),
            ),
          )
          .run().changes === 1
      );
    },
    revokeSession: (sessionToken, nowEpochSeconds) => {
      assertSecret(sessionToken, 'Session token');
      assertEpochSeconds(nowEpochSeconds, 'Session revocation time');

      return database.query.transaction((transaction): RevokeSessionResult => {
        const revoked = transaction
          .update(authenticationSessionTable)
          .set({ revokedAtEpochSeconds: nowEpochSeconds })
          .where(
            and(
              eq(authenticationSessionTable.tokenHash, hashAuthSecret(sessionToken)),
              isNull(authenticationSessionTable.revokedAtEpochSeconds),
            ),
          )
          .returning({ oauthCredentialId: authenticationSessionTable.oauthCredentialId })
          .get();

        if (revoked === undefined) {
          return { status: 'not_found' };
        }

        if (revoked.oauthCredentialId === null) {
          return { status: 'revoked' };
        }

        const credential = transaction
          .select({ purpose: homeAssistantOauthCredentialTable.purpose })
          .from(homeAssistantOauthCredentialTable)
          .where(
            and(
              eq(homeAssistantOauthCredentialTable.id, revoked.oauthCredentialId),
              isNull(homeAssistantOauthCredentialTable.revokedAtEpochSeconds),
            ),
          )
          .get();

        if (credential?.purpose !== 'user') {
          return { status: 'revoked' };
        }

        const remainingSession = transaction
          .select({ tokenHash: authenticationSessionTable.tokenHash })
          .from(authenticationSessionTable)
          .where(
            and(
              eq(authenticationSessionTable.oauthCredentialId, revoked.oauthCredentialId),
              isNull(authenticationSessionTable.revokedAtEpochSeconds),
              gt(authenticationSessionTable.expiresAtEpochSeconds, nowEpochSeconds),
            ),
          )
          .get();

        return remainingSession === undefined
          ? {
              status: 'revoked',
              userCredentialIdWithNoRemainingSessions: revoked.oauthCredentialId,
            }
          : { status: 'revoked' };
      });
    },
    touchSession: (sessionToken, nowEpochSeconds) => {
      assertSecret(sessionToken, 'Session token');
      assertEpochSeconds(nowEpochSeconds, 'Session activity time');

      return (
        database.query
          .update(authenticationSessionTable)
          .set({ lastUsedAtEpochSeconds: nowEpochSeconds })
          .where(
            and(
              eq(authenticationSessionTable.tokenHash, hashAuthSecret(sessionToken)),
              isNull(authenticationSessionTable.revokedAtEpochSeconds),
              lte(authenticationSessionTable.lastUsedAtEpochSeconds, nowEpochSeconds),
              gt(authenticationSessionTable.expiresAtEpochSeconds, nowEpochSeconds),
            ),
          )
          .run().changes === 1
      );
    },
    updateCredentialTokens: (
      credentialId,
      tokenBundle,
      accessTokenExpiresAtEpochSeconds,
      nowEpochSeconds,
    ) => {
      assertNonEmptyText(credentialId, 'OAuth credential ID');
      assertEpochSeconds(nowEpochSeconds, 'Credential update time');
      assertEpochSeconds(accessTokenExpiresAtEpochSeconds, 'Access token expiry time');

      if (accessTokenExpiresAtEpochSeconds <= nowEpochSeconds) {
        throw new Error('Access token expiry time must be after the credential update time');
      }

      const credential = database.query
        .select()
        .from(homeAssistantOauthCredentialTable)
        .where(
          and(
            eq(homeAssistantOauthCredentialTable.id, credentialId),
            isNull(homeAssistantOauthCredentialTable.revokedAtEpochSeconds),
          ),
        )
        .get();

      if (credential === undefined) {
        return false;
      }

      const encryptedTokenBundle = encryptTokenBundle(
        tokenBundle,
        authKey,
        credentialEncryptionContext(credential),
      );

      return (
        database.query
          .update(homeAssistantOauthCredentialTable)
          .set({
            accessTokenExpiresAtEpochSeconds,
            encryptedTokenBundle,
            tokenEncryptionVersion,
            updatedAtEpochSeconds: nowEpochSeconds,
          })
          .where(
            and(
              eq(homeAssistantOauthCredentialTable.id, credentialId),
              isNull(homeAssistantOauthCredentialTable.revokedAtEpochSeconds),
            ),
          )
          .run().changes === 1
      );
    },
    verifySessionCsrf: (sessionToken, csrfToken, nowEpochSeconds) => {
      assertSecret(csrfToken, 'CSRF token');
      const rows = loadSessionRows(sessionToken, nowEpochSeconds);

      if (rows === undefined || !authSecretMatchesHash(csrfToken, rows.session.csrfTokenHash)) {
        return undefined;
      }

      return mapSession(rows.session, rows.user);
    },
  };
};

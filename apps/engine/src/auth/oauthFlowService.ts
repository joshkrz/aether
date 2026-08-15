import { randomUUID } from 'node:crypto';

import type { AuthRepository, VerifiedHomeAssistantUser } from './authRepository.ts';
import type { HomeAssistantOAuthClient } from './homeAssistantOAuthClient.ts';
import { generateAuthSecret } from './tokenEncryption.ts';

const oauthTransactionLifetimeSeconds = 10 * 60;
const sessionAbsoluteLifetimeSeconds = 30 * 24 * 60 * 60;

type OAuthTransactionPurpose = 'engine_setup' | 'engine_reconnect' | 'user_login';

type OAuthFlowWarning = {
  code: 'refresh_token_revocation_failed';
  purpose: OAuthTransactionPurpose;
  stage: 'new_grant_cleanup' | 'replaced_grant_cleanup';
};

type OAuthFlowServiceOptions = {
  authRepository: AuthRepository;
  generateId?: () => string;
  generateSecret?: () => string;
  homeAssistantClient: HomeAssistantOAuthClient;
  nowEpochSeconds?: () => number;
  onWarning: (warning: OAuthFlowWarning) => void;
};

type BeginAuthorizationInput = {
  homeAssistantOrigin?: string;
  purpose: OAuthTransactionPurpose;
  returnPath: string;
};

type BeginAuthorizationResult = {
  authorizationUrl: string;
  browserBindingSecret: string;
  expiresAtEpochSeconds: number;
};

type CompleteAuthorizationInput = {
  authorizationCode?: string;
  browserBindingSecret: string;
  stateSecret: string;
};

type SessionAuthorizationPurpose = Exclude<OAuthTransactionPurpose, 'engine_reconnect'>;

type CompleteAuthorizationResult =
  | { status: 'authorization_denied' }
  | { status: 'invalid_transaction' }
  | {
      purpose: 'engine_reconnect';
      returnPath: string;
      status: 'engine_reconnected';
    }
  | {
      csrfToken: string;
      expiresAtEpochSeconds: number;
      purpose: SessionAuthorizationPurpose;
      returnPath: string;
      sessionToken: string;
      status: 'session_created';
      user: VerifiedHomeAssistantUser;
    };

type OAuthFlowService = {
  beginAuthorization: (input: BeginAuthorizationInput) => BeginAuthorizationResult;
  completeAuthorization: (
    input: CompleteAuthorizationInput,
  ) => Promise<CompleteAuthorizationResult>;
};

const defaultNowEpochSeconds = (): number => Math.floor(Date.now() / 1_000);

const assertEpochSeconds = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('OAuth flow clock must return a non-negative safe integer epoch timestamp');
  }

  return value;
};

export const createOAuthFlowService = (options: OAuthFlowServiceOptions): OAuthFlowService => {
  const generateId = options.generateId ?? randomUUID;
  const generateSecret = options.generateSecret ?? generateAuthSecret;
  const nowEpochSeconds = options.nowEpochSeconds ?? defaultNowEpochSeconds;

  const readNow = (): number => assertEpochSeconds(nowEpochSeconds());

  const emitWarning = (warning: OAuthFlowWarning): void => {
    try {
      options.onWarning(warning);
    } catch {
      // Diagnostics must not change authentication or token-cleanup outcomes.
    }
  };

  const revokeBestEffort = async (
    homeAssistantOrigin: string,
    refreshToken: string,
    purpose: OAuthTransactionPurpose,
    stage: OAuthFlowWarning['stage'],
  ): Promise<void> => {
    try {
      await options.homeAssistantClient.revokeRefreshToken(homeAssistantOrigin, refreshToken);
    } catch {
      emitWarning({
        code: 'refresh_token_revocation_failed',
        purpose,
        stage,
      });
    }
  };

  return {
    beginAuthorization: (input) => {
      const createdAtEpochSeconds = readNow();
      const expiresAtEpochSeconds = createdAtEpochSeconds + oauthTransactionLifetimeSeconds;
      const stateSecret = generateSecret();
      const browserBindingSecret = generateSecret();
      const transaction = options.authRepository.beginOAuthTransaction({
        browserBindingSecret,
        createdAtEpochSeconds,
        expiresAtEpochSeconds,
        purpose: input.purpose,
        returnPath: input.returnPath,
        stateSecret,
        ...(input.homeAssistantOrigin === undefined
          ? {}
          : { homeAssistantOrigin: input.homeAssistantOrigin }),
      });

      return {
        authorizationUrl: options.homeAssistantClient.buildAuthorizationUrl(
          transaction.homeAssistantOrigin,
          stateSecret,
        ),
        browserBindingSecret,
        expiresAtEpochSeconds,
      };
    },
    completeAuthorization: async (input) => {
      const transaction = options.authRepository.consumeOAuthTransaction(
        input.stateSecret,
        input.browserBindingSecret,
        readNow(),
      );

      if (transaction === undefined) {
        return { status: 'invalid_transaction' };
      }

      if (input.authorizationCode === undefined) {
        return { status: 'authorization_denied' };
      }

      const tokenSet = await options.homeAssistantClient.exchangeAuthorizationCode(
        transaction.homeAssistantOrigin,
        input.authorizationCode,
      );
      let authorizationStored = false;

      try {
        const user = await options.homeAssistantClient.getCurrentUser(
          transaction.homeAssistantOrigin,
          tokenSet.accessToken,
        );
        const completedAtEpochSeconds = readNow();
        const credential = {
          accessTokenExpiresAtEpochSeconds: completedAtEpochSeconds + tokenSet.expiresInSeconds,
          id: generateId(),
          tokenBundle: {
            accessToken: tokenSet.accessToken,
            refreshToken: tokenSet.refreshToken,
            tokenType: tokenSet.tokenType,
          },
        };
        const previousCredential =
          transaction.purpose === 'engine_setup'
            ? undefined
            : transaction.purpose === 'engine_reconnect'
              ? options.authRepository.loadActiveEngineCredential()
              : options.authRepository.loadActiveUserCredential(user.id);

        if (transaction.purpose === 'engine_reconnect') {
          options.authRepository.completeEngineReconnectAuthorization({
            credential,
            nowEpochSeconds: completedAtEpochSeconds,
            user,
          });
          authorizationStored = true;

          if (
            previousCredential !== undefined &&
            previousCredential.tokenBundle.refreshToken !== tokenSet.refreshToken
          ) {
            await revokeBestEffort(
              transaction.homeAssistantOrigin,
              previousCredential.tokenBundle.refreshToken,
              transaction.purpose,
              'replaced_grant_cleanup',
            );
          }

          return {
            purpose: transaction.purpose,
            returnPath: transaction.returnPath,
            status: 'engine_reconnected',
          };
        }

        const sessionToken = generateSecret();
        const csrfToken = generateSecret();
        const expiresAtEpochSeconds = completedAtEpochSeconds + sessionAbsoluteLifetimeSeconds;
        const authorizationInput = {
          credential,
          nowEpochSeconds: completedAtEpochSeconds,
          session: {
            csrfToken,
            expiresAtEpochSeconds,
            token: sessionToken,
          },
          user,
        };

        if (transaction.purpose === 'engine_setup') {
          options.authRepository.completeEngineSetupAuthorization(authorizationInput);
        } else {
          options.authRepository.completeUserAuthorization(authorizationInput);
        }

        authorizationStored = true;

        if (
          previousCredential !== undefined &&
          previousCredential.tokenBundle.refreshToken !== tokenSet.refreshToken
        ) {
          await revokeBestEffort(
            transaction.homeAssistantOrigin,
            previousCredential.tokenBundle.refreshToken,
            transaction.purpose,
            'replaced_grant_cleanup',
          );
        }

        return {
          csrfToken,
          expiresAtEpochSeconds,
          purpose: transaction.purpose,
          returnPath: transaction.returnPath,
          sessionToken,
          status: 'session_created',
          user,
        };
      } catch (error) {
        if (!authorizationStored) {
          await revokeBestEffort(
            transaction.homeAssistantOrigin,
            tokenSet.refreshToken,
            transaction.purpose,
            'new_grant_cleanup',
          );
        }

        throw error;
      }
    },
  };
};

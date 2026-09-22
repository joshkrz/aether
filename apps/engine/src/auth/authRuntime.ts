import type { AetherDatabase } from '../database/createDatabase.ts';
import { createAuthCookieManager } from './authCookies.ts';
import { createAuthHttpBoundary, type AuthHttpBoundary } from './authHttpHandler.ts';
import { loadOrCreateAuthKey } from './authKey.ts';
import { createAuthRepository } from './authRepository.ts';
import type { AuthRuntimeConfig } from './authRuntimeConfig.ts';
import { createAuthSessionService } from './authSessionService.ts';
import { createHomeAssistantOAuthClient } from './homeAssistantOAuthClient.ts';
import { createInitialSetupCode } from './initialSetupCode.ts';
import { createOAuthFlowService } from './oauthFlowService.ts';
import {
  createClimateEntityDiscovery,
  type ClimateEntityDiscovery,
} from '../homeAssistantClimateDiscovery.ts';

export type AuthRuntimeWarning =
  | {
      code: 'auth_http_operation_failed';
      operation: 'authorization_callback' | 'authorization_start';
      source: 'http';
    }
  | {
      code: 'refresh_token_revocation_failed';
      purpose: 'engine_reconnect' | 'engine_setup' | 'user_login';
      source: 'oauth_flow';
      stage: 'new_grant_cleanup' | 'replaced_grant_cleanup';
    }
  | {
      code: 'refresh_token_revocation_failed';
      source: 'session';
      stage: 'idle_session_expiry' | 'last_session_logout';
    };

type AuthRuntimeOptions = {
  config: AuthRuntimeConfig;
  database: AetherDatabase;
  onInitialSetupCode: (setupCode: string) => void;
  onWarning: (warning: AuthRuntimeWarning) => void;
};

export type AuthRuntime = {
  boundary: AuthHttpBoundary;
  getClimateEntities: ClimateEntityDiscovery;
};

export const createAuthRuntime = (options: AuthRuntimeOptions): AuthRuntime => {
  const authKey = loadOrCreateAuthKey(options.config.authKeyPath);
  const authRepository = createAuthRepository(options.database, authKey);
  const homeAssistantClient = createHomeAssistantOAuthClient({
    clientId: options.config.publicOrigin,
    redirectUri: options.config.oauthCallbackUrl,
  });
  const connection = authRepository.loadHomeAssistantConnection();
  const initialSetupCode =
    connection?.connectedAtEpochSeconds === undefined ? createInitialSetupCode() : undefined;

  if (initialSetupCode !== undefined) {
    options.onInitialSetupCode(initialSetupCode.code);
  }

  const oauthFlowService = createOAuthFlowService({
    authRepository,
    homeAssistantClient,
    onWarning: (warning) => options.onWarning({ ...warning, source: 'oauth_flow' }),
  });
  const authSessionService = createAuthSessionService({
    authRepository,
    homeAssistantClient,
    onWarning: (warning) => options.onWarning({ ...warning, source: 'session' }),
  });
  const authCookies = createAuthCookieManager({ secure: options.config.secureCookies });

  return {
    boundary: createAuthHttpBoundary({
      authCookies,
      authRepository,
      authSessionService,
      ...(initialSetupCode === undefined ? {} : { initialSetupCode }),
      oauthFlowService,
      onWarning: (warning) => options.onWarning({ ...warning, source: 'http' }),
      publicOrigin: options.config.publicOrigin,
    }),
    getClimateEntities: createClimateEntityDiscovery({ authRepository, homeAssistantClient }),
  };
};

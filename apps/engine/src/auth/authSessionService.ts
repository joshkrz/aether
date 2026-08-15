import type { AuthRepository } from './authRepository.ts';
import type { HomeAssistantOAuthClient } from './homeAssistantOAuthClient.ts';

const sessionIdleLifetimeSeconds = 7 * 24 * 60 * 60;
const sessionActivityWriteIntervalSeconds = 60 * 60;

type AuthenticatedSession = NonNullable<ReturnType<AuthRepository['loadActiveSession']>>;

type AuthSessionWarning = {
  code: 'refresh_token_revocation_failed';
  stage: 'idle_session_expiry' | 'last_session_logout';
};

type AuthSessionServiceOptions = {
  authRepository: AuthRepository;
  homeAssistantClient: HomeAssistantOAuthClient;
  nowEpochSeconds?: () => number;
  onWarning: (warning: AuthSessionWarning) => void;
};

type AuthenticationResult =
  { status: 'authenticated'; session: AuthenticatedSession } | { status: 'unauthenticated' };

type LogoutResult = { status: 'logged_out' } | { status: 'unauthenticated' };

type AuthSessionService = {
  authenticateSession: (sessionToken: string) => Promise<AuthenticationResult>;
  authenticateSessionWithCsrf: (
    sessionToken: string,
    csrfToken: string,
  ) => Promise<AuthenticationResult>;
  logout: (sessionToken: string, csrfToken: string) => Promise<LogoutResult>;
};

const defaultNowEpochSeconds = (): number => Math.floor(Date.now() / 1_000);

const assertEpochSeconds = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Auth session clock must return a non-negative safe integer epoch timestamp');
  }

  return value;
};

export const createAuthSessionService = (
  options: AuthSessionServiceOptions,
): AuthSessionService => {
  const nowEpochSeconds = options.nowEpochSeconds ?? defaultNowEpochSeconds;
  const readNow = (): number => assertEpochSeconds(nowEpochSeconds());

  const emitWarning = (warning: AuthSessionWarning): void => {
    try {
      options.onWarning(warning);
    } catch {
      // Diagnostics must not change session or token-revocation outcomes.
    }
  };

  const revokeSessionAndMaybeUserGrant = async (
    sessionToken: string,
    session: AuthenticatedSession,
    now: number,
    warningStage: AuthSessionWarning['stage'],
  ): Promise<boolean> => {
    const userCredential =
      session.oauthCredentialId === undefined
        ? undefined
        : options.authRepository.loadActiveUserCredential(session.homeAssistantUserId);
    const result = options.authRepository.revokeSession(sessionToken, now);

    if (result.status === 'not_found') {
      return false;
    }

    const credentialId = result.userCredentialIdWithNoRemainingSessions;

    if (
      credentialId === undefined ||
      userCredential === undefined ||
      userCredential.id !== credentialId
    ) {
      return true;
    }

    if (!options.authRepository.markCredentialRevoked(credentialId, now)) {
      return true;
    }

    try {
      await options.homeAssistantClient.revokeRefreshToken(
        userCredential.homeAssistantOrigin,
        userCredential.tokenBundle.refreshToken,
      );
    } catch {
      emitWarning({
        code: 'refresh_token_revocation_failed',
        stage: warningStage,
      });
    }

    return true;
  };

  const authenticateLoadedSession = async (
    sessionToken: string,
    session: AuthenticatedSession | undefined,
    now: number,
  ): Promise<AuthenticationResult> => {
    if (session === undefined) {
      return { status: 'unauthenticated' };
    }

    if (session.lastUsedAtEpochSeconds + sessionIdleLifetimeSeconds <= now) {
      await revokeSessionAndMaybeUserGrant(sessionToken, session, now, 'idle_session_expiry');
      return { status: 'unauthenticated' };
    }

    if (session.lastUsedAtEpochSeconds + sessionActivityWriteIntervalSeconds <= now) {
      const touched = options.authRepository.touchSession(sessionToken, now);

      return {
        session: touched ? { ...session, lastUsedAtEpochSeconds: now } : session,
        status: 'authenticated',
      };
    }

    return { session, status: 'authenticated' };
  };

  return {
    authenticateSession: (sessionToken) => {
      const now = readNow();
      return authenticateLoadedSession(
        sessionToken,
        options.authRepository.loadActiveSession(sessionToken, now),
        now,
      );
    },
    authenticateSessionWithCsrf: (sessionToken, csrfToken) => {
      const now = readNow();
      return authenticateLoadedSession(
        sessionToken,
        options.authRepository.verifySessionCsrf(sessionToken, csrfToken, now),
        now,
      );
    },
    logout: async (sessionToken, csrfToken) => {
      const now = readNow();
      const session = options.authRepository.verifySessionCsrf(sessionToken, csrfToken, now);

      if (session === undefined) {
        return { status: 'unauthenticated' };
      }

      return (await revokeSessionAndMaybeUserGrant(
        sessionToken,
        session,
        now,
        'last_session_logout',
      ))
        ? { status: 'logged_out' }
        : { status: 'unauthenticated' };
    },
  };
};

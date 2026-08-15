import { parseCookie, stringifySetCookie } from 'cookie';

const sessionCookieName = 'aether_session';
const csrfCookieName = 'aether_csrf';
const oauthBindingCookieName = 'aether_oauth_binding';
const oauthCallbackPath = '/api/v1/auth/callback';
const rootPath = '/';
const authSecretPattern = /^[\w-]{43}$/u;

type AuthCookieManagerOptions = {
  secure: boolean;
};

type AuthCookieValues = {
  csrfToken?: string;
  oauthBindingSecret?: string;
  sessionToken?: string;
};

type PersistentCookieInput = {
  expiresAtEpochSeconds: number;
  nowEpochSeconds: number;
};

type SessionCookieInput = PersistentCookieInput & {
  csrfToken: string;
  sessionToken: string;
};

type OAuthBindingCookieInput = PersistentCookieInput & {
  browserBindingSecret: string;
};

type AuthCookieManager = {
  clearOAuthBindingCookie: () => string;
  clearSessionCookies: () => [string, string];
  createOAuthBindingCookie: (input: OAuthBindingCookieInput) => string;
  createSessionCookies: (input: SessionCookieInput) => [string, string];
  readCookies: (cookieHeader: string | undefined) => AuthCookieValues;
};

const assertAuthSecret = (value: string, name: string): void => {
  if (!authSecretPattern.test(value)) {
    throw new Error(`${name} must be a 32-byte base64url auth secret`);
  }
};

const persistentCookiePeriod = ({
  expiresAtEpochSeconds,
  nowEpochSeconds,
}: PersistentCookieInput): { expires: Date; maxAge: number } => {
  if (
    !Number.isSafeInteger(nowEpochSeconds) ||
    nowEpochSeconds < 0 ||
    !Number.isSafeInteger(expiresAtEpochSeconds) ||
    expiresAtEpochSeconds <= nowEpochSeconds
  ) {
    throw new Error('Cookie expiry must be a safe integer epoch timestamp in the future');
  }

  const expires = new Date(expiresAtEpochSeconds * 1_000);

  if (Number.isNaN(expires.getTime())) {
    throw new Error('Cookie expiry is outside the supported date range');
  }

  return {
    expires,
    maxAge: expiresAtEpochSeconds - nowEpochSeconds,
  };
};

const validCookieSecret = (value: string | undefined): string | undefined =>
  value !== undefined && authSecretPattern.test(value) ? value : undefined;

export const createAuthCookieManager = (options: AuthCookieManagerOptions): AuthCookieManager => {
  const commonSessionOptions = {
    path: rootPath,
    secure: options.secure,
  } as const;
  const commonOAuthBindingOptions = {
    httpOnly: true,
    path: oauthCallbackPath,
    sameSite: 'lax',
    secure: options.secure,
  } as const;

  return {
    clearOAuthBindingCookie: () =>
      stringifySetCookie({
        name: oauthBindingCookieName,
        value: '',
        expires: new Date(0),
        maxAge: 0,
        ...commonOAuthBindingOptions,
      }),
    clearSessionCookies: () => [
      stringifySetCookie({
        name: sessionCookieName,
        value: '',
        expires: new Date(0),
        httpOnly: true,
        maxAge: 0,
        sameSite: 'lax',
        ...commonSessionOptions,
      }),
      stringifySetCookie({
        name: csrfCookieName,
        value: '',
        expires: new Date(0),
        maxAge: 0,
        sameSite: 'strict',
        ...commonSessionOptions,
      }),
    ],
    createOAuthBindingCookie: (input) => {
      assertAuthSecret(input.browserBindingSecret, 'OAuth browser-binding secret');
      return stringifySetCookie({
        name: oauthBindingCookieName,
        value: input.browserBindingSecret,
        ...persistentCookiePeriod(input),
        ...commonOAuthBindingOptions,
      });
    },
    createSessionCookies: (input) => {
      assertAuthSecret(input.sessionToken, 'Session token');
      assertAuthSecret(input.csrfToken, 'CSRF token');
      const period = persistentCookiePeriod(input);

      return [
        stringifySetCookie({
          name: sessionCookieName,
          value: input.sessionToken,
          httpOnly: true,
          sameSite: 'lax',
          ...period,
          ...commonSessionOptions,
        }),
        stringifySetCookie({
          name: csrfCookieName,
          value: input.csrfToken,
          sameSite: 'strict',
          ...period,
          ...commonSessionOptions,
        }),
      ];
    },
    readCookies: (cookieHeader) => {
      if (cookieHeader === undefined || cookieHeader.length === 0) {
        return {};
      }

      const cookies = parseCookie(cookieHeader);
      const sessionToken = validCookieSecret(cookies[sessionCookieName]);
      const csrfToken = validCookieSecret(cookies[csrfCookieName]);
      const oauthBindingSecret = validCookieSecret(cookies[oauthBindingCookieName]);

      return {
        ...(sessionToken === undefined ? {} : { sessionToken }),
        ...(csrfToken === undefined ? {} : { csrfToken }),
        ...(oauthBindingSecret === undefined ? {} : { oauthBindingSecret }),
      };
    },
  };
};

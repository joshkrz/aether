import { parseSetCookie } from 'cookie';
import { describe, expect, it, vi } from 'vitest';

import { createAuthCookieManager } from './authCookies.ts';
import {
  createAuthHttpBoundary,
  type AuthHttpRequest,
  type AuthHttpResponse,
} from './authHttpHandler.ts';
import { HomeAssistantAuthClientError } from './homeAssistantOAuthClient.ts';
import { createInitialSetupCode } from './initialSetupCode.ts';

const publicOrigin = 'https://aether.example.com';
const homeAssistantOrigin = 'http://homeassistant.local:8123';
const nowEpochSeconds = 1_000;
const setupCodeValue = 'setup-code-'.padEnd(43, 'x');
const sessionToken = 'session-'.padEnd(43, 'x');
const csrfToken = 'csrf-'.padEnd(43, 'x');
const browserBindingSecret = 'browser-binding-'.padEnd(43, 'x');
const stateSecret = 'state-'.padEnd(43, 'x');

type HandlerOptions = Parameters<typeof createAuthHttpBoundary>[0];

const connectedHomeAssistant = {
  connectedAtEpochSeconds: 900,
  createdAtEpochSeconds: 800,
  origin: homeAssistantOrigin,
  updatedAtEpochSeconds: 900,
};

const authenticatedSession = {
  createdAtEpochSeconds: 900,
  displayName: 'Aether Administrator',
  expiresAtEpochSeconds: 2_000,
  homeAssistantUserId: 'ha-admin',
  isAdmin: true,
  isOwner: true,
  lastUsedAtEpochSeconds: 950,
};

const textBody = (value: unknown): Uint8Array =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');

const request = (overrides: Partial<AuthHttpRequest> = {}): AuthHttpRequest => ({
  headers: {},
  method: 'GET',
  pathname: '/api/v1/auth/status',
  ...overrides,
});

const responseJson = (response: AuthHttpResponse): unknown =>
  JSON.parse(response.body ?? 'null') as unknown;

const responseSetCookies = (response: AuthHttpResponse): readonly string[] => {
  const value = response.headers['set-cookie'];

  if (value === undefined) {
    return [];
  }

  return typeof value === 'string' ? [value] : value;
};

const requestCookie = (setCookieHeaders: readonly string[]): string =>
  setCookieHeaders
    .map((header) => {
      const parsed = parseSetCookie(header);
      return `${parsed.name}=${parsed.value}`;
    })
    .join('; ');

const createHarness = (overrides: Partial<HandlerOptions> = {}) => {
  const authCookies = createAuthCookieManager({ secure: true });
  const loadHomeAssistantConnection = vi.fn(() => connectedHomeAssistant);
  const authenticateSession = vi.fn(() =>
    Promise.resolve({ session: authenticatedSession, status: 'authenticated' } as const),
  );
  const authenticateSessionWithCsrf = vi.fn(() =>
    Promise.resolve({ session: authenticatedSession, status: 'authenticated' } as const),
  );
  const logout = vi.fn(() => Promise.resolve({ status: 'logged_out' } as const));
  const beginAuthorization = vi.fn(() => ({
    authorizationUrl: `${homeAssistantOrigin}/auth/authorize?state=${stateSecret}`,
    browserBindingSecret,
    expiresAtEpochSeconds: 1_600,
  }));
  const completeAuthorization = vi.fn(() =>
    Promise.resolve({
      csrfToken,
      expiresAtEpochSeconds: 2_000,
      purpose: 'user_login',
      returnPath: '/dashboard',
      sessionToken,
      status: 'session_created',
      user: {
        displayName: 'Aether Administrator',
        id: 'ha-admin',
        isActive: true,
        isAdmin: true,
        isOwner: true,
      },
    } as const),
  );
  const onWarning = vi.fn();
  const defaults = {
    authCookies,
    authRepository: { loadHomeAssistantConnection },
    authSessionService: {
      authenticateSession,
      authenticateSessionWithCsrf,
      logout,
    },
    initialSetupCode: createInitialSetupCode({ generateSecret: () => setupCodeValue }),
    nowEpochSeconds: () => nowEpochSeconds,
    oauthFlowService: { beginAuthorization, completeAuthorization },
    onWarning,
    publicOrigin,
  } satisfies HandlerOptions;
  const options: HandlerOptions = { ...defaults, ...overrides };
  const boundary = createAuthHttpBoundary(options);

  return {
    authCookies,
    authenticateSession,
    authenticateSessionWithCsrf,
    beginAuthorization,
    boundary,
    completeAuthorization,
    handler: boundary.handleRequest,
    loadHomeAssistantConnection,
    logout,
    onWarning,
  };
};

const authenticatedCookieHeader = (
  authCookies: ReturnType<typeof createAuthCookieManager>,
): string =>
  requestCookie(
    authCookies.createSessionCookies({
      csrfToken,
      expiresAtEpochSeconds: 2_000,
      nowEpochSeconds,
      sessionToken,
    }),
  );

const bindingCookieHeader = (authCookies: ReturnType<typeof createAuthCookieManager>): string =>
  requestCookie([
    authCookies.createOAuthBindingCookie({
      browserBindingSecret,
      expiresAtEpochSeconds: 1_600,
      nowEpochSeconds,
    }),
  ]);

describe('createAuthHttpHandler', () => {
  it('exposes a reusable read-session guard for protected application APIs', async () => {
    const harness = createHarness();
    const missing = await harness.boundary.authenticateReadRequest(undefined);

    expect(missing).toMatchObject({
      response: {
        statusCode: 401,
      },
      status: 'rejected',
    });

    if (missing.status !== 'rejected') {
      throw new Error('Expected a missing session to be rejected');
    }

    expect(missing.response.headers['set-cookie']).toBeUndefined();

    await expect(
      harness.boundary.authenticateReadRequest(authenticatedCookieHeader(harness.authCookies)),
    ).resolves.toEqual({
      session: authenticatedSession,
      status: 'authenticated',
    });
    expect(harness.authenticateSession).toHaveBeenCalledWith(sessionToken);
  });

  it('requires the canonical origin, cookie CSRF match, and session CSRF for mutations', async () => {
    const harness = createHarness();
    const cookie = authenticatedCookieHeader(harness.authCookies);
    const mutation = (headers: AuthHttpRequest['headers']) =>
      harness.boundary.authenticateMutationRequest(
        request({ pathname: '/api/v1/installation/configuration', method: 'PUT', headers }),
      );

    await expect(
      mutation({ cookie, csrfToken, origin: 'https://other.example' }),
    ).resolves.toMatchObject({
      status: 'rejected',
      response: { statusCode: 403 },
    });
    await expect(mutation({ cookie, origin: publicOrigin })).resolves.toMatchObject({
      status: 'rejected',
      response: { statusCode: 403 },
    });
    await expect(mutation({ cookie, csrfToken, origin: publicOrigin })).resolves.toEqual({
      status: 'authenticated',
      session: authenticatedSession,
    });
    expect(harness.authenticateSessionWithCsrf).toHaveBeenCalledOnce();
    expect(harness.authenticateSessionWithCsrf).toHaveBeenCalledWith(sessionToken, csrfToken);
  });

  it('leaves unrelated paths unhandled and rejects unsupported methods', async () => {
    const { handler } = createHarness();

    await expect(handler(request({ pathname: '/api/v1/installation/overview' }))).resolves.toBe(
      undefined,
    );

    const response = await handler(request({ method: 'POST' }));

    expect(response).toMatchObject({ statusCode: 405 });
    expect(response?.headers['allow']).toBe('GET');
    expect(responseJson(response!)).toEqual({ error: { code: 'method_not_allowed' } });
  });

  it('reports setup, unauthenticated, and authenticated status without exposing tokens', async () => {
    const setupHarness = createHarness({
      authRepository: { loadHomeAssistantConnection: () => undefined },
    });
    const setupResponse = await setupHarness.handler(request());

    expect(responseJson(setupResponse!)).toEqual({ status: 'setup_required' });
    expect(setupHarness.authenticateSession).not.toHaveBeenCalled();

    const unauthenticatedHarness = createHarness();
    const unauthenticatedResponse = await unauthenticatedHarness.handler(request());

    expect(responseJson(unauthenticatedResponse!)).toEqual({ status: 'unauthenticated' });

    const authenticatedHarness = createHarness();
    const authenticatedResponse = await authenticatedHarness.handler(
      request({
        headers: { cookie: authenticatedCookieHeader(authenticatedHarness.authCookies) },
      }),
    );

    expect(responseJson(authenticatedResponse!)).toEqual({
      status: 'authenticated',
      user: {
        displayName: authenticatedSession.displayName,
        isAdmin: true,
        isOwner: true,
      },
    });
    expect(authenticatedResponse?.body).not.toContain(sessionToken);
    expect(authenticatedResponse?.headers['cache-control']).toBe('no-store');
  });

  it('starts initial setup only with the exact origin and current setup code', async () => {
    const harness = createHarness({
      authRepository: { loadHomeAssistantConnection: () => undefined },
    });
    const setupRequest = request({
      body: textBody({
        homeAssistantOrigin: `${homeAssistantOrigin}/`,
        returnPath: '/setup/complete',
        setupCode: setupCodeValue,
      }),
      headers: { contentType: 'application/json; charset=utf-8', origin: publicOrigin },
      method: 'POST',
      pathname: '/api/v1/auth/engine/setup',
    });
    const response = await harness.handler(setupRequest);

    expect(response).toMatchObject({ statusCode: 200 });
    expect(responseJson(response!)).toEqual({
      authorizationUrl: expect.stringContaining('/auth/authorize?'),
    });
    expect(harness.beginAuthorization).toHaveBeenCalledWith({
      homeAssistantOrigin,
      purpose: 'engine_setup',
      returnPath: '/setup/complete',
    });
    expect(parseSetCookie(responseSetCookies(response!)[0]!)).toMatchObject({
      httpOnly: true,
      name: 'aether_oauth_binding',
      path: '/api/v1/auth/callback',
      sameSite: 'lax',
      secure: true,
      value: browserBindingSecret,
    });

    const wrongOrigin = await harness.handler(
      request({
        ...setupRequest,
        headers: { ...setupRequest.headers, origin: 'https://attacker.example' },
      }),
    );
    const wrongCode = await harness.handler(
      request({
        ...setupRequest,
        body: textBody({
          homeAssistantOrigin,
          returnPath: '/setup',
          setupCode: 'wrong-code',
        }),
      }),
    );

    expect(responseJson(wrongOrigin!)).toEqual({ error: { code: 'invalid_origin' } });
    expect(responseJson(wrongCode!)).toEqual({ error: { code: 'invalid_setup_code' } });
  });

  it('strictly validates JSON media type, size, fields, origins, and return paths', async () => {
    const harness = createHarness({
      authRepository: { loadHomeAssistantConnection: () => undefined },
    });
    const base = {
      headers: { contentType: 'application/json', origin: publicOrigin },
      method: 'POST',
      pathname: '/api/v1/auth/engine/setup',
    } as const;
    const invalidRequests = [
      request({ ...base, body: textBody('{') }),
      request({ ...base, body: Buffer.alloc(16 * 1_024 + 1, 120) }),
      request({
        ...base,
        body: textBody({
          extra: true,
          homeAssistantOrigin,
          returnPath: '/setup',
          setupCode: setupCodeValue,
        }),
      }),
      request({
        ...base,
        body: textBody({
          homeAssistantOrigin: `${homeAssistantOrigin}/config`,
          returnPath: '/setup',
          setupCode: setupCodeValue,
        }),
      }),
      request({
        ...base,
        body: textBody({
          homeAssistantOrigin,
          returnPath: '//attacker.example',
          setupCode: setupCodeValue,
        }),
      }),
      request({
        ...base,
        body: textBody({ homeAssistantOrigin, returnPath: '/setup', setupCode: setupCodeValue }),
        headers: { contentType: 'text/plain', origin: publicOrigin },
      }),
    ];
    const responses = await Promise.all(invalidRequests.map((value) => harness.handler(value)));

    expect(responses.map((response) => response?.statusCode)).toEqual([
      400, 413, 400, 400, 400, 415,
    ]);
    expect(harness.beginAuthorization).not.toHaveBeenCalled();
  });

  it('starts user login only after engine setup is complete', async () => {
    const harness = createHarness();
    const loginRequest = request({
      body: textBody({ returnPath: '/dashboard' }),
      headers: { contentType: 'application/json', origin: publicOrigin },
      method: 'POST',
      pathname: '/api/v1/auth/login',
    });
    const response = await harness.handler(loginRequest);

    expect(response?.statusCode).toBe(200);
    expect(harness.beginAuthorization).toHaveBeenCalledWith({
      purpose: 'user_login',
      returnPath: '/dashboard',
    });

    const unconfiguredHarness = createHarness({
      authRepository: { loadHomeAssistantConnection: () => undefined },
    });
    const setupRequired = await unconfiguredHarness.handler(loginRequest);

    expect(responseJson(setupRequired!)).toEqual({ error: { code: 'setup_required' } });
  });

  it('requires a CSRF-bound administrator session before engine reconnection', async () => {
    const harness = createHarness();
    const cookie = authenticatedCookieHeader(harness.authCookies);
    const reconnectRequest = request({
      body: textBody({ returnPath: '/settings/home-assistant' }),
      headers: {
        contentType: 'application/json',
        cookie,
        csrfToken,
        origin: publicOrigin,
      },
      method: 'POST',
      pathname: '/api/v1/auth/engine/reconnect',
    });
    const response = await harness.handler(reconnectRequest);

    expect(response?.statusCode).toBe(200);
    expect(harness.authenticateSessionWithCsrf).toHaveBeenCalledWith(sessionToken, csrfToken);
    expect(harness.beginAuthorization).toHaveBeenCalledWith({
      purpose: 'engine_reconnect',
      returnPath: '/settings/home-assistant',
    });

    const missingCsrf = await harness.handler(
      request({
        ...reconnectRequest,
        headers: {
          contentType: 'application/json',
          cookie,
          origin: publicOrigin,
        },
      }),
    );
    expect(responseJson(missingCsrf!)).toEqual({ error: { code: 'invalid_csrf_token' } });

    const regularUserHarness = createHarness({
      authSessionService: {
        authenticateSession: harness.authenticateSession,
        authenticateSessionWithCsrf: () =>
          Promise.resolve({
            session: { ...authenticatedSession, isAdmin: false, isOwner: false },
            status: 'authenticated',
          }),
        logout: harness.logout,
      },
    });
    const regularUser = await regularUserHarness.handler(reconnectRequest);

    expect(responseJson(regularUser!)).toEqual({ error: { code: 'administrator_required' } });
  });

  it('completes a session callback, redirects safely, and replaces temporary cookies', async () => {
    const harness = createHarness();
    const response = await harness.handler(
      request({
        headers: { cookie: bindingCookieHeader(harness.authCookies) },
        pathname: '/api/v1/auth/callback',
        searchParams: new URLSearchParams({ code: 'authorization-code', state: stateSecret }),
      }),
    );

    expect(response).toMatchObject({ statusCode: 303 });
    expect(response?.headers['location']).toBe('/dashboard');
    expect(harness.completeAuthorization).toHaveBeenCalledWith({
      authorizationCode: 'authorization-code',
      browserBindingSecret,
      stateSecret,
    });
    expect(responseSetCookies(response!).map((header) => parseSetCookie(header).name)).toEqual([
      'aether_session',
      'aether_csrf',
      'aether_oauth_binding',
    ]);
  });

  it('preserves session cookies when an engine reconnect callback succeeds', async () => {
    const completeAuthorization: HandlerOptions['oauthFlowService']['completeAuthorization'] =
      vi.fn(() =>
        Promise.resolve({
          purpose: 'engine_reconnect' as const,
          returnPath: '/settings/home-assistant',
          status: 'engine_reconnected' as const,
        }),
      );
    const harness = createHarness({
      oauthFlowService: {
        beginAuthorization: vi.fn(),
        completeAuthorization,
      },
    });
    const response = await harness.handler(
      request({
        headers: { cookie: bindingCookieHeader(harness.authCookies) },
        pathname: '/api/v1/auth/callback',
        searchParams: new URLSearchParams({ code: 'authorization-code', state: stateSecret }),
      }),
    );

    expect(response?.headers['location']).toBe('/settings/home-assistant');
    expect(responseSetCookies(response!)).toHaveLength(1);
    expect(parseSetCookie(responseSetCookies(response!)[0]!).name).toBe('aether_oauth_binding');
  });

  it('consumes provider denial and redirects callback failures without exposing details', async () => {
    const deniedCompletion: HandlerOptions['oauthFlowService']['completeAuthorization'] = vi.fn(
      () => Promise.resolve({ status: 'authorization_denied' as const }),
    );
    const deniedHarness = createHarness({
      oauthFlowService: {
        beginAuthorization: vi.fn(),
        completeAuthorization: deniedCompletion,
      },
    });
    const denied = await deniedHarness.handler(
      request({
        headers: { cookie: bindingCookieHeader(deniedHarness.authCookies) },
        pathname: '/api/v1/auth/callback',
        searchParams: new URLSearchParams({ error: 'access_denied', state: stateSecret }),
      }),
    );

    expect(denied?.headers['location']).toBe('/auth/error?code=authorization_denied');
    expect(deniedCompletion).toHaveBeenCalledWith({
      browserBindingSecret,
      stateSecret,
    });
    expect(JSON.stringify(denied)).not.toContain('access_denied');

    const failingCompletion: HandlerOptions['oauthFlowService']['completeAuthorization'] = vi.fn(
      () =>
        Promise.reject(
          new HomeAssistantAuthClientError('unavailable', 'sensitive upstream connection details'),
        ),
    );
    const failingHarness = createHarness({
      oauthFlowService: {
        beginAuthorization: vi.fn(),
        completeAuthorization: failingCompletion,
      },
    });
    const failed = await failingHarness.handler(
      request({
        headers: { cookie: bindingCookieHeader(failingHarness.authCookies) },
        pathname: '/api/v1/auth/callback',
        searchParams: new URLSearchParams({ code: 'authorization-code', state: stateSecret }),
      }),
    );

    expect(failed?.headers['location']).toBe('/auth/error?code=home_assistant_unavailable');
    expect(JSON.stringify(failed)).not.toContain('sensitive upstream');
    expect(failingHarness.onWarning).toHaveBeenCalledWith({
      code: 'auth_http_operation_failed',
      operation: 'authorization_callback',
    });
  });

  it('rejects malformed callback bindings and always clears the temporary cookie', async () => {
    const harness = createHarness();
    const response = await harness.handler(
      request({
        headers: {},
        pathname: '/api/v1/auth/callback',
        searchParams: new URLSearchParams({ code: 'authorization-code', state: stateSecret }),
      }),
    );

    expect(response?.headers['location']).toBe('/auth/error?code=invalid_oauth_transaction');
    expect(harness.completeAuthorization).not.toHaveBeenCalled();
    expect(parseSetCookie(responseSetCookies(response!)[0]!)).toMatchObject({
      maxAge: 0,
      name: 'aether_oauth_binding',
      path: '/api/v1/auth/callback',
      value: '',
    });
  });

  it('logs out a CSRF-bound session and clears both persistent cookies', async () => {
    const harness = createHarness();
    const response = await harness.handler(
      request({
        headers: {
          cookie: authenticatedCookieHeader(harness.authCookies),
          csrfToken,
          origin: publicOrigin,
        },
        method: 'POST',
        pathname: '/api/v1/auth/logout',
      }),
    );

    expect(response?.statusCode).toBe(204);
    expect(response?.body).toBeUndefined();
    expect(harness.logout).toHaveBeenCalledWith(sessionToken, csrfToken);
    expect(responseSetCookies(response!)).toHaveLength(2);
    expect(
      responseSetCookies(response!).every((header) => parseSetCookie(header).maxAge === 0),
    ).toBe(true);
  });
});

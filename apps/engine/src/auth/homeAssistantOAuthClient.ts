const defaultTimeoutMilliseconds = 15_000;
const minimumOAuthSecretLength = 32;
const currentUserMessageId = 1;

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type WebSocketMessage = {
  data: unknown;
};

type WebSocketLike = {
  close: (code?: number, reason?: string) => void;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: WebSocketMessage) => void) | null;
  send: (data: string) => void;
};

type HomeAssistantOAuthClientOptions = {
  clientId: string;
  createWebSocket?: (url: string) => WebSocketLike;
  fetch?: FetchImplementation;
  redirectUri: string;
  timeoutMilliseconds?: number;
};

type HomeAssistantOAuthTokenSet = {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  tokenType: 'Bearer';
};

type HomeAssistantRefreshedAccessToken = {
  accessToken: string;
  expiresInSeconds: number;
  tokenType: 'Bearer';
};

type HomeAssistantCurrentUser = {
  displayName: string;
  id: string;
  isActive: true;
  isAdmin: boolean;
  isOwner: boolean;
};

export type HomeAssistantAuthClientErrorCode =
  'invalid_configuration' | 'invalid_response' | 'rejected' | 'timeout' | 'unavailable';

export class HomeAssistantAuthClientError extends Error {
  readonly code: HomeAssistantAuthClientErrorCode;

  constructor(code: HomeAssistantAuthClientErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HomeAssistantAuthClientError';
    this.code = code;
  }
}

export type HomeAssistantOAuthClient = {
  buildAuthorizationUrl: (homeAssistantOrigin: string, state: string) => string;
  exchangeAuthorizationCode: (
    homeAssistantOrigin: string,
    authorizationCode: string,
  ) => Promise<HomeAssistantOAuthTokenSet>;
  getCurrentUser: (
    homeAssistantOrigin: string,
    accessToken: string,
  ) => Promise<HomeAssistantCurrentUser>;
  refreshAccessToken: (
    homeAssistantOrigin: string,
    refreshToken: string,
  ) => Promise<HomeAssistantRefreshedAccessToken>;
  revokeRefreshToken: (homeAssistantOrigin: string, refreshToken: string) => Promise<void>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const assertHighEntropySecret = (value: string, name: string): void => {
  if (value.length < minimumOAuthSecretLength) {
    throw new HomeAssistantAuthClientError(
      'invalid_configuration',
      `${name} must contain at least ${minimumOAuthSecretLength} characters`,
    );
  }
};

const assertNonEmptyValue = (value: string, name: string): void => {
  if (value.length === 0) {
    throw new HomeAssistantAuthClientError('invalid_configuration', `${name} must not be empty`);
  }
};

const normalizeHttpOrigin = (value: string, name: string): string => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new HomeAssistantAuthClientError(
      'invalid_configuration',
      `${name} must be a valid absolute HTTP(S) origin`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HomeAssistantAuthClientError(
      'invalid_configuration',
      `${name} must use HTTP or HTTPS`,
    );
  }

  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new HomeAssistantAuthClientError(
      'invalid_configuration',
      `${name} must not contain credentials, a path, query, or hash`,
    );
  }

  return url.origin;
};

const parseRedirectUri = (value: string, clientOrigin: string): string => {
  let redirectUri: URL;

  try {
    redirectUri = new URL(value);
  } catch {
    throw new HomeAssistantAuthClientError(
      'invalid_configuration',
      'OAuth redirect URI must be a valid absolute URL',
    );
  }

  if (redirectUri.protocol !== 'http:' && redirectUri.protocol !== 'https:') {
    throw new HomeAssistantAuthClientError(
      'invalid_configuration',
      'OAuth redirect URI must use HTTP or HTTPS',
    );
  }

  if (
    redirectUri.origin !== clientOrigin ||
    redirectUri.username.length > 0 ||
    redirectUri.password.length > 0 ||
    redirectUri.hash.length > 0
  ) {
    throw new HomeAssistantAuthClientError(
      'invalid_configuration',
      'OAuth redirect URI must share the client ID origin and contain no credentials or hash',
    );
  }

  return redirectUri.toString();
};

const assertTimeout = (timeoutMilliseconds: number): void => {
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new HomeAssistantAuthClientError(
      'invalid_configuration',
      'Home Assistant auth timeout must be a positive integer',
    );
  }
};

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    throw new HomeAssistantAuthClientError(
      'invalid_response',
      'Home Assistant returned an invalid authentication response',
    );
  }
};

const parseTokenFields = (value: unknown): HomeAssistantRefreshedAccessToken => {
  if (
    !isRecord(value) ||
    typeof value['access_token'] !== 'string' ||
    value['access_token'].length === 0 ||
    value['token_type'] !== 'Bearer' ||
    typeof value['expires_in'] !== 'number' ||
    !Number.isInteger(value['expires_in']) ||
    value['expires_in'] <= 0
  ) {
    throw new HomeAssistantAuthClientError(
      'invalid_response',
      'Home Assistant returned an invalid token response',
    );
  }

  return {
    accessToken: value['access_token'],
    expiresInSeconds: value['expires_in'],
    tokenType: value['token_type'],
  };
};

const parseTokenSet = (value: unknown): HomeAssistantOAuthTokenSet => {
  const tokenFields = parseTokenFields(value);

  if (
    !isRecord(value) ||
    typeof value['refresh_token'] !== 'string' ||
    value['refresh_token'].length === 0
  ) {
    throw new HomeAssistantAuthClientError(
      'invalid_response',
      'Home Assistant returned an invalid token response',
    );
  }

  return {
    ...tokenFields,
    refreshToken: value['refresh_token'],
  };
};

const parseCurrentUser = (value: unknown): HomeAssistantCurrentUser => {
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    value['id'].trim().length === 0 ||
    (typeof value['name'] !== 'string' && value['name'] !== null) ||
    typeof value['is_admin'] !== 'boolean' ||
    typeof value['is_owner'] !== 'boolean' ||
    (value['is_owner'] && !value['is_admin'])
  ) {
    throw new HomeAssistantAuthClientError(
      'invalid_response',
      'Home Assistant returned an invalid current-user response',
    );
  }

  const id = value['id'].trim();
  const configuredName = value['name'];
  const displayName =
    typeof configuredName === 'string' && configuredName.trim().length > 0
      ? configuredName.trim()
      : id;

  return {
    displayName,
    id,
    isActive: true,
    isAdmin: value['is_admin'],
    isOwner: value['is_owner'],
  };
};

const webSocketUrl = (homeAssistantOrigin: string): string => {
  const url = new URL('/api/websocket', homeAssistantOrigin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

export const createHomeAssistantOAuthClient = (
  options: HomeAssistantOAuthClientOptions,
): HomeAssistantOAuthClient => {
  const clientId = normalizeHttpOrigin(options.clientId, 'OAuth client ID');
  const redirectUri = parseRedirectUri(options.redirectUri, clientId);
  const timeoutMilliseconds = options.timeoutMilliseconds ?? defaultTimeoutMilliseconds;
  assertTimeout(timeoutMilliseconds);
  const fetchImplementation = options.fetch ?? fetch;
  const createWebSocket =
    options.createWebSocket ??
    ((url: string): WebSocketLike => new WebSocket(url) as unknown as WebSocketLike);

  const postForm = async (
    homeAssistantOrigin: string,
    path: '/auth/revoke' | '/auth/token',
    form: URLSearchParams,
  ): Promise<Response> => {
    const origin = normalizeHttpOrigin(homeAssistantOrigin, 'Home Assistant origin');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);

    try {
      const response = await fetchImplementation(new URL(path, origin), {
        body: form,
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new HomeAssistantAuthClientError(
          'rejected',
          `Home Assistant rejected the authentication request with status ${response.status}`,
        );
      }

      return response;
    } catch (error) {
      if (error instanceof HomeAssistantAuthClientError) {
        throw error;
      }

      if (controller.signal.aborted) {
        throw new HomeAssistantAuthClientError(
          'timeout',
          'Home Assistant authentication request timed out',
          { cause: error },
        );
      }

      throw new HomeAssistantAuthClientError(
        'unavailable',
        'Home Assistant authentication endpoint is unavailable',
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  const parseTokenResponse = async (response: Response): Promise<unknown> => {
    let body: string;

    try {
      body = await response.text();
    } catch (error) {
      throw new HomeAssistantAuthClientError(
        'invalid_response',
        'Home Assistant token response could not be read',
        { cause: error },
      );
    }

    return parseJson(body);
  };

  return {
    buildAuthorizationUrl: (homeAssistantOrigin, state) => {
      assertHighEntropySecret(state, 'OAuth state');
      const origin = normalizeHttpOrigin(homeAssistantOrigin, 'Home Assistant origin');
      const authorizationUrl = new URL('/auth/authorize', origin);
      authorizationUrl.searchParams.set('client_id', clientId);
      authorizationUrl.searchParams.set('redirect_uri', redirectUri);
      authorizationUrl.searchParams.set('state', state);
      return authorizationUrl.toString();
    },
    exchangeAuthorizationCode: async (homeAssistantOrigin, authorizationCode) => {
      assertNonEmptyValue(authorizationCode, 'OAuth authorization code');
      const response = await postForm(
        homeAssistantOrigin,
        '/auth/token',
        new URLSearchParams({
          client_id: clientId,
          code: authorizationCode,
          grant_type: 'authorization_code',
        }),
      );
      return parseTokenSet(await parseTokenResponse(response));
    },
    getCurrentUser: (homeAssistantOrigin, accessToken) => {
      assertNonEmptyValue(accessToken, 'Home Assistant access token');
      const origin = normalizeHttpOrigin(homeAssistantOrigin, 'Home Assistant origin');

      return new Promise<HomeAssistantCurrentUser>((resolve, reject) => {
        let socket: WebSocketLike;
        let phase: 'awaiting_auth_required' | 'awaiting_auth_result' | 'awaiting_user' =
          'awaiting_auth_required';
        let settled = false;

        const finish = (
          result:
            | { status: 'rejected'; error: HomeAssistantAuthClientError }
            | { status: 'resolved'; user: HomeAssistantCurrentUser },
        ): void => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeout);
          socket.onmessage = null;
          socket.onerror = null;
          socket.onclose = null;

          try {
            socket.close(1000, 'Aether identity check complete');
          } catch {
            // Closing is best effort after the request has already settled.
          }

          if (result.status === 'resolved') {
            resolve(result.user);
          } else {
            reject(result.error);
          }
        };

        const rejectProtocol = (message: string): void => {
          finish({
            status: 'rejected',
            error: new HomeAssistantAuthClientError('invalid_response', message),
          });
        };

        try {
          socket = createWebSocket(webSocketUrl(origin));
        } catch (error) {
          reject(
            new HomeAssistantAuthClientError(
              'unavailable',
              'Home Assistant WebSocket endpoint is unavailable',
              { cause: error },
            ),
          );
          return;
        }

        const timeout = setTimeout(() => {
          finish({
            status: 'rejected',
            error: new HomeAssistantAuthClientError(
              'timeout',
              'Home Assistant identity request timed out',
            ),
          });
        }, timeoutMilliseconds);

        socket.onerror = () => {
          finish({
            status: 'rejected',
            error: new HomeAssistantAuthClientError(
              'unavailable',
              'Home Assistant WebSocket endpoint is unavailable',
            ),
          });
        };
        socket.onclose = () => {
          finish({
            status: 'rejected',
            error: new HomeAssistantAuthClientError(
              'unavailable',
              'Home Assistant closed the identity connection before completion',
            ),
          });
        };
        socket.onmessage = (event) => {
          if (typeof event.data !== 'string') {
            rejectProtocol('Home Assistant returned a non-text WebSocket response');
            return;
          }

          let message: unknown;

          try {
            message = parseJson(event.data);
          } catch (error) {
            finish({
              status: 'rejected',
              error:
                error instanceof HomeAssistantAuthClientError
                  ? error
                  : new HomeAssistantAuthClientError(
                      'invalid_response',
                      'Home Assistant returned an invalid WebSocket response',
                      { cause: error },
                    ),
            });
            return;
          }

          if (!isRecord(message) || typeof message['type'] !== 'string') {
            rejectProtocol('Home Assistant returned an invalid WebSocket response');
            return;
          }

          if (phase === 'awaiting_auth_required') {
            if (message['type'] !== 'auth_required') {
              rejectProtocol('Home Assistant did not begin WebSocket authentication');
              return;
            }

            phase = 'awaiting_auth_result';
            socket.send(JSON.stringify({ access_token: accessToken, type: 'auth' }));
            return;
          }

          if (phase === 'awaiting_auth_result') {
            if (message['type'] === 'auth_invalid') {
              finish({
                status: 'rejected',
                error: new HomeAssistantAuthClientError(
                  'rejected',
                  'Home Assistant rejected the access token',
                ),
              });
              return;
            }

            if (message['type'] !== 'auth_ok') {
              rejectProtocol('Home Assistant returned an invalid WebSocket authentication result');
              return;
            }

            phase = 'awaiting_user';
            socket.send(JSON.stringify({ id: currentUserMessageId, type: 'auth/current_user' }));
            return;
          }

          if (
            message['type'] !== 'result' ||
            message['id'] !== currentUserMessageId ||
            message['success'] !== true ||
            !('result' in message)
          ) {
            rejectProtocol('Home Assistant returned an invalid current-user result');
            return;
          }

          try {
            finish({ status: 'resolved', user: parseCurrentUser(message['result']) });
          } catch (error) {
            finish({
              status: 'rejected',
              error:
                error instanceof HomeAssistantAuthClientError
                  ? error
                  : new HomeAssistantAuthClientError(
                      'invalid_response',
                      'Home Assistant returned an invalid current-user result',
                      { cause: error },
                    ),
            });
          }
        };
      });
    },
    refreshAccessToken: async (homeAssistantOrigin, refreshToken) => {
      assertNonEmptyValue(refreshToken, 'Home Assistant refresh token');
      const response = await postForm(
        homeAssistantOrigin,
        '/auth/token',
        new URLSearchParams({
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      );
      return parseTokenFields(await parseTokenResponse(response));
    },
    revokeRefreshToken: async (homeAssistantOrigin, refreshToken) => {
      assertNonEmptyValue(refreshToken, 'Home Assistant refresh token');
      await postForm(
        homeAssistantOrigin,
        '/auth/revoke',
        new URLSearchParams({ token: refreshToken }),
      );
    },
  };
};

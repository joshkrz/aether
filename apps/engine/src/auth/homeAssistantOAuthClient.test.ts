import { describe, expect, it } from 'vitest';

import {
  createHomeAssistantOAuthClient,
  HomeAssistantAuthClientError,
} from './homeAssistantOAuthClient.ts';

const clientId = 'https://aether.example.com';
const redirectUri = 'https://aether.example.com/api/v1/auth/callback';
const homeAssistantOrigin = 'http://homeassistant.local:8123';
const oauthState = 'oauth-state-that-is-at-least-thirty-two-characters';

type FakeWebSocketMessage = {
  data: unknown;
};

class FakeWebSocket {
  readonly sentMessages: string[] = [];
  closed = false;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: FakeWebSocketMessage) => void) | null = null;

  constructor(
    readonly url: string,
    private readonly handleSentMessage: (
      message: Record<string, unknown>,
      socket: FakeWebSocket,
    ) => void,
  ) {
    queueMicrotask(() => this.emit({ type: 'auth_required' }));
  }

  close(): void {
    this.closed = true;
  }

  emit(message: unknown): void {
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }

  emitRaw(data: unknown): void {
    queueMicrotask(() => this.onmessage?.({ data }));
  }

  send(data: string): void {
    this.sentMessages.push(data);
    const value: unknown = JSON.parse(data);

    if (typeof value !== 'object' || value === null) {
      throw new Error('Fake WebSocket received an invalid message');
    }

    this.handleSentMessage(value as Record<string, unknown>, this);
  }
}

const createClient = (
  overrides: {
    createWebSocket?: (url: string) => FakeWebSocket;
    fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
    timeoutMilliseconds?: number;
  } = {},
) =>
  createHomeAssistantOAuthClient({
    clientId,
    redirectUri,
    ...overrides,
  });

describe('Home Assistant OAuth HTTP client', () => {
  it('builds the documented authorization URL from canonical origins', () => {
    const url = new URL(createClient().buildAuthorizationUrl(homeAssistantOrigin, oauthState));

    expect(url.origin).toBe(homeAssistantOrigin);
    expect(url.pathname).toBe('/auth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: clientId,
      redirect_uri: redirectUri,
      state: oauthState,
    });
  });

  it('rejects invalid client configuration and weak state values', () => {
    expect(() =>
      createHomeAssistantOAuthClient({
        clientId: 'https://aether.example.com/aether',
        redirectUri,
      }),
    ).toThrow('OAuth client ID must not contain');
    expect(() =>
      createHomeAssistantOAuthClient({
        clientId,
        redirectUri: 'https://other.example.com/api/v1/auth/callback',
      }),
    ).toThrow('must share the client ID origin');
    expect(() => createClient({ timeoutMilliseconds: 0 })).toThrow(
      'Home Assistant auth timeout must be a positive integer',
    );
    expect(() => createClient().buildAuthorizationUrl(homeAssistantOrigin, 'short')).toThrow(
      'OAuth state must contain at least 32 characters',
    );
  });

  it('exchanges an authorization code using a non-redirecting form POST', async () => {
    const requests: Array<{ init: RequestInit | undefined; url: string }> = [];
    const client = createClient({
      fetch: (input, init) => {
        requests.push({ init, url: input.toString() });
        return Promise.resolve(
          Response.json({
            access_token: 'access-token',
            expires_in: 1_800,
            refresh_token: 'refresh-token',
            token_type: 'Bearer',
          }),
        );
      },
    });

    await expect(
      client.exchangeAuthorizationCode(homeAssistantOrigin, 'authorization-code'),
    ).resolves.toEqual({
      accessToken: 'access-token',
      expiresInSeconds: 1_800,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`${homeAssistantOrigin}/auth/token`);
    expect(requests[0]?.init).toMatchObject({
      method: 'POST',
      redirect: 'error',
    });
    expect(requests[0]?.init?.headers).toEqual({
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
    });
    expect(Object.fromEntries(new URLSearchParams(String(requests[0]?.init?.body)))).toEqual({
      client_id: clientId,
      code: 'authorization-code',
      grant_type: 'authorization_code',
    });
  });

  it('refreshes and revokes tokens through their current endpoints', async () => {
    const requests: Array<{ body: string; url: string }> = [];
    const client = createClient({
      fetch: (input, init) => {
        requests.push({ body: String(init?.body), url: input.toString() });

        if (input.toString().endsWith('/auth/revoke')) {
          return Promise.resolve(new Response(null, { status: 200 }));
        }

        return Promise.resolve(
          Response.json({
            access_token: 'refreshed-access-token',
            expires_in: 1_800,
            token_type: 'Bearer',
          }),
        );
      },
    });

    await expect(
      client.refreshAccessToken(homeAssistantOrigin, 'existing-refresh-token'),
    ).resolves.toEqual({
      accessToken: 'refreshed-access-token',
      expiresInSeconds: 1_800,
      tokenType: 'Bearer',
    });
    await expect(
      client.revokeRefreshToken(homeAssistantOrigin, 'existing-refresh-token'),
    ).resolves.toBeUndefined();
    expect(requests.map(({ url }) => url)).toEqual([
      `${homeAssistantOrigin}/auth/token`,
      `${homeAssistantOrigin}/auth/revoke`,
    ]);
    expect(Object.fromEntries(new URLSearchParams(requests[0]?.body))).toEqual({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: 'existing-refresh-token',
    });
    expect(Object.fromEntries(new URLSearchParams(requests[1]?.body))).toEqual({
      token: 'existing-refresh-token',
    });
  });

  it('classifies rejected and invalid responses without exposing their bodies', async () => {
    const secretBody = 'response-body-that-must-not-appear';
    const rejectedClient = createClient({
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error_description: secretBody }), { status: 400 }),
        ),
    });

    await expect(
      rejectedClient.exchangeAuthorizationCode(homeAssistantOrigin, 'rejected-code'),
    ).rejects.toMatchObject({
      code: 'rejected',
      message: 'Home Assistant rejected the authentication request with status 400',
    });
    await expect(
      rejectedClient.exchangeAuthorizationCode(homeAssistantOrigin, 'rejected-code'),
    ).rejects.not.toHaveProperty('message', expect.stringContaining(secretBody));

    const invalidClient = createClient({
      fetch: () => Promise.resolve(Response.json({ access_token: secretBody })),
    });
    await expect(
      invalidClient.exchangeAuthorizationCode(homeAssistantOrigin, 'invalid-response-code'),
    ).rejects.toMatchObject({
      code: 'invalid_response',
      message: 'Home Assistant returned an invalid token response',
    });
  });

  it('bounds HTTP operations with the configured timeout', async () => {
    const client = createClient({
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), {
            once: true,
          });
        }),
      timeoutMilliseconds: 5,
    });

    await expect(
      client.exchangeAuthorizationCode(homeAssistantOrigin, 'authorization-code'),
    ).rejects.toMatchObject({
      code: 'timeout',
      message: 'Home Assistant authentication request timed out',
    });
  });
});

describe('Home Assistant current-user WebSocket client', () => {
  it('authenticates, requests the current user, and closes the socket', async () => {
    let socket: FakeWebSocket | undefined;
    const client = createClient({
      createWebSocket: (url) => {
        socket = new FakeWebSocket(url, (message, activeSocket) => {
          if (message['type'] === 'auth') {
            activeSocket.emit({ ha_version: '2026.8.0', type: 'auth_ok' });
            return;
          }

          activeSocket.emit({
            id: 1,
            result: {
              id: 'ha-user-id',
              is_admin: true,
              is_owner: false,
              name: 'Home Assistant User',
            },
            success: true,
            type: 'result',
          });
        });
        return socket;
      },
    });

    await expect(client.getCurrentUser(homeAssistantOrigin, 'access-token')).resolves.toEqual({
      displayName: 'Home Assistant User',
      id: 'ha-user-id',
      isActive: true,
      isAdmin: true,
      isOwner: false,
    });
    expect(socket?.url).toBe('ws://homeassistant.local:8123/api/websocket');
    expect(socket?.sentMessages.map((message) => JSON.parse(message))).toEqual([
      { access_token: 'access-token', type: 'auth' },
      { id: 1, type: 'auth/current_user' },
    ]);
    expect(socket?.closed).toBe(true);
  });

  it('uses WSS for trusted HTTPS and falls back to the user ID for an empty name', async () => {
    let socketUrl: string | undefined;
    const client = createClient({
      createWebSocket: (url) => {
        socketUrl = url;
        return new FakeWebSocket(url, (message, activeSocket) => {
          if (message['type'] === 'auth') {
            activeSocket.emit({ type: 'auth_ok' });
            return;
          }

          activeSocket.emit({
            id: 1,
            result: {
              id: 'fallback-user-id',
              is_admin: false,
              is_owner: false,
              name: null,
            },
            success: true,
            type: 'result',
          });
        });
      },
    });

    await expect(
      client.getCurrentUser('https://ha.example.com', 'access-token'),
    ).resolves.toMatchObject({
      displayName: 'fallback-user-id',
    });
    expect(socketUrl).toBe('wss://ha.example.com/api/websocket');
  });

  it('preserves a successful identity result when closing the socket fails', async () => {
    const client = createClient({
      createWebSocket: (url) => {
        const socket = new FakeWebSocket(url, (message, activeSocket) => {
          if (message['type'] === 'auth') {
            activeSocket.emit({ type: 'auth_ok' });
            return;
          }

          activeSocket.emit({
            id: 1,
            result: {
              id: 'ha-user-id',
              is_admin: true,
              is_owner: false,
              name: 'Home Assistant User',
            },
            success: true,
            type: 'result',
          });
        });
        socket.close = () => {
          throw new Error('socket close failed');
        };
        return socket;
      },
    });

    await expect(client.getCurrentUser(homeAssistantOrigin, 'access-token')).resolves.toMatchObject(
      {
        id: 'ha-user-id',
      },
    );
  });

  it('classifies an invalid access token without exposing it', async () => {
    const accessToken = 'access-token-that-must-not-appear';
    const client = createClient({
      createWebSocket: (url) =>
        new FakeWebSocket(url, (_message, activeSocket) => {
          activeSocket.emit({ message: accessToken, type: 'auth_invalid' });
        }),
    });

    let thrown: unknown;

    try {
      await client.getCurrentUser(homeAssistantOrigin, accessToken);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HomeAssistantAuthClientError);
    expect(thrown).toMatchObject({
      code: 'rejected',
      message: 'Home Assistant rejected the access token',
    });
    expect((thrown as Error).message).not.toContain(accessToken);
  });

  it('rejects malformed protocol messages and bounds silent sockets', async () => {
    const malformedClient = createClient({
      createWebSocket: (url) => {
        const socket = new FakeWebSocket(url, (_message, activeSocket) => {
          activeSocket.emitRaw(new Uint8Array([1, 2, 3]));
        });
        return socket;
      },
    });
    await expect(
      malformedClient.getCurrentUser(homeAssistantOrigin, 'access-token'),
    ).rejects.toMatchObject({
      code: 'invalid_response',
      message: 'Home Assistant returned a non-text WebSocket response',
    });

    const silentClient = createClient({
      createWebSocket: (url) => {
        const socket = new FakeWebSocket(url, () => undefined);
        socket.emit = () => undefined;
        return socket;
      },
      timeoutMilliseconds: 5,
    });
    await expect(
      silentClient.getCurrentUser(homeAssistantOrigin, 'access-token'),
    ).rejects.toMatchObject({
      code: 'timeout',
      message: 'Home Assistant identity request timed out',
    });
  });
});

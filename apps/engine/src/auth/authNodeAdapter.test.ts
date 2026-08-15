import { once } from 'node:events';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  maximumAuthJsonBodyBytes,
  type AuthHttpHandler,
  type AuthHttpRequest,
} from './authHttpHandler.ts';
import { createAuthNodeAdapter, readAuthNodeRequestBody } from './authNodeAdapter.ts';

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

const requestAdapter = async (
  handleRequest: AuthHttpHandler,
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  const adapter = createAuthNodeAdapter({ handleRequest });
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://aether.test').pathname;

    void adapter(request, response, pathname)
      .then((handled) => {
        if (!handled) {
          response.statusCode = 404;
          response.end('not handled');
        }
      })
      .catch(() => {
        if (!response.headersSent) {
          response.statusCode = 500;
          response.end('adapter failed');
        } else {
          response.destroy();
        }
      });
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  return fetch(`http://127.0.0.1:${port}${path}`, init);
};

describe('createAuthNodeAdapter', () => {
  it('leaves non-authentication paths untouched', async () => {
    const handleRequest = vi.fn<AuthHttpHandler>();
    const response = await requestAdapter(handleRequest, '/api/v1/installation/overview');

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('not handled');
    expect(handleRequest).not.toHaveBeenCalled();
  });

  it('normalizes a Node request and writes status, body, and multiple cookies', async () => {
    let capturedRequest: AuthHttpRequest | undefined;
    const handleRequest: AuthHttpHandler = vi.fn((request) => {
      capturedRequest = request;
      return Promise.resolve({
        body: JSON.stringify({ status: 'started' }),
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': ['first=value; Path=/', 'second=value; Path=/'],
        },
        statusCode: 201,
      });
    });
    const response = await requestAdapter(handleRequest, '/api/v1/auth/login?source=settings', {
      body: JSON.stringify({ returnPath: '/dashboard' }),
      headers: {
        'content-type': 'application/json',
        cookie: 'aether_session=session-value',
        origin: 'https://aether.example.com',
        'x-aether-csrf': 'csrf-value',
      },
      method: 'POST',
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ status: 'started' });
    expect(response.headers.getSetCookie()).toEqual([
      'first=value; Path=/',
      'second=value; Path=/',
    ]);
    expect(capturedRequest).toMatchObject({
      headers: {
        contentType: 'application/json',
        cookie: 'aether_session=session-value',
        csrfToken: 'csrf-value',
        origin: 'https://aether.example.com',
      },
      method: 'POST',
      pathname: '/api/v1/auth/login',
    });
    expect(Buffer.from(capturedRequest?.body ?? []).toString('utf8')).toBe(
      JSON.stringify({ returnPath: '/dashboard' }),
    );
    expect(capturedRequest?.searchParams?.get('source')).toBe('settings');
  });

  it('stores only the configured limit plus one overflow byte while draining a large body', async () => {
    let capturedBytes: number | undefined;
    const handleRequest: AuthHttpHandler = vi.fn((request) => {
      capturedBytes = request.body?.byteLength;
      return Promise.resolve({
        headers: { 'cache-control': 'no-store' },
        statusCode: 413,
      });
    });
    const response = await requestAdapter(handleRequest, '/api/v1/auth/login', {
      body: Buffer.alloc(maximumAuthJsonBodyBytes * 4, 120),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(413);
    expect(capturedBytes).toBe(maximumAuthJsonBodyBytes + 1);
  });
});

describe('readAuthNodeRequestBody', () => {
  it('rejects an aborted request without waiting for an end event', async () => {
    const stream = new PassThrough() as unknown as IncomingMessage;
    const reading = readAuthNodeRequestBody(stream);

    stream.emit('aborted');

    await expect(reading).rejects.toThrow('Auth HTTP request was aborted');
  });

  it('rejects an invalid body limit before attaching stream listeners', () => {
    const stream = new PassThrough() as unknown as IncomingMessage;

    expect(() => readAuthNodeRequestBody(stream, -1)).toThrow(
      'Auth HTTP request-body limit must be a non-negative safe integer',
    );
  });
});

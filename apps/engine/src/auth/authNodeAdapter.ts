import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  maximumAuthJsonBodyBytes,
  type AuthHttpHandler,
  type AuthHttpRequest,
  type AuthHttpResponse,
} from './authHttpHandler.ts';

const authApiPrefix = '/api/v1/auth';

type AuthNodeAdapterOptions = {
  handleRequest: AuthHttpHandler;
};

export type AuthNodeAdapter = (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
) => Promise<boolean>;

const isAuthApiPath = (pathname: string): boolean =>
  pathname === authApiPrefix || pathname.startsWith(`${authApiPrefix}/`);

const singleHeader = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

const requestSearchParams = (requestUrl: string): URLSearchParams => {
  const queryStart = requestUrl.indexOf('?');
  return new URLSearchParams(queryStart === -1 ? '' : requestUrl.slice(queryStart + 1));
};

export const writeAuthNodeResponse = (response: ServerResponse, result: AuthHttpResponse): void => {
  response.statusCode = result.statusCode;

  for (const [name, value] of Object.entries(result.headers)) {
    response.setHeader(name, typeof value === 'string' ? value : [...value]);
  }

  response.end(result.body);
};

export const readAuthNodeRequestBody = (
  request: IncomingMessage,
  maximumBytes = maximumAuthJsonBodyBytes,
): Promise<Uint8Array> => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new Error('Auth HTTP request-body limit must be a non-negative safe integer');
  }

  if (request.aborted) {
    return Promise.reject(new Error('Auth HTTP request was aborted'));
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const maximumStoredBytes = maximumBytes + 1;
    let storedBytes = 0;
    let settled = false;

    const cleanup = (): void => {
      request.off('aborted', onAborted);
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
    };

    const settle = (
      result: { body: Uint8Array; status: 'resolved' } | { error: Error; status: 'rejected' },
    ): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      if (result.status === 'resolved') {
        resolve(result.body);
      } else {
        reject(result.error);
      }
    };

    const onAborted = (): void => {
      settle({ error: new Error('Auth HTTP request was aborted'), status: 'rejected' });
    };

    const onData = (chunk: unknown): void => {
      if (storedBytes >= maximumStoredBytes) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      const storedChunk = buffer.subarray(0, maximumStoredBytes - storedBytes);
      chunks.push(storedChunk);
      storedBytes += storedChunk.byteLength;
    };

    const onEnd = (): void => {
      settle({
        body: Buffer.concat(chunks, storedBytes),
        status: 'resolved',
      });
    };

    const onError = (): void => {
      settle({ error: new Error('Auth HTTP request body could not be read'), status: 'rejected' });
    };

    request.on('aborted', onAborted);
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
  });
};

export const createAuthNodeAdapter =
  (options: AuthNodeAdapterOptions): AuthNodeAdapter =>
  async (request, response, pathname) => {
    if (!isAuthApiPath(pathname)) {
      return false;
    }

    const method = request.method ?? 'GET';
    let body: Uint8Array | undefined;

    if (method === 'POST') {
      body = await readAuthNodeRequestBody(request);
    } else {
      request.resume();
    }

    const contentType = singleHeader(request.headers['content-type']);
    const cookie = singleHeader(request.headers['cookie']);
    const csrfToken = singleHeader(request.headers['x-aether-csrf']);
    const origin = singleHeader(request.headers['origin']);
    const authRequest: AuthHttpRequest = {
      headers: {
        ...(contentType === undefined ? {} : { contentType }),
        ...(cookie === undefined ? {} : { cookie }),
        ...(csrfToken === undefined ? {} : { csrfToken }),
        ...(origin === undefined ? {} : { origin }),
      },
      method,
      pathname,
      searchParams: requestSearchParams(request.url ?? '/'),
      ...(body === undefined ? {} : { body }),
    };
    const result = await options.handleRequest(authRequest);

    if (result === undefined) {
      return false;
    }

    writeAuthNodeResponse(response, result);
    return true;
  };

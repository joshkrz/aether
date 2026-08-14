import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseRequestPath,
  resolveGeneratedWebRoot,
  serveGeneratedWebApp,
} from './serveGeneratedWebApp.ts';

const withWebFixture = async (run: (webRoot: string) => Promise<void>): Promise<void> => {
  const webRoot = await mkdtemp(join(tmpdir(), 'aether-generated-web-'));

  try {
    await mkdir(join(webRoot, '_nuxt'));
    await writeFile(join(webRoot, 'index.html'), '<main>Aether</main>');
    await writeFile(join(webRoot, '_nuxt', 'app.js'), 'globalThis.aether = true;');
    await writeFile(join(webRoot, '_nuxt', 'app.css'), 'body { color: green; }');
    await run(webRoot);
  } finally {
    await rm(webRoot, { force: true, recursive: true });
  }
};

const requestStatic = async (
  webRoot: string,
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  const server = createServer((request, response) => {
    const requestPath = parseRequestPath(request.url ?? '/');

    if (!requestPath.success) {
      response.statusCode = 400;
      response.end();
      return;
    }

    void serveGeneratedWebApp({
      method: request.method ?? 'GET',
      pathname: requestPath.pathname,
      response,
      webRoot,
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const { port } = server.address() as AddressInfo;

  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, init);
  } finally {
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolvePromise();
          return;
        }

        reject(error);
      });
    });
  }
};

describe('serveGeneratedWebApp', () => {
  it('serves the generated index without caching it', async () => {
    await withWebFixture(async (webRoot) => {
      const response = await requestStatic(webRoot, '/');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      await expect(response.text()).resolves.toBe('<main>Aether</main>');
    });
  });

  it('falls back to the generated index for a client-side route', async () => {
    await withWebFixture(async (webRoot) => {
      const response = await requestStatic(webRoot, '/rooms/bedroom');

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-cache');
      await expect(response.text()).resolves.toBe('<main>Aether</main>');
    });
  });

  it('serves generated JavaScript and CSS with immutable caching', async () => {
    await withWebFixture(async (webRoot) => {
      const [scriptResponse, styleResponse] = await Promise.all([
        requestStatic(webRoot, '/_nuxt/app.js'),
        requestStatic(webRoot, '/_nuxt/app.css'),
      ]);

      expect(scriptResponse.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect(styleResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
      expect(scriptResponse.headers.get('cache-control')).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(styleResponse.headers.get('cache-control')).toBe(
        'public, max-age=31536000, immutable',
      );
    });
  });

  it('supports HEAD without returning a response body', async () => {
    await withWebFixture(async (webRoot) => {
      const response = await requestStatic(webRoot, '/_nuxt/app.js', { method: 'HEAD' });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-length')).toBe('25');
      await expect(response.text()).resolves.toBe('');
    });
  });

  it('returns a real not-found response for a missing generated asset', async () => {
    await withWebFixture(async (webRoot) => {
      const response = await requestStatic(webRoot, '/_nuxt/missing.js');

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe('Not found');
    });
  });

  it('rejects unsupported methods and advertises GET and HEAD', async () => {
    await withWebFixture(async (webRoot) => {
      const response = await requestStatic(webRoot, '/', { method: 'POST' });

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET, HEAD');
    });
  });

  it('rejects encoded traversal and malformed URL encoding', () => {
    expect(parseRequestPath('/%2e%2e/%2e%2e/secret')).toEqual({ success: false });
    expect(parseRequestPath('/%E0%A4%A')).toEqual({ success: false });
  });

  it('resolves a readable generated web root and rejects an incomplete one', async () => {
    await withWebFixture(async (webRoot) => {
      await expect(resolveGeneratedWebRoot(webRoot)).resolves.toBe(webRoot);
      await expect(resolveGeneratedWebRoot(join(webRoot, 'missing'))).rejects.toThrow(
        'AETHER_WEB_ROOT must point to readable generated web assets',
      );
    });
  });
});

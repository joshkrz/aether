import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { createEngineServer } from './createEngineServer.ts';
import type { InstallationOverviewProvider } from './installationOverviewProvider.ts';

const requestEngine = async (
  getInstallationOverview: InstallationOverviewProvider,
  path = '/api/v1/installation/overview',
  init?: RequestInit,
): Promise<Response> => {
  const server = createEngineServer(getInstallationOverview);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const { port } = server.address() as AddressInfo;

  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, init);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolve();
          return;
        }

        reject(error);
      });
    });
  }
};

describe('createEngineServer', () => {
  it('returns the not-configured overview through the real HTTP server', async () => {
    const response = await requestEngine(() => ({ status: 'not_configured' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    await expect(response.json()).resolves.toEqual({ status: 'not_configured' });
  });

  it('returns a valid configured overview', async () => {
    const overview = {
      status: 'configured',
      installation: {
        id: 'installation-home',
        name: 'Home',
        timeZone: 'Europe/London',
        displayTemperatureUnit: 'celsius',
      },
      counts: {
        rooms: 4,
        climateControllers: 5,
        plants: 2,
        energySources: 2,
        schedules: 3,
      },
      topology: {
        valid: true,
        errorCount: 0,
        warningCount: 1,
      },
    } as const;

    const response = await requestEngine(() => overview);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(overview);
  });

  it('rejects provider output that violates the shared contract', async () => {
    const response = await requestEngine(() => ({
      status: 'configured',
      counts: {
        rooms: -1,
      },
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'invalid_installation_overview',
      },
    });
  });

  it('does not expose errors thrown by the provider', async () => {
    const response = await requestEngine(() => {
      throw new Error('database password must not appear in the response');
    });

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.not.toContain('database password');
  });

  it('returns not found for an unknown path without calling the provider', async () => {
    let providerWasCalled = false;
    const response = await requestEngine(() => {
      providerWasCalled = true;
      return { status: 'not_configured' };
    }, '/unknown');

    expect(response.status).toBe(404);
    expect(providerWasCalled).toBe(false);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'not_found',
      },
    });
  });

  it('rejects unsupported methods and advertises GET', async () => {
    const response = await requestEngine(
      () => ({ status: 'not_configured' }),
      '/api/v1/installation/overview',
      { method: 'POST' },
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'method_not_allowed',
      },
    });
  });
});

import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import { InstallationSchema } from '@aether/core';

import type { AuthHttpBoundary } from './auth/authHttpHandler.ts';
import { createEngineServer, type EngineServerOptions } from './createEngineServer.ts';
import type { InstallationOverviewProvider } from './installationOverviewProvider.ts';

const authenticatedSession = {
  createdAtEpochSeconds: 1_000,
  displayName: 'Aether User',
  expiresAtEpochSeconds: 2_000,
  homeAssistantUserId: 'ha-user',
  isAdmin: false,
  isOwner: false,
  lastUsedAtEpochSeconds: 1_000,
};

const createTestAuth = (overrides: Partial<AuthHttpBoundary> = {}): AuthHttpBoundary => ({
  authenticateReadRequest: () =>
    Promise.resolve({ session: authenticatedSession, status: 'authenticated' }),
  authenticateMutationRequest: () =>
    Promise.resolve({ session: authenticatedSession, status: 'authenticated' }),
  handleRequest: () => Promise.resolve(undefined),
  ...overrides,
});

const requestEngine = async (
  getInstallationOverview: InstallationOverviewProvider,
  path = '/api/v1/installation/overview',
  init?: RequestInit,
  webRoot?: string,
  auth = createTestAuth(),
  installationRepository: EngineServerOptions['installationRepository'] = {
    loadInstallationWithRevision: () => undefined,
    saveInstallation: () => ({ status: 'conflict' }),
  },
  getClimateEntities: EngineServerOptions['getClimateEntities'] = () =>
    Promise.resolve({ entities: [] }),
): Promise<Response> => {
  const server = createEngineServer(
    webRoot === undefined
      ? { auth, getClimateEntities, getInstallationOverview, installationRepository }
      : { auth, getClimateEntities, getInstallationOverview, installationRepository, webRoot },
  );
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
  it('limits climate discovery to authenticated administrators and discloses no credentials', async () => {
    const path = '/api/v1/home-assistant/climate-entities';
    const getClimateEntities = vi.fn(() => Promise.resolve({ entities: [] }));
    const unauthenticated = await requestEngine(
      () => ({ status: 'not_configured' }),
      path,
      undefined,
      undefined,
      createTestAuth({
        authenticateReadRequest: () =>
          Promise.resolve({
            status: 'rejected',
            response: {
              statusCode: 401,
              headers: { 'content-type': 'application/json; charset=utf-8' },
              body: JSON.stringify({ error: { code: 'unauthenticated' } }),
            },
          }),
      }),
      undefined,
      getClimateEntities,
    );
    expect(unauthenticated.status).toBe(401);
    expect(getClimateEntities).not.toHaveBeenCalled();

    const guest = await requestEngine(
      () => ({ status: 'not_configured' }),
      path,
      undefined,
      undefined,
      createTestAuth(),
      undefined,
      getClimateEntities,
    );
    expect(guest.status).toBe(403);
    expect(getClimateEntities).not.toHaveBeenCalled();

    const adminAuth = createTestAuth({
      authenticateReadRequest: () =>
        Promise.resolve({
          status: 'authenticated',
          session: { ...authenticatedSession, isAdmin: true },
        }),
    });
    const admin = await requestEngine(
      () => ({ status: 'not_configured' }),
      path,
      undefined,
      undefined,
      adminAuth,
      undefined,
      getClimateEntities,
    );
    expect(admin.status).toBe(200);
    await expect(admin.json()).resolves.toEqual({ entities: [] });
    expect(getClimateEntities).toHaveBeenCalledTimes(1);
  });

  it('serves liveness health without authentication or application dependencies', async () => {
    let authWasCalled = false;
    let providerWasCalled = false;
    const response = await requestEngine(
      () => {
        providerWasCalled = true;
        return { status: 'not_configured' };
      },
      '/api/v1/health',
      undefined,
      undefined,
      createTestAuth({
        authenticateReadRequest: () => {
          authWasCalled = true;
          return Promise.reject(new Error('Health must not authenticate'));
        },
        handleRequest: () => {
          authWasCalled = true;
          return Promise.reject(new Error('Health must not enter auth routing'));
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
    expect(authWasCalled).toBe(false);
    expect(providerWasCalled).toBe(false);
  });

  it('delegates authentication API requests through the Node bridge', async () => {
    const response = await requestEngine(
      () => ({ status: 'not_configured' }),
      '/api/v1/auth/status',
      undefined,
      undefined,
      createTestAuth({
        handleRequest: (request) =>
          Promise.resolve({
            body: JSON.stringify({ status: 'setup_required' }),
            headers: {
              'cache-control': 'no-store',
              'content-type': 'application/json; charset=utf-8',
            },
            statusCode: request.pathname === '/api/v1/auth/status' ? 200 : 500,
          }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'setup_required' });
  });

  it('rejects installation overview without an authenticated session', async () => {
    let providerWasCalled = false;
    const response = await requestEngine(
      () => {
        providerWasCalled = true;
        return { status: 'not_configured' };
      },
      '/api/v1/installation/overview',
      undefined,
      undefined,
      createTestAuth({
        authenticateReadRequest: () =>
          Promise.resolve({
            response: {
              body: JSON.stringify({ error: { code: 'unauthenticated' } }),
              headers: {
                'cache-control': 'no-store',
                'content-type': 'application/json; charset=utf-8',
              },
              statusCode: 401,
            },
            status: 'rejected',
          }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'unauthenticated' } });
    expect(providerWasCalled).toBe(false);
  });

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

  it('reserves unknown API paths for JSON when web serving is configured', async () => {
    const response = await requestEngine(
      () => ({ status: 'not_configured' }),
      '/api/v1/unknown',
      undefined,
      '/web-root-that-must-not-be-read',
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
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

  it('routes whole-installation GET and PUT through the HTTP server', async () => {
    const installation = InstallationSchema.parse({
      id: 'installation-home',
      name: 'Home',
      timeZone: 'Europe/London',
      displayTemperatureUnit: 'celsius',
      safety: {
        minimumTargetTemperatureCelsius: 5,
        maximumTargetTemperatureCelsius: 35,
        maximumTelemetryAgeSeconds: 300,
        minimumCommandIntervalSeconds: 60,
        commandAcknowledgementTimeoutSeconds: 30,
      },
      zones: [],
      rooms: [],
      climateControllers: [],
      plants: [],
      energySources: [],
      schedules: [],
      scheduleSelection: {},
    });
    const saveInstallation = vi.fn(() => ({
      status: 'saved' as const,
      installation,
      revision: 1,
    }));
    const repository = {
      loadInstallationWithRevision: () => undefined,
      saveInstallation,
    };
    const adminAuth = createTestAuth({
      authenticateMutationRequest: () =>
        Promise.resolve({
          status: 'authenticated',
          session: { ...authenticatedSession, isAdmin: true },
        }),
    });
    const path = '/api/v1/installation/configuration';
    const getResponse = await requestEngine(
      () => ({ status: 'not_configured' }),
      path,
      undefined,
      undefined,
      adminAuth,
      repository,
    );

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual({ status: 'not_configured', revision: 0 });

    const putResponse = await requestEngine(
      () => ({ status: 'not_configured' }),
      path,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          origin: 'https://aether.example.com',
          'x-aether-csrf': 'csrf',
        },
        body: JSON.stringify({ revision: 0, installation }),
      },
      undefined,
      adminAuth,
      repository,
    );

    expect(putResponse.status).toBe(200);
    expect(saveInstallation).toHaveBeenCalledWith(installation, 0);
    await expect(putResponse.json()).resolves.toEqual({
      status: 'configured',
      revision: 1,
      installation,
      topology: { valid: true, issues: [] },
    });
  });
});

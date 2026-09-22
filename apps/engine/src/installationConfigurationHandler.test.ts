import { describe, expect, it, vi } from 'vitest';

import { InstallationSchema, type Installation } from '@aether/core';

import type { AuthHttpBoundary, AuthHttpRequest } from './auth/authHttpHandler.ts';
import type { InstallationRepository } from './database/installationRepository.ts';
import { createInstallationConfigurationHandler } from './installationConfigurationHandler.ts';

const installation: Installation = InstallationSchema.parse({
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

const session = {
  createdAtEpochSeconds: 1,
  displayName: 'Admin',
  expiresAtEpochSeconds: 2,
  homeAssistantUserId: 'admin',
  isAdmin: true,
  isOwner: true,
  lastUsedAtEpochSeconds: 1,
};

const rejected = {
  status: 'rejected' as const,
  response: { statusCode: 401, headers: {}, body: '{"error":{"code":"unauthenticated"}}' },
};

const auth = (overrides: Partial<AuthHttpBoundary> = {}): AuthHttpBoundary => ({
  authenticateReadRequest: () => Promise.resolve({ status: 'authenticated', session }),
  authenticateMutationRequest: () => Promise.resolve({ status: 'authenticated', session }),
  handleRequest: () => Promise.resolve(undefined),
  ...overrides,
});

const request = (method: string, value?: unknown): AuthHttpRequest => ({
  method,
  pathname: '/api/v1/installation/configuration',
  headers: {
    contentType: 'application/json',
    cookie: 'cookie',
    csrfToken: 'csrf',
    origin: 'origin',
  },
  ...(value === undefined ? {} : { body: Buffer.from(JSON.stringify(value)) }),
});

const responseBody = (value: { body?: string }): unknown => JSON.parse(value.body ?? 'null');

describe('installation configuration API handler', () => {
  it('requires a session for reads and returns the revision and topology', async () => {
    const loadInstallationWithRevision = vi.fn(() => ({ installation, revision: 3 }));
    const saveInstallation = vi.fn();
    const handler = createInstallationConfigurationHandler(
      auth({ authenticateReadRequest: () => Promise.resolve(rejected) }),
      { loadInstallationWithRevision, saveInstallation },
    );

    expect((await handler(request('GET'))).statusCode).toBe(401);
    expect(loadInstallationWithRevision).not.toHaveBeenCalled();

    const allowed = createInstallationConfigurationHandler(auth(), {
      loadInstallationWithRevision,
      saveInstallation,
    });
    const response = await allowed(request('GET'));

    expect(response.statusCode).toBe(200);
    expect(responseBody(response)).toEqual({
      status: 'configured',
      revision: 3,
      installation,
      topology: { valid: true, issues: [] },
    });
  });

  it('permits an administrator to create an installation and save missing-reference drafts', async () => {
    const saveInstallation = vi.fn((input: Installation) => ({
      status: 'saved' as const,
      installation: input,
      revision: 1,
    }));
    const handler = createInstallationConfigurationHandler(auth(), {
      loadInstallationWithRevision: () => undefined,
      saveInstallation,
    });
    const response = await handler(
      request('PUT', {
        revision: 0,
        installation: {
          ...installation,
          rooms: [{ id: 'bedroom', name: 'Bedroom', zoneId: 'later' }],
        },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(saveInstallation).toHaveBeenCalledOnce();
    expect(saveInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ rooms: [{ id: 'bedroom', name: 'Bedroom', zoneId: 'later' }] }),
      0,
    );
    expect(responseBody(response)).toMatchObject({
      topology: {
        valid: false,
        issues: [{ code: 'missing_zone_reference', severity: 'error' }],
      },
    });
  });

  it('rejects unauthenticated and non-admin writes before saving', async () => {
    const saveInstallation = vi.fn();
    const repository = { loadInstallationWithRevision: () => undefined, saveInstallation };
    const unauthenticated = createInstallationConfigurationHandler(
      auth({ authenticateMutationRequest: () => Promise.resolve(rejected) }),
      repository,
    );
    const nonAdmin = createInstallationConfigurationHandler(
      auth({
        authenticateMutationRequest: () =>
          Promise.resolve({ status: 'authenticated', session: { ...session, isAdmin: false } }),
      }),
      repository,
    );

    expect((await unauthenticated(request('PUT', { revision: 0, installation }))).statusCode).toBe(
      401,
    );
    expect((await nonAdmin(request('PUT', { revision: 0, installation }))).statusCode).toBe(403);
    expect(saveInstallation).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON, schema errors, duplicates, and stale revisions', async () => {
    const saveInstallation = vi.fn<InstallationRepository['saveInstallation']>(() => ({
      status: 'conflict',
    }));
    const handler = createInstallationConfigurationHandler(auth(), {
      loadInstallationWithRevision: () => undefined,
      saveInstallation,
    });

    expect((await handler({ ...request('PUT'), body: Buffer.from('{') })).statusCode).toBe(400);
    expect((await handler(request('PUT', { revision: 0, installation: {} }))).statusCode).toBe(422);
    expect(
      (
        await handler(
          request('PUT', {
            revision: 0,
            installation: {
              ...installation,
              zones: [
                { id: 'same', name: 'First' },
                { id: 'same', name: 'Second' },
              ],
            },
          }),
        )
      ).statusCode,
    ).toBe(422);
    expect(saveInstallation).not.toHaveBeenCalled();
    expect((await handler(request('PUT', { revision: 0, installation }))).statusCode).toBe(409);
  });
});

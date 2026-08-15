import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDatabase } from '../database/createDatabase.ts';
import { databaseMigrations } from '../database/migrations.ts';
import { runMigrations } from '../database/runMigrations.ts';
import { homeAssistantConnectionTable } from '../database/schema.ts';
import type { AuthRuntimeConfig } from './authRuntimeConfig.ts';
import { createAuthRuntime } from './authRuntime.ts';

const temporaryDirectories: string[] = [];
const databases: Array<ReturnType<typeof createDatabase>> = [];

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
  }

  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

const createHarness = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aether-auth-runtime-'));
  temporaryDirectories.push(directory);
  const database = createDatabase(':memory:');
  databases.push(database);
  runMigrations(database.client, databaseMigrations);
  const config = {
    allowInsecureHttp: false,
    authKeyPath: join(directory, 'aether-auth.key'),
    oauthCallbackUrl: 'https://aether.example.com/api/v1/auth/callback',
    publicOrigin: 'https://aether.example.com',
    secureCookies: true,
  } satisfies AuthRuntimeConfig;

  return { config, database };
};

describe('createAuthRuntime', () => {
  it('generates and reports a fresh in-memory code on each incomplete startup', async () => {
    const { config, database } = await createHarness();
    const firstCode = vi.fn();
    const secondCode = vi.fn();
    const first = createAuthRuntime({
      config,
      database,
      onInitialSetupCode: firstCode,
      onWarning: () => undefined,
    });
    const second = createAuthRuntime({
      config,
      database,
      onInitialSetupCode: secondCode,
      onWarning: () => undefined,
    });

    expect(firstCode).toHaveBeenCalledOnce();
    expect(secondCode).toHaveBeenCalledOnce();
    expect(firstCode.mock.calls[0]?.[0]).toMatch(/^[\w-]{43}$/u);
    expect(secondCode.mock.calls[0]?.[0]).toMatch(/^[\w-]{43}$/u);
    expect(secondCode.mock.calls[0]?.[0]).not.toBe(firstCode.mock.calls[0]?.[0]);
    await expect(
      first.boundary.handleRequest({
        headers: {},
        method: 'GET',
        pathname: '/api/v1/auth/status',
      }),
    ).resolves.toMatchObject({ body: JSON.stringify({ status: 'setup_required' }) });
    expect(second.boundary).toBeDefined();
  });

  it('does not generate or report a setup code after the engine connection is complete', async () => {
    const { config, database } = await createHarness();
    database.query
      .insert(homeAssistantConnectionTable)
      .values({
        connectedAtEpochSeconds: 1_001,
        createdAtEpochSeconds: 1_000,
        origin: 'http://homeassistant.local:8123',
        singletonKey: 1,
        updatedAtEpochSeconds: 1_001,
      })
      .run();
    const onInitialSetupCode = vi.fn();
    const runtime = createAuthRuntime({
      config,
      database,
      onInitialSetupCode,
      onWarning: () => undefined,
    });

    expect(onInitialSetupCode).not.toHaveBeenCalled();
    await expect(
      runtime.boundary.handleRequest({
        headers: {},
        method: 'GET',
        pathname: '/api/v1/auth/status',
      }),
    ).resolves.toMatchObject({ body: JSON.stringify({ status: 'unauthenticated' }) });
  });
});

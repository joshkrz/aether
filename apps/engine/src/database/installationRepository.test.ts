import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { InstallationSchema } from '@aether/core';

import { createDatabase } from './createDatabase.ts';
import {
  createInstallationRepository,
  type InstallationSettings,
} from './installationRepository.ts';
import { databaseMigrations } from './migrations.ts';
import { runMigrations } from './runMigrations.ts';

const temporaryDirectories: string[] = [];

const createTemporaryDatabasePath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'aether-repository-'));
  temporaryDirectories.push(directory);
  return join(directory, 'aether.sqlite');
};

const validSettings = (): InstallationSettings => {
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
    rooms: [],
    climateControllers: [],
    plants: [],
    energySources: [],
    schedules: [],
    roomControllerLinks: [],
    roomScheduleLinks: [],
    roomScheduleSelections: [],
  });

  return {
    id: installation.id,
    name: installation.name,
    timeZone: installation.timeZone,
    displayTemperatureUnit: installation.displayTemperatureUnit,
    safety: installation.safety,
  };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('createInstallationRepository', () => {
  it('returns undefined when the installation is not configured', () => {
    const database = createDatabase(':memory:');
    runMigrations(database.client, databaseMigrations);
    const repository = createInstallationRepository(database.query);

    expect(repository.loadInstallation()).toBeUndefined();

    database.close();
  });

  it('persists an empty installation across database reopen', () => {
    const path = createTemporaryDatabasePath();
    const firstDatabase = createDatabase(path);
    runMigrations(firstDatabase.client, databaseMigrations);
    const savedInstallation = createInstallationRepository(
      firstDatabase.query,
    ).saveInstallationSettings(validSettings());
    firstDatabase.close();

    const reopenedDatabase = createDatabase(path);
    runMigrations(reopenedDatabase.client, databaseMigrations);
    const loadedInstallation = createInstallationRepository(
      reopenedDatabase.query,
    ).loadInstallation();

    expect(loadedInstallation).toEqual(savedInstallation);

    reopenedDatabase.close();
  });

  it('updates the singleton installation without creating another row', () => {
    const database = createDatabase(':memory:');
    runMigrations(database.client, databaseMigrations);
    const repository = createInstallationRepository(database.query);

    repository.saveInstallationSettings(validSettings());
    repository.saveInstallationSettings({
      ...validSettings(),
      name: 'Updated Home',
    });

    expect(repository.loadInstallation()?.name).toBe('Updated Home');
    expect(
      (
        database.client.prepare('SELECT count(*) AS count FROM installation').get() as
          { count: number } | undefined
      )?.count,
    ).toBe(1);

    database.close();
  });

  it('validates settings before writing them', () => {
    const database = createDatabase(':memory:');
    runMigrations(database.client, databaseMigrations);
    const repository = createInstallationRepository(database.query);

    expect(() =>
      repository.saveInstallationSettings({
        ...validSettings(),
        name: '  ',
      }),
    ).toThrow();
    expect(repository.loadInstallation()).toBeUndefined();

    database.close();
  });
});

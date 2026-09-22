import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { InstallationSchema, validateInstallationTopology } from '@aether/core';

import { createDatabase } from './createDatabase.ts';
import {
  createInstallationRepository,
  type InstallationConfiguration,
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
    zones: [],
    rooms: [],
    climateControllers: [],
    plants: [],
    energySources: [],
    schedules: [],
    scheduleSelection: {},
  });

  return {
    id: installation.id,
    name: installation.name,
    timeZone: installation.timeZone,
    displayTemperatureUnit: installation.displayTemperatureUnit,
    safety: installation.safety,
  };
};

const emptyDays = {
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

const sampleConfiguration = (): InstallationConfiguration => {
  const installation = InstallationSchema.parse({
    ...validSettings(),
    energySources: [
      {
        id: 'energy-electricity',
        name: 'Electricity',
        type: 'electricity',
        tariffEntityId: 'sensor.electricity_tariff',
        fixedUnitCost: 0.25,
      },
    ],
    plants: [
      {
        id: 'plant-hvac',
        name: 'HVAC',
        type: 'hvac',
        energySourceId: 'energy-electricity',
        constraints: { supportedModes: ['heat', 'cool'], allowMixedHeatCool: false },
        efficiencyModel: { type: 'fixed', heatingPerformanceFactor: 3.5 },
      },
    ],
    zones: [
      { id: 'zone-upstairs', name: 'Upstairs' },
      { id: 'zone-downstairs', name: 'Downstairs' },
    ],
    rooms: [
      {
        id: 'room-bedroom',
        name: 'Bedroom',
        zoneId: 'zone-upstairs',
        temperatureEntityId: 'sensor.bedroom_temperature',
        windowOrDoorEntityIds: ['binary_sensor.bedroom_window'],
        windows: [{ id: 'window-bedroom', azimuth: 180, area: 2.2 }],
      },
      { id: 'room-office', name: 'Office' },
    ],
    climateControllers: [
      {
        id: 'controller-upstairs-heat',
        name: 'Upstairs heating',
        entityId: 'climate.upstairs_heat',
        location: { type: 'zone', zoneId: 'zone-upstairs' },
        plantId: 'plant-hvac',
        capabilities: { heat: true, cool: false, off: true },
        controlProfile: { heatingMode: 'heat', offMode: 'off' },
        manualOverridePolicy: { type: 'until_next_schedule_block' },
      },
      {
        id: 'controller-bedroom-ac',
        name: 'Bedroom AC',
        entityId: 'climate.bedroom_ac',
        location: { type: 'room', roomId: 'room-bedroom' },
        plantId: 'plant-hvac',
        capabilities: { heat: true, cool: true, off: true },
        controlProfile: { heatingMode: 'heat', coolingMode: 'cool', offMode: 'off' },
        manualOverridePolicy: { type: 'until_next_schedule_block' },
      },
    ],
    schedules: [
      {
        id: 'schedule-home',
        name: 'Home',
        days: {
          ...emptyDays,
          monday: [
            {
              id: 'block-upstairs',
              location: { type: 'zone', zoneId: 'zone-upstairs' },
              controllerId: 'controller-upstairs-heat',
              startMinute: 420,
              endMinute: 600,
              settings: { hvacMode: 'heat', targetTemperatureCelsius: 20 },
            },
            {
              id: 'block-bedroom',
              location: { type: 'room', roomId: 'room-bedroom' },
              controllerId: 'controller-bedroom-ac',
              startMinute: 480,
              endMinute: 540,
              settings: { hvacMode: 'cool', targetTemperatureCelsius: 22, fanMode: 'quiet' },
            },
          ],
          tuesday: [
            {
              id: 'block-bedroom-tuesday',
              location: { type: 'room', roomId: 'room-bedroom' },
              controllerId: 'controller-bedroom-ac',
              startMinute: 540,
              endMinute: 600,
              settings: { hvacMode: 'cool', targetTemperatureCelsius: 23 },
            },
          ],
        },
      },
      { id: 'schedule-away', name: 'Away', days: emptyDays },
    ],
    scheduleSelection: {
      mainScheduleId: 'schedule-home',
      overrideScheduleId: 'schedule-away',
    },
  });

  return {
    zones: installation.zones,
    rooms: installation.rooms,
    climateControllers: installation.climateControllers,
    plants: installation.plants,
    energySources: installation.energySources,
    schedules: installation.schedules,
    scheduleSelection: installation.scheduleSelection,
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

  it('persists a complete configuration across database reopen', () => {
    const path = createTemporaryDatabasePath();
    const firstDatabase = createDatabase(path);
    runMigrations(firstDatabase.client, databaseMigrations);
    const firstRepository = createInstallationRepository(firstDatabase.query);
    firstRepository.saveInstallationSettings(validSettings());
    const saved = firstRepository.saveInstallationConfiguration(sampleConfiguration());
    firstDatabase.close();

    const reopenedDatabase = createDatabase(path);
    runMigrations(reopenedDatabase.client, databaseMigrations);
    const loaded = createInstallationRepository(reopenedDatabase.query).loadInstallation();

    expect(loaded).toEqual(saved);
    expect(loaded?.schedules[0]?.days.monday).toHaveLength(2);
    expect(validateInstallationTopology(saved).valid).toBe(true);

    reopenedDatabase.close();
  });

  it('preserves configuration when installation settings change', () => {
    const database = createDatabase(':memory:');
    runMigrations(database.client, databaseMigrations);
    const repository = createInstallationRepository(database.query);
    repository.saveInstallationSettings(validSettings());
    const configured = repository.saveInstallationConfiguration(sampleConfiguration());

    const updated = repository.saveInstallationSettings({ ...validSettings(), name: 'New name' });

    expect(updated.name).toBe('New name');
    expect(updated.schedules).toEqual(configured.schedules);
    expect(updated.climateControllers).toEqual(configured.climateControllers);
    expect(repository.loadInstallation()).toEqual(updated);

    database.close();
  });

  it('replaces configuration atomically and accepts unresolved draft references', () => {
    const database = createDatabase(':memory:');
    runMigrations(database.client, databaseMigrations);
    const repository = createInstallationRepository(database.query);
    repository.saveInstallationSettings(validSettings());
    repository.saveInstallationConfiguration(sampleConfiguration());

    const draft = sampleConfiguration();
    const saved = repository.saveInstallationConfiguration({
      ...draft,
      rooms: draft.rooms.map((room) =>
        room.id === 'room-bedroom'
          ? { ...room, zoneId: 'zone-not-yet-added' as typeof room.zoneId }
          : room,
      ),
      schedules: [],
      scheduleSelection: draft.scheduleSelection,
    });

    expect(saved.schedules).toEqual([]);
    expect(validateInstallationTopology(saved).issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['missing_zone_reference', 'missing_schedule_reference']),
    );
    expect(repository.loadInstallation()).toEqual(saved);
    expect(
      (
        database.client
          .prepare('SELECT count(*) AS count FROM installation_schedule_block')
          .get() as { count: number } | undefined
      )?.count,
    ).toBe(0);

    database.close();
  });

  it('rolls back a failed replacement without losing prior configuration', () => {
    const database = createDatabase(':memory:');
    runMigrations(database.client, databaseMigrations);
    const repository = createInstallationRepository(database.query);
    repository.saveInstallationSettings(validSettings());
    const saved = repository.saveInstallationConfiguration(sampleConfiguration());
    const duplicate = sampleConfiguration();
    const firstController = duplicate.climateControllers[0];
    const secondController = duplicate.climateControllers[1];

    if (firstController === undefined || secondController === undefined) {
      throw new Error('Test fixture requires two controllers');
    }

    expect(() =>
      repository.saveInstallationConfiguration({
        ...duplicate,
        climateControllers: [
          firstController,
          { ...secondController, entityId: firstController.entityId },
        ],
      }),
    ).toThrow();
    expect(repository.loadInstallation()).toEqual(saved);

    database.close();
  });

  it('requires installation settings and rejects malformed configuration before writing', () => {
    const database = createDatabase(':memory:');
    runMigrations(database.client, databaseMigrations);
    const repository = createInstallationRepository(database.query);
    const configuration = sampleConfiguration();

    expect(() => repository.saveInstallationConfiguration(configuration)).toThrow(
      'Save installation settings before configuration',
    );

    repository.saveInstallationSettings(validSettings());
    const saved = repository.saveInstallationConfiguration(configuration);

    expect(() =>
      repository.saveInstallationConfiguration({
        ...configuration,
        rooms: configuration.rooms.map((room) => ({ ...room, name: '  ' })),
      }),
    ).toThrow();
    expect(repository.loadInstallation()).toEqual(saved);

    database.close();
  });

  it('loads an installation created before configuration tables existed', () => {
    const path = createTemporaryDatabasePath();
    const oldDatabase = createDatabase(path);
    runMigrations(oldDatabase.client, databaseMigrations.slice(0, 2));
    oldDatabase.client.exec(`
      INSERT INTO installation (
        singleton_key, id, name, time_zone, display_temperature_unit,
        minimum_target_temperature_celsius, maximum_target_temperature_celsius,
        maximum_telemetry_age_seconds, minimum_command_interval_seconds,
        command_acknowledgement_timeout_seconds
      ) VALUES (1, 'installation-home', 'Home', 'Europe/London', 'celsius', 5, 35, 300, 60, 30);
    `);
    oldDatabase.close();

    const upgradedDatabase = createDatabase(path);
    runMigrations(upgradedDatabase.client, databaseMigrations);
    const repository = createInstallationRepository(upgradedDatabase.query);

    expect(repository.loadInstallation()).toEqual(
      InstallationSchema.parse({
        ...validSettings(),
        zones: [],
        rooms: [],
        climateControllers: [],
        plants: [],
        energySources: [],
        schedules: [],
        scheduleSelection: {},
      }),
    );
    expect(repository.loadInstallationWithRevision()?.revision).toBe(0);
    expect(repository.saveInstallationConfiguration(sampleConfiguration()).zones).toHaveLength(2);

    upgradedDatabase.close();
  });

  it('creates and replaces the complete installation only at the expected revision', () => {
    const database = createDatabase(':memory:');
    runMigrations(database.client, databaseMigrations);
    const repository = createInstallationRepository(database.query);
    const first = InstallationSchema.parse({ ...validSettings(), ...sampleConfiguration() });

    expect(repository.loadInstallationWithRevision()).toBeUndefined();
    expect(repository.saveInstallation(first, 1)).toEqual({ status: 'conflict' });
    expect(repository.saveInstallation(first, 0)).toEqual({
      status: 'saved',
      installation: first,
      revision: 1,
    });

    const second = InstallationSchema.parse({ ...first, name: 'Updated Home', rooms: [] });
    expect(repository.saveInstallation(second, 0)).toEqual({ status: 'conflict' });
    expect(repository.loadInstallationWithRevision()).toEqual({ installation: first, revision: 1 });
    expect(repository.saveInstallation(second, 1)).toEqual({
      status: 'saved',
      installation: second,
      revision: 2,
    });
    expect(repository.loadInstallationWithRevision()).toEqual({
      installation: second,
      revision: 2,
    });

    database.close();
  });

  it('advances the revision for existing settings and configuration writes', () => {
    const database = createDatabase(':memory:');
    runMigrations(database.client, databaseMigrations);
    const repository = createInstallationRepository(database.query);

    repository.saveInstallationSettings(validSettings());
    expect(repository.loadInstallationWithRevision()?.revision).toBe(1);
    repository.saveInstallationConfiguration(sampleConfiguration());
    expect(repository.loadInstallationWithRevision()?.revision).toBe(2);
    repository.saveInstallationSettings({ ...validSettings(), name: 'Renamed' });
    expect(repository.loadInstallationWithRevision()?.revision).toBe(3);

    database.close();
  });

  it('rolls back both settings and configuration when a full save fails', () => {
    const database = createDatabase(':memory:');
    runMigrations(database.client, databaseMigrations);
    const repository = createInstallationRepository(database.query);
    const first = InstallationSchema.parse({ ...validSettings(), ...sampleConfiguration() });
    repository.saveInstallation(first, 0);

    const duplicate = InstallationSchema.parse({
      ...first,
      name: 'Should roll back',
      climateControllers: [first.climateControllers[0], first.climateControllers[0]],
    });

    expect(() => repository.saveInstallation(duplicate, 1)).toThrow();
    expect(repository.loadInstallationWithRevision()).toEqual({ installation: first, revision: 1 });

    database.close();
  });
});

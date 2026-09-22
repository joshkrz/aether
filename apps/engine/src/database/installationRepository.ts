import { and, eq, sql } from 'drizzle-orm';

import { InstallationSchema, type Installation, type ScheduleDays } from '@aether/core';

import type { AetherDatabase } from './createDatabase.ts';
import {
  installationClimateControllerTable,
  installationEnergySourceTable,
  installationPlantTable,
  installationRoomTable,
  installationScheduleBlockTable,
  installationScheduleSelectionTable,
  installationScheduleTable,
  installationTable,
  installationZoneTable,
} from './schema.ts';

const installationSingletonKey = 1;

export type InstallationSettings = Pick<
  Installation,
  'id' | 'name' | 'timeZone' | 'displayTemperatureUnit' | 'safety'
>;

export type InstallationConfiguration = Pick<
  Installation,
  | 'zones'
  | 'rooms'
  | 'climateControllers'
  | 'plants'
  | 'energySources'
  | 'schedules'
  | 'scheduleSelection'
>;

export type InstallationRepository = {
  loadInstallation: () => Installation | undefined;
  loadInstallationWithRevision: () => { installation: Installation; revision: number } | undefined;
  saveInstallationSettings: (settings: InstallationSettings) => Installation;
  saveInstallationConfiguration: (configuration: InstallationConfiguration) => Installation;
  saveInstallation: (
    installation: Installation,
    expectedRevision: number,
  ) => { status: 'saved'; installation: Installation; revision: number } | { status: 'conflict' };
};

const emptyConfiguration: InstallationConfiguration = {
  zones: [],
  rooms: [],
  climateControllers: [],
  plants: [],
  energySources: [],
  schedules: [],
  scheduleSelection: {},
};

const getConfiguration = (installation: Installation): InstallationConfiguration => ({
  zones: installation.zones,
  rooms: installation.rooms,
  climateControllers: installation.climateControllers,
  plants: installation.plants,
  energySources: installation.energySources,
  schedules: installation.schedules,
  scheduleSelection: installation.scheduleSelection,
});

const parseOptionalJson = (value: string | null): unknown =>
  value === null ? undefined : JSON.parse(value);

const jsonOrNull = (value: unknown | undefined): string | null =>
  value === undefined ? null : JSON.stringify(value);

const locationColumns = (location: Installation['climateControllers'][number]['location']) => ({
  locationType: location.type,
  roomId: location.type === 'room' ? location.roomId : null,
  zoneId: location.type === 'zone' ? location.zoneId : null,
});

const emptyDays = (): Record<keyof ScheduleDays, unknown[]> => ({
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
});

export const createInstallationRepository = (
  database: AetherDatabase['query'],
): InstallationRepository => {
  const loadRevision = (): number | undefined =>
    database
      .select({ revision: installationTable.revision })
      .from(installationTable)
      .where(eq(installationTable.singletonKey, installationSingletonKey))
      .get()?.revision;

  const loadInstallation = (): Installation | undefined => {
    const row = database
      .select()
      .from(installationTable)
      .where(eq(installationTable.singletonKey, installationSingletonKey))
      .get();

    if (row === undefined) {
      return undefined;
    }

    const energySources = database
      .select()
      .from(installationEnergySourceTable)
      .orderBy(installationEnergySourceTable.position)
      .all()
      .map((source) => ({
        id: source.id,
        name: source.name,
        type: source.type,
        ...(source.tariffEntityId === null ? {} : { tariffEntityId: source.tariffEntityId }),
        ...(source.emissionsEntityId === null
          ? {}
          : { emissionsEntityId: source.emissionsEntityId }),
        ...(source.fixedUnitCost === null ? {} : { fixedUnitCost: source.fixedUnitCost }),
      }));
    const plants = database
      .select()
      .from(installationPlantTable)
      .orderBy(installationPlantTable.position)
      .all()
      .map((plant) => ({
        id: plant.id,
        name: plant.name,
        type: plant.type,
        ...(plant.energySourceId === null ? {} : { energySourceId: plant.energySourceId }),
        ...(plant.constraintsJson === null
          ? {}
          : { constraints: parseOptionalJson(plant.constraintsJson) }),
        ...(plant.efficiencyModelJson === null
          ? {}
          : { efficiencyModel: parseOptionalJson(plant.efficiencyModelJson) }),
      }));
    const zones = database
      .select()
      .from(installationZoneTable)
      .orderBy(installationZoneTable.position)
      .all()
      .map(({ id, name }) => ({ id, name }));
    const rooms = database
      .select()
      .from(installationRoomTable)
      .orderBy(installationRoomTable.position)
      .all()
      .map((room) => ({
        id: room.id,
        name: room.name,
        ...(room.zoneId === null ? {} : { zoneId: room.zoneId }),
        ...(room.temperatureEntityId === null
          ? {}
          : { temperatureEntityId: room.temperatureEntityId }),
        ...(room.humidityEntityId === null ? {} : { humidityEntityId: room.humidityEntityId }),
        ...(room.windowOrDoorEntityIdsJson === null
          ? {}
          : { windowOrDoorEntityIds: parseOptionalJson(room.windowOrDoorEntityIdsJson) }),
        ...(room.windowsJson === null ? {} : { windows: parseOptionalJson(room.windowsJson) }),
      }));
    const climateControllers = database
      .select()
      .from(installationClimateControllerTable)
      .orderBy(installationClimateControllerTable.position)
      .all()
      .map((controller) => ({
        id: controller.id,
        name: controller.name,
        entityId: controller.entityId,
        location:
          controller.locationType === 'room'
            ? { type: 'room', roomId: controller.roomId }
            : { type: 'zone', zoneId: controller.zoneId },
        plantId: controller.plantId,
        capabilities: JSON.parse(controller.capabilitiesJson),
        controlProfile: JSON.parse(controller.controlProfileJson),
        manualOverridePolicy: JSON.parse(controller.manualOverridePolicyJson),
      }));
    const schedules = database
      .select()
      .from(installationScheduleTable)
      .orderBy(installationScheduleTable.position)
      .all()
      .map(({ id, name }) => ({ id, name, days: emptyDays() }));
    const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));

    for (const block of database
      .select()
      .from(installationScheduleBlockTable)
      .orderBy(installationScheduleBlockTable.position)
      .all()) {
      const schedule = scheduleById.get(block.scheduleId);

      if (schedule === undefined) {
        throw new Error(`Schedule block references a missing schedule: ${block.scheduleId}`);
      }

      schedule.days[block.day].push({
        id: block.id,
        location:
          block.locationType === 'room'
            ? { type: 'room', roomId: block.roomId }
            : { type: 'zone', zoneId: block.zoneId },
        controllerId: block.controllerId,
        startMinute: block.startMinute,
        endMinute: block.endMinute,
        settings: JSON.parse(block.settingsJson),
      });
    }

    const selection = database
      .select()
      .from(installationScheduleSelectionTable)
      .where(eq(installationScheduleSelectionTable.singletonKey, installationSingletonKey))
      .get();

    return InstallationSchema.parse({
      id: row.id,
      name: row.name,
      timeZone: row.timeZone,
      displayTemperatureUnit: row.displayTemperatureUnit,
      safety: {
        minimumTargetTemperatureCelsius: row.minimumTargetTemperatureCelsius,
        maximumTargetTemperatureCelsius: row.maximumTargetTemperatureCelsius,
        maximumTelemetryAgeSeconds: row.maximumTelemetryAgeSeconds,
        minimumCommandIntervalSeconds: row.minimumCommandIntervalSeconds,
        commandAcknowledgementTimeoutSeconds: row.commandAcknowledgementTimeoutSeconds,
      },
      zones,
      rooms,
      climateControllers,
      plants,
      energySources,
      schedules,
      scheduleSelection: {
        ...(selection?.mainScheduleId == null ? {} : { mainScheduleId: selection.mainScheduleId }),
        ...(selection?.overrideScheduleId == null
          ? {}
          : { overrideScheduleId: selection.overrideScheduleId }),
      },
    });
  };

  const saveInstallationSettings = (settings: InstallationSettings): Installation => {
    const existing = loadInstallation();
    const installation = InstallationSchema.parse({
      ...settings,
      ...(existing === undefined ? emptyConfiguration : getConfiguration(existing)),
    });
    const values = {
      singletonKey: installationSingletonKey,
      id: installation.id,
      name: installation.name,
      timeZone: installation.timeZone,
      displayTemperatureUnit: installation.displayTemperatureUnit,
      revision: (loadRevision() ?? 0) + 1,
      minimumTargetTemperatureCelsius: installation.safety.minimumTargetTemperatureCelsius,
      maximumTargetTemperatureCelsius: installation.safety.maximumTargetTemperatureCelsius,
      maximumTelemetryAgeSeconds: installation.safety.maximumTelemetryAgeSeconds,
      minimumCommandIntervalSeconds: installation.safety.minimumCommandIntervalSeconds,
      commandAcknowledgementTimeoutSeconds:
        installation.safety.commandAcknowledgementTimeoutSeconds,
    };

    database
      .insert(installationTable)
      .values(values)
      .onConflictDoUpdate({
        target: installationTable.singletonKey,
        set: { ...values, revision: sql`${installationTable.revision} + 1` },
      })
      .run();

    return installation;
  };

  const persistConfiguration = (installation: Installation): void => {
    database.delete(installationScheduleSelectionTable).run();
    database.delete(installationScheduleBlockTable).run();
    database.delete(installationScheduleTable).run();
    database.delete(installationClimateControllerTable).run();
    database.delete(installationRoomTable).run();
    database.delete(installationZoneTable).run();
    database.delete(installationPlantTable).run();
    database.delete(installationEnergySourceTable).run();

    if (installation.energySources.length > 0) {
      database
        .insert(installationEnergySourceTable)
        .values(
          installation.energySources.map((source, position) => ({
            id: source.id,
            position,
            name: source.name,
            type: source.type,
            tariffEntityId: source.tariffEntityId ?? null,
            emissionsEntityId: source.emissionsEntityId ?? null,
            fixedUnitCost: source.fixedUnitCost ?? null,
          })),
        )
        .run();
    }

    if (installation.plants.length > 0) {
      database
        .insert(installationPlantTable)
        .values(
          installation.plants.map((plant, position) => ({
            id: plant.id,
            position,
            name: plant.name,
            type: plant.type,
            energySourceId: plant.energySourceId ?? null,
            constraintsJson: jsonOrNull(plant.constraints),
            efficiencyModelJson: jsonOrNull(plant.efficiencyModel),
          })),
        )
        .run();
    }

    if (installation.zones.length > 0) {
      database
        .insert(installationZoneTable)
        .values(installation.zones.map((zone, position) => ({ ...zone, position })))
        .run();
    }

    if (installation.rooms.length > 0) {
      database
        .insert(installationRoomTable)
        .values(
          installation.rooms.map((room, position) => ({
            id: room.id,
            position,
            name: room.name,
            zoneId: room.zoneId ?? null,
            temperatureEntityId: room.temperatureEntityId ?? null,
            humidityEntityId: room.humidityEntityId ?? null,
            windowOrDoorEntityIdsJson: jsonOrNull(room.windowOrDoorEntityIds),
            windowsJson: jsonOrNull(room.windows),
          })),
        )
        .run();
    }

    if (installation.climateControllers.length > 0) {
      database
        .insert(installationClimateControllerTable)
        .values(
          installation.climateControllers.map((controller, position) => ({
            id: controller.id,
            position,
            name: controller.name,
            entityId: controller.entityId,
            ...locationColumns(controller.location),
            plantId: controller.plantId,
            capabilitiesJson: JSON.stringify(controller.capabilities),
            controlProfileJson: JSON.stringify(controller.controlProfile),
            manualOverridePolicyJson: JSON.stringify(controller.manualOverridePolicy),
          })),
        )
        .run();
    }

    if (installation.schedules.length > 0) {
      database
        .insert(installationScheduleTable)
        .values(
          installation.schedules.map((schedule, position) => ({
            id: schedule.id,
            position,
            name: schedule.name,
          })),
        )
        .run();
    }

    const blockRows = installation.schedules.flatMap((schedule) =>
      (
        Object.entries(schedule.days) as [keyof ScheduleDays, ScheduleDays[keyof ScheduleDays]][]
      ).flatMap(([day, blocks]) =>
        blocks.map((block, position) => ({
          scheduleId: schedule.id,
          id: block.id,
          day,
          position,
          ...locationColumns(block.location),
          controllerId: block.controllerId,
          startMinute: block.startMinute,
          endMinute: block.endMinute,
          settingsJson: JSON.stringify(block.settings),
        })),
      ),
    );

    if (blockRows.length > 0) {
      database.insert(installationScheduleBlockTable).values(blockRows).run();
    }

    database
      .insert(installationScheduleSelectionTable)
      .values({
        singletonKey: installationSingletonKey,
        mainScheduleId: installation.scheduleSelection.mainScheduleId ?? null,
        overrideScheduleId: installation.scheduleSelection.overrideScheduleId ?? null,
      })
      .run();
  };

  const saveInstallationConfiguration = (
    configuration: InstallationConfiguration,
  ): Installation => {
    const existing = loadInstallation();

    if (existing === undefined) {
      throw new Error('Save installation settings before configuration');
    }

    const installation = InstallationSchema.parse({
      id: existing.id,
      name: existing.name,
      timeZone: existing.timeZone,
      displayTemperatureUnit: existing.displayTemperatureUnit,
      safety: existing.safety,
      ...configuration,
    });

    database.transaction(() => {
      persistConfiguration(installation);
      database
        .update(installationTable)
        .set({ revision: sql`${installationTable.revision} + 1` })
        .where(eq(installationTable.singletonKey, installationSingletonKey))
        .run();
    });

    return installation;
  };

  const loadInstallationWithRevision = () => {
    const revision = loadRevision();
    const installation = loadInstallation();
    return revision === undefined || installation === undefined
      ? undefined
      : { installation, revision };
  };

  const saveInstallation = (input: Installation, expectedRevision: number) => {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error('Expected installation revision must be a non-negative safe integer');
    }

    const installation = InstallationSchema.parse(input);

    return database.transaction(() => {
      const currentRevision = loadRevision();

      if ((currentRevision ?? 0) !== expectedRevision) {
        return { status: 'conflict' } as const;
      }

      const settings = {
        singletonKey: installationSingletonKey,
        id: installation.id,
        name: installation.name,
        timeZone: installation.timeZone,
        displayTemperatureUnit: installation.displayTemperatureUnit,
        revision: expectedRevision + 1,
        minimumTargetTemperatureCelsius: installation.safety.minimumTargetTemperatureCelsius,
        maximumTargetTemperatureCelsius: installation.safety.maximumTargetTemperatureCelsius,
        maximumTelemetryAgeSeconds: installation.safety.maximumTelemetryAgeSeconds,
        minimumCommandIntervalSeconds: installation.safety.minimumCommandIntervalSeconds,
        commandAcknowledgementTimeoutSeconds:
          installation.safety.commandAcknowledgementTimeoutSeconds,
      };

      if (currentRevision === undefined) {
        database.insert(installationTable).values(settings).run();
      } else {
        const result = database
          .update(installationTable)
          .set(settings)
          .where(
            and(
              eq(installationTable.singletonKey, installationSingletonKey),
              eq(installationTable.revision, expectedRevision),
            ),
          )
          .run();

        if (result.changes !== 1) {
          return { status: 'conflict' } as const;
        }
      }

      persistConfiguration(installation);
      return { status: 'saved', installation, revision: expectedRevision + 1 } as const;
    });
  };

  return {
    loadInstallation,
    loadInstallationWithRevision,
    saveInstallationSettings,
    saveInstallationConfiguration,
    saveInstallation,
  };
};

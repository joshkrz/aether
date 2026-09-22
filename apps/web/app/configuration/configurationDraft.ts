import {
  ClimateControllerSchema,
  InstallationSchema,
  PlantSchema,
  RoomSchema,
  TimeZoneSchema,
  ZoneSchema,
  type Installation,
  type ClimateController,
  type ControllerLocation,
  type DiscoveredClimateEntity,
  type Plant,
  type Room,
  type Zone,
} from '@aether/core';

export const createLocalId = (prefix: string): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${suffix}`;
};

export const browserTimeZone = (): string => {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return TimeZoneSchema.safeParse(detected).success ? detected : 'Etc/UTC';
};

export const createInstallationDraft = (id: string, timeZone: string): Installation =>
  InstallationSchema.parse({
    id,
    name: 'Home',
    timeZone,
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

export const createPlantDraft = (id: string): Plant =>
  PlantSchema.parse({ id, name: 'New plant', type: 'other' });

export const createZoneDraft = (id: string): Zone => ZoneSchema.parse({ id, name: 'New zone' });

export const createRoomDraft = (id: string): Room => RoomSchema.parse({ id, name: 'New room' });

export const createClimateControllerDraft = (
  id: string,
  entity: DiscoveredClimateEntity,
  location: ControllerLocation,
  plantId: Plant['id'],
): ClimateController =>
  ClimateControllerSchema.parse({
    id,
    name: entity.name,
    entityId: entity.entityId,
    location,
    plantId,
    capabilities: {
      heat: entity.hvacModes.includes('heat'),
      cool: entity.hvacModes.includes('cool'),
      off: entity.hvacModes.includes('off'),
    },
    controlProfile: {
      ...(entity.hvacModes.includes('heat') ? { heatingMode: 'heat' } : {}),
      ...(entity.hvacModes.includes('cool') ? { coolingMode: 'cool' } : {}),
      ...(entity.hvacModes.includes('off') ? { offMode: 'off' } : {}),
    },
    manualOverridePolicy: { type: 'until_next_schedule_block' },
  });

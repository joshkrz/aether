import { describe, expect, it } from 'vitest';

import { InstallationSchema } from './Installation.js';
import { validateInstallationTopology } from './installationTopologyValidation.js';

const emptyDays = {
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

const room = {
  id: 'room-bedroom',
  name: 'Bedroom',
  temperatureEntityId: 'sensor.bedroom_temperature',
};

const controller = {
  id: 'controller-bedroom-ac',
  name: 'Bedroom AC',
  entityId: 'climate.bedroom_ac',
  scope: 'local',
  plantId: 'plant-heat-pump',
  capabilities: { heat: true, cool: true, off: true },
  controlProfile: { heatingMode: 'heat', coolingMode: 'cool', offMode: 'off' },
  manualOverridePolicy: { type: 'until_next_schedule_block' },
};

const plant = {
  id: 'plant-heat-pump',
  name: 'Heat-pump outdoor unit',
  type: 'heat_pump',
  energySourceId: 'energy-electricity',
  constraints: {
    supportedModes: ['heat', 'cool'],
    allowMixedHeatCool: false,
  },
  efficiencyModel: {
    type: 'fixed',
    heatingPerformanceFactor: 3.5,
    coolingPerformanceFactor: 3.2,
  },
};

const energySource = {
  id: 'energy-electricity',
  name: 'Grid electricity',
  type: 'electricity',
};

const schedule = {
  id: 'schedule-bedroom-home',
  name: 'Bedroom home',
  days: emptyDays,
};

const validInstallation = {
  id: 'installation-home',
  name: 'Home',
  timeZone: 'Europe/London',
  displayTemperatureUnit: 'celsius',
  safety: {
    minimumTargetTemperatureCelsius: 10,
    maximumTargetTemperatureCelsius: 30,
    maximumTelemetryAgeSeconds: 120,
    minimumCommandIntervalSeconds: 30,
    commandAcknowledgementTimeoutSeconds: 15,
  },
  rooms: [room],
  climateControllers: [controller],
  plants: [plant],
  energySources: [energySource],
  schedules: [schedule],
  roomControllerLinks: [
    {
      roomId: room.id,
      controllerId: controller.id,
    },
  ],
  roomScheduleLinks: [
    {
      roomId: room.id,
      scheduleId: schedule.id,
    },
  ],
  roomScheduleSelections: [
    {
      roomId: room.id,
      baseScheduleId: schedule.id,
    },
  ],
};

const parseInstallation = (overrides: Record<string, unknown> = {}) =>
  InstallationSchema.parse({ ...validInstallation, ...overrides });

const issueCodes = (overrides: Record<string, unknown>) =>
  validateInstallationTopology(parseInstallation(overrides)).issues.map(({ code }) => code);

describe('validateInstallationTopology', () => {
  it('accepts a complete topology', () => {
    expect(validateInstallationTopology(parseInstallation())).toEqual({ valid: true, issues: [] });
  });

  it('rejects duplicate entity IDs within a collection', () => {
    expect(issueCodes({ rooms: [room, { ...room, name: 'Duplicate bedroom' }] })).toContain(
      'duplicate_entity_id',
    );
  });

  it('rejects duplicate Home Assistant climate entities', () => {
    expect(
      issueCodes({
        climateControllers: [controller, { ...controller, id: 'controller-bedroom-ac-copy' }],
      }),
    ).toContain('duplicate_controller_entity_id');
  });

  it('rejects missing plant and energy-source references', () => {
    expect(
      issueCodes({
        climateControllers: [{ ...controller, plantId: 'plant-missing' }],
        plants: [{ ...plant, energySourceId: 'energy-missing' }],
      }),
    ).toEqual(
      expect.arrayContaining(['missing_plant_reference', 'missing_energy_source_reference']),
    );
  });

  it('rejects dangling and duplicate room-controller links', () => {
    expect(
      issueCodes({
        roomControllerLinks: [
          { roomId: 'room-missing', controllerId: 'controller-missing' },
          { roomId: room.id, controllerId: controller.id },
          { roomId: room.id, controllerId: controller.id },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        'missing_room_reference',
        'missing_controller_reference',
        'duplicate_room_controller_link',
      ]),
    );
  });

  it('rejects dangling and duplicate room-schedule links', () => {
    expect(
      issueCodes({
        roomScheduleLinks: [
          { roomId: 'room-missing', scheduleId: 'schedule-missing' },
          { roomId: room.id, scheduleId: schedule.id },
          { roomId: room.id, scheduleId: schedule.id },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        'missing_room_reference',
        'missing_schedule_reference',
        'duplicate_room_schedule_link',
      ]),
    );
  });

  it('rejects duplicate room selection records', () => {
    expect(
      issueCodes({
        roomScheduleSelections: [
          { roomId: room.id, baseScheduleId: schedule.id },
          { roomId: room.id, overrideScheduleId: schedule.id },
        ],
      }),
    ).toContain('duplicate_room_schedule_selection');
  });

  it('rejects missing or unassigned selected schedules', () => {
    expect(
      issueCodes({
        roomScheduleSelections: [
          {
            roomId: room.id,
            baseScheduleId: 'schedule-missing',
            overrideScheduleId: schedule.id,
          },
        ],
        roomScheduleLinks: [],
      }),
    ).toEqual(
      expect.arrayContaining(['missing_schedule_reference', 'unassigned_selected_schedule']),
    );
  });

  it('rejects controller modes unsupported by the referenced plant', () => {
    expect(
      issueCodes({
        plants: [
          {
            ...plant,
            constraints: { ...plant.constraints, supportedModes: ['heat'] },
          },
        ],
      }),
    ).toContain('unsupported_controller_mode');
  });

  it('warns about incomplete but safe controller and plant setup', () => {
    const result = validateInstallationTopology(
      parseInstallation({
        roomControllerLinks: [],
        climateControllers: [],
      }),
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'warning', code: 'unused_plant' }),
      ]),
    );

    const unlinkedControllerResult = validateInstallationTopology(
      parseInstallation({ roomControllerLinks: [] }),
    );
    expect(unlinkedControllerResult.valid).toBe(true);
    expect(unlinkedControllerResult.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'unlinked_controller' }),
    );
  });

  it('warns when base and override selections are identical', () => {
    const result = validateInstallationTopology(
      parseInstallation({
        roomScheduleSelections: [
          {
            roomId: room.id,
            baseScheduleId: schedule.id,
            overrideScheduleId: schedule.id,
          },
        ],
      }),
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'redundant_schedule_override' }),
    );
  });

  it('allows rooms without controllers or selected schedules', () => {
    const result = validateInstallationTopology(
      parseInstallation({
        climateControllers: [],
        plants: [],
        roomControllerLinks: [],
        roomScheduleSelections: [],
      }),
    );

    expect(result).toEqual({ valid: true, issues: [] });
  });
});

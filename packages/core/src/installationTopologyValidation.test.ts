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
  zoneId: 'zone-upstairs',
};

const zone = { id: 'zone-upstairs', name: 'Upstairs' };

const controller = {
  id: 'controller-bedroom-ac',
  name: 'Bedroom AC',
  entityId: 'climate.bedroom_ac',
  location: { type: 'room', roomId: room.id },
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

const block = {
  id: 'block-bedroom-morning',
  location: { type: 'room', roomId: room.id },
  controllerId: controller.id,
  startMinute: 420,
  endMinute: 540,
  settings: { hvacMode: 'cool', targetTemperatureCelsius: 21 },
};

const schedule = {
  id: 'schedule-home',
  name: 'Home',
  days: { ...emptyDays, monday: [block] },
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
  zones: [zone],
  rooms: [room],
  climateControllers: [controller],
  plants: [plant],
  energySources: [energySource],
  schedules: [schedule],
  scheduleSelection: { mainScheduleId: schedule.id },
};

const parseInstallation = (overrides: Record<string, unknown> = {}) =>
  InstallationSchema.parse({ ...validInstallation, ...overrides });

const issueCodes = (overrides: Record<string, unknown>) =>
  validateInstallationTopology(parseInstallation(overrides)).issues.map(({ code }) => code);

describe('validateInstallationTopology', () => {
  it('accepts a complete topology with a whole-house schedule', () => {
    expect(validateInstallationTopology(parseInstallation())).toEqual({ valid: true, issues: [] });
  });

  it('rejects duplicate entity IDs within a collection', () => {
    expect(issueCodes({ rooms: [room, { ...room, name: 'Duplicate bedroom' }] })).toContain(
      'duplicate_entity_id',
    );
    expect(issueCodes({ zones: [zone, { ...zone, name: 'Duplicate upstairs' }] })).toContain(
      'duplicate_entity_id',
    );
    expect(
      issueCodes({ schedules: [schedule, { ...schedule, name: 'Duplicate schedule' }] }),
    ).toContain('duplicate_entity_id');
  });

  it('rejects duplicate Home Assistant climate entities across room and zone attachments', () => {
    expect(
      issueCodes({
        climateControllers: [
          controller,
          {
            ...controller,
            id: 'controller-bedroom-ac-copy',
            location: { type: 'zone', zoneId: zone.id },
          },
        ],
      }),
    ).toContain('duplicate_controller_entity_id');
  });

  it('accepts a standalone room alongside an empty zone', () => {
    const result = validateInstallationTopology(
      parseInstallation({
        rooms: [{ id: 'room-office', name: 'Office' }],
        climateControllers: [],
        plants: [],
        schedules: [],
        scheduleSelection: {},
      }),
    );

    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('rejects missing plant and optional energy-source references', () => {
    expect(
      issueCodes({
        climateControllers: [{ ...controller, plantId: 'plant-missing' }],
        plants: [{ ...plant, energySourceId: 'energy-missing' }],
      }),
    ).toEqual(
      expect.arrayContaining(['missing_plant_reference', 'missing_energy_source_reference']),
    );
  });

  it('rejects dangling room and zone references', () => {
    expect(
      issueCodes({
        rooms: [{ ...room, zoneId: 'zone-missing' }],
        climateControllers: [{ ...controller, location: { type: 'room', roomId: 'room-missing' } }],
      }),
    ).toEqual(expect.arrayContaining(['missing_room_reference', 'missing_zone_reference']));

    expect(
      issueCodes({
        climateControllers: [{ ...controller, location: { type: 'zone', zoneId: 'zone-missing' } }],
      }),
    ).toContain('missing_zone_reference');
  });

  it('accepts multiple controllers on a room or zone under the same plant', () => {
    const result = validateInstallationTopology(
      parseInstallation({
        climateControllers: [
          controller,
          { ...controller, id: 'controller-bedroom-heat', entityId: 'climate.bedroom_heat' },
          {
            ...controller,
            id: 'controller-upstairs-heat',
            entityId: 'climate.upstairs_heat',
            location: { type: 'zone', zoneId: zone.id },
          },
        ],
      }),
    );

    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('rejects schedule blocks with a missing room, zone, or controller', () => {
    expect(
      issueCodes({
        schedules: [
          {
            ...schedule,
            days: {
              ...emptyDays,
              monday: [
                {
                  ...block,
                  id: 'block-missing-room',
                  location: { type: 'room', roomId: 'room-missing' },
                },
                {
                  ...block,
                  id: 'block-missing-zone',
                  location: { type: 'zone', zoneId: 'zone-missing' },
                  startMinute: 540,
                  endMinute: 600,
                },
                {
                  ...block,
                  id: 'block-missing-controller',
                  controllerId: 'controller-missing',
                  startMinute: 600,
                  endMinute: 660,
                },
              ],
            },
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        'missing_room_reference',
        'missing_zone_reference',
        'missing_controller_reference',
      ]),
    );
  });

  it('rejects a block selecting a controller attached to another location', () => {
    expect(
      issueCodes({
        schedules: [
          {
            ...schedule,
            days: {
              ...emptyDays,
              monday: [{ ...block, location: { type: 'zone', zoneId: zone.id } }],
            },
          },
        ],
      }),
    ).toContain('schedule_block_location_mismatch');
  });

  it('rejects repeated block IDs within one weekly schedule', () => {
    expect(
      issueCodes({
        schedules: [{ ...schedule, days: { ...emptyDays, monday: [block], tuesday: [block] } }],
      }),
    ).toContain('duplicate_schedule_block_id');
  });

  it('rejects a missing selected schedule', () => {
    expect(issueCodes({ scheduleSelection: { mainScheduleId: 'schedule-missing' } })).toContain(
      'missing_schedule_reference',
    );
    expect(issueCodes({ scheduleSelection: { overrideScheduleId: 'schedule-missing' } })).toContain(
      'missing_schedule_reference',
    );
  });

  it('rejects controller modes unsupported by an optional plant constraint', () => {
    expect(
      issueCodes({
        plants: [{ ...plant, constraints: { ...plant.constraints, supportedModes: ['heat'] } }],
      }),
    ).toContain('unsupported_controller_mode');
  });

  it('accepts plants before controllers are assigned', () => {
    const result = validateInstallationTopology(
      parseInstallation({
        plants: [plant, { ...plant, id: 'plant-boiler', name: 'Boiler', type: 'boiler' }],
        climateControllers: [],
        schedules: [],
        scheduleSelection: {},
      }),
    );

    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('warns when main and override select the same schedule', () => {
    const result = validateInstallationTopology(
      parseInstallation({
        scheduleSelection: { mainScheduleId: schedule.id, overrideScheduleId: schedule.id },
      }),
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'redundant_schedule_override' }),
    );
  });

  it('allows rooms without controllers and unselected schedules', () => {
    const result = validateInstallationTopology(
      parseInstallation({
        climateControllers: [],
        plants: [],
        schedules: [{ ...schedule, days: emptyDays }],
        scheduleSelection: {},
      }),
    );

    expect(result).toEqual({ valid: true, issues: [] });
  });
});

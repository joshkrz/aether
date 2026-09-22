import { describe, expect, it } from 'vitest';

import { InstallationSchema } from './Installation.js';
import { evaluateSchedule, type ScheduleEvaluation } from './scheduleEvaluation.js';

const emptyDays = {
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

const controller = (id: string, entityId: string, location: object) => ({
  id,
  name: id,
  entityId,
  location,
  plantId: 'plant-hvac',
  capabilities: { heat: true, cool: true, off: true },
  controlProfile: { heatingMode: 'heat', coolingMode: 'cool', offMode: 'off' },
  manualOverridePolicy: { type: 'until_next_schedule_block' },
});

const controllers = [
  controller('controller-upstairs-heat', 'climate.upstairs_heat', {
    type: 'zone',
    zoneId: 'zone-upstairs',
  }),
  controller('controller-upstairs-backup', 'climate.upstairs_backup', {
    type: 'zone',
    zoneId: 'zone-upstairs',
  }),
  controller('controller-bedroom-ac', 'climate.bedroom_ac', {
    type: 'room',
    roomId: 'room-bedroom',
  }),
  controller('controller-nursery-ac', 'climate.nursery_ac', {
    type: 'room',
    roomId: 'room-nursery',
  }),
  controller('controller-office-ac', 'climate.office_ac', {
    type: 'room',
    roomId: 'room-office',
  }),
  controller('controller-downstairs-heat', 'climate.downstairs_heat', {
    type: 'zone',
    zoneId: 'zone-downstairs',
  }),
];

const block = (
  id: string,
  location: object,
  controllerId: string,
  startMinute: number,
  endMinute: number,
  hvacMode: string,
) => ({
  id,
  location,
  controllerId,
  startMinute,
  endMinute,
  settings: { hvacMode, targetTemperatureCelsius: 21 },
});

const upstairsBlock = block(
  'block-upstairs',
  { type: 'zone', zoneId: 'zone-upstairs' },
  'controller-upstairs-heat',
  540,
  660,
  'heat',
);
const bedroomBlock = block(
  'block-bedroom',
  { type: 'room', roomId: 'room-bedroom' },
  'controller-bedroom-ac',
  600,
  660,
  'cool',
);
const nurseryBlock = block(
  'block-nursery',
  { type: 'room', roomId: 'room-nursery' },
  'controller-nursery-ac',
  630,
  660,
  'cool',
);
const officeBlock = block(
  'block-office',
  { type: 'room', roomId: 'room-office' },
  'controller-office-ac',
  600,
  660,
  'cool',
);
const downstairsBlock = block(
  'block-downstairs',
  { type: 'zone', zoneId: 'zone-downstairs' },
  'controller-downstairs-heat',
  540,
  660,
  'heat',
);

const homeSchedule = {
  id: 'schedule-home',
  name: 'Home',
  days: {
    ...emptyDays,
    monday: [upstairsBlock, bedroomBlock, nurseryBlock, officeBlock, downstairsBlock],
  },
};

const makeInstallation = (overrides: Record<string, unknown> = {}) =>
  InstallationSchema.parse({
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
    zones: [
      { id: 'zone-upstairs', name: 'Upstairs' },
      { id: 'zone-downstairs', name: 'Downstairs' },
    ],
    rooms: [
      { id: 'room-bedroom', name: 'Bedroom', zoneId: 'zone-upstairs' },
      { id: 'room-nursery', name: 'Nursery', zoneId: 'zone-upstairs' },
      { id: 'room-office', name: 'Office' },
    ],
    climateControllers: controllers,
    plants: [{ id: 'plant-hvac', name: 'HVAC', type: 'hvac' }],
    energySources: [],
    schedules: [homeSchedule],
    scheduleSelection: { mainScheduleId: 'schedule-home' },
    ...overrides,
  });

const intentFor = (evaluation: ScheduleEvaluation, controllerId: string) =>
  evaluation.intents.find((intent) => intent.controllerId === controllerId);

describe('evaluateSchedule', () => {
  it('applies a zone block until a room block starts, then suppresses every zone controller', () => {
    const installation = makeInstallation();
    const beforeRoom = evaluateSchedule(installation, Date.parse('2026-09-21T08:30:00Z'));
    const duringRoom = evaluateSchedule(installation, Date.parse('2026-09-21T09:15:00Z'));

    expect(beforeRoom.localTime).toEqual({ day: 'monday', minuteOfDay: 570 });
    expect(intentFor(beforeRoom, 'controller-upstairs-heat')).toEqual({
      type: 'apply',
      controllerId: 'controller-upstairs-heat',
      blockId: 'block-upstairs',
      settings: upstairsBlock.settings,
    });
    expect(intentFor(beforeRoom, 'controller-upstairs-backup')).toEqual({
      type: 'off',
      controllerId: 'controller-upstairs-backup',
      reason: 'no_block',
    });
    expect(intentFor(duringRoom, 'controller-upstairs-heat')).toEqual({
      type: 'off',
      controllerId: 'controller-upstairs-heat',
      reason: 'room_block',
      blockingRoomIds: ['room-bedroom'],
    });
    expect(intentFor(duringRoom, 'controller-upstairs-backup')).toEqual({
      type: 'off',
      controllerId: 'controller-upstairs-backup',
      reason: 'room_block',
      blockingRoomIds: ['room-bedroom'],
    });
    expect(intentFor(duringRoom, 'controller-bedroom-ac')?.type).toBe('apply');
    expect(intentFor(duringRoom, 'controller-office-ac')?.type).toBe('apply');
    expect(intentFor(duringRoom, 'controller-downstairs-heat')?.type).toBe('apply');
    expect(intentFor(duringRoom, 'controller-nursery-ac')).toEqual({
      type: 'off',
      controllerId: 'controller-nursery-ac',
      reason: 'no_block',
    });
  });

  it('shows both blocking rooms and turns controllers off when blocks end', () => {
    const installation = makeInstallation();
    const beforeEnd = evaluateSchedule(installation, Date.parse('2026-09-21T09:45:00Z'));
    const atEnd = evaluateSchedule(installation, Date.parse('2026-09-21T10:00:00Z'));

    expect(intentFor(beforeEnd, 'controller-upstairs-heat')).toEqual({
      type: 'off',
      controllerId: 'controller-upstairs-heat',
      reason: 'room_block',
      blockingRoomIds: ['room-bedroom', 'room-nursery'],
    });
    expect(atEnd.activeBlocks).toEqual([]);
    expect(atEnd.intents).toHaveLength(controllers.length);
    expect(
      atEnd.intents.every((intent) => intent.type === 'off' && intent.reason === 'no_block'),
    ).toBe(true);
  });

  it('uses the override schedule without inheriting main blocks', () => {
    const awaySchedule = {
      id: 'schedule-away',
      name: 'Away',
      days: { ...emptyDays, monday: [downstairsBlock] },
    };
    const installation = makeInstallation({
      schedules: [homeSchedule, awaySchedule],
      scheduleSelection: { mainScheduleId: 'schedule-home', overrideScheduleId: 'schedule-away' },
    });
    const result = evaluateSchedule(installation, Date.parse('2026-09-21T09:15:00Z'));

    expect(result.selection).toEqual({ source: 'override', scheduleId: 'schedule-away' });
    expect(result.activeBlocks.map(({ id }) => id)).toEqual(['block-downstairs']);
    expect(intentFor(result, 'controller-downstairs-heat')?.type).toBe('apply');
    expect(intentFor(result, 'controller-bedroom-ac')?.type).toBe('off');
    expect(intentFor(result, 'controller-upstairs-heat')).toEqual({
      type: 'off',
      controllerId: 'controller-upstairs-heat',
      reason: 'no_block',
    });
  });

  it('returns off intents when no schedule is selected or the selected ID is missing', () => {
    for (const scheduleSelection of [{}, { mainScheduleId: 'schedule-deleted' }]) {
      const result = evaluateSchedule(
        makeInstallation({ scheduleSelection }),
        Date.parse('2026-09-21T09:15:00Z'),
      );

      expect(result.status).toBe(
        'mainScheduleId' in scheduleSelection ? 'missing_selected_schedule' : 'none_selected',
      );
      expect(result.activeBlocks).toEqual([]);
      expect(result.intents).toHaveLength(controllers.length);
      expect(
        result.intents.every((intent) => intent.type === 'off' && intent.reason === 'no_schedule'),
      ).toBe(true);
    }
  });

  it('suppresses a zone even when the active room block requests off', () => {
    const offBedroomBlock = { ...bedroomBlock, settings: { hvacMode: 'off' } };
    const schedule = {
      ...homeSchedule,
      days: { ...emptyDays, monday: [upstairsBlock, offBedroomBlock] },
    };
    const result = evaluateSchedule(
      makeInstallation({ schedules: [schedule] }),
      Date.parse('2026-09-21T09:15:00Z'),
    );

    expect(intentFor(result, 'controller-bedroom-ac')).toEqual({
      type: 'apply',
      controllerId: 'controller-bedroom-ac',
      blockId: 'block-bedroom',
      settings: { hvacMode: 'off' },
    });
    expect(intentFor(result, 'controller-upstairs-heat')).toEqual({
      type: 'off',
      controllerId: 'controller-upstairs-heat',
      reason: 'room_block',
      blockingRoomIds: ['room-bedroom'],
    });
  });

  it('skips nonexistent local minutes when the clocks go forward', () => {
    const springBlock = block(
      'block-spring-gap',
      { type: 'room', roomId: 'room-bedroom' },
      'controller-bedroom-ac',
      75,
      105,
      'cool',
    );
    const installation = makeInstallation({
      schedules: [{ ...homeSchedule, days: { ...emptyDays, sunday: [springBlock] } }],
    });
    const before = evaluateSchedule(installation, Date.parse('2026-03-29T00:30:00Z'));
    const after = evaluateSchedule(installation, Date.parse('2026-03-29T01:30:00Z'));

    expect(before.localTime).toEqual({ day: 'sunday', minuteOfDay: 30 });
    expect(after.localTime).toEqual({ day: 'sunday', minuteOfDay: 150 });
    expect(before.activeBlocks).toEqual([]);
    expect(after.activeBlocks).toEqual([]);
    expect(intentFor(after, 'controller-bedroom-ac')?.type).toBe('off');
  });

  it('applies the same block during both occurrences of an autumn local minute', () => {
    const autumnBlock = block(
      'block-autumn-repeat',
      { type: 'room', roomId: 'room-bedroom' },
      'controller-bedroom-ac',
      75,
      105,
      'heat',
    );
    const installation = makeInstallation({
      schedules: [{ ...homeSchedule, days: { ...emptyDays, sunday: [autumnBlock] } }],
    });
    const first = evaluateSchedule(installation, Date.parse('2026-10-25T00:30:00Z'));
    const second = evaluateSchedule(installation, Date.parse('2026-10-25T01:30:00Z'));

    expect(first.localTime).toEqual({ day: 'sunday', minuteOfDay: 90 });
    expect(second.localTime).toEqual({ day: 'sunday', minuteOfDay: 90 });
    expect(intentFor(first, 'controller-bedroom-ac')?.type).toBe('apply');
    expect(intentFor(second, 'controller-bedroom-ac')?.type).toBe('apply');
  });

  it('rejects an invalid supplied instant', () => {
    expect(() => evaluateSchedule(makeInstallation(), Number.NaN)).toThrow(RangeError);
  });
});

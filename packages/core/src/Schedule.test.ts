import { describe, expect, it } from 'vitest';

import { ScheduleSchema } from './Schedule.js';

const emptyDays = {
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

const roomBlock = {
  id: 'block-bedroom-morning',
  location: { type: 'room', roomId: 'room-bedroom' },
  controllerId: 'controller-bedroom-ac',
  startMinute: 420,
  endMinute: 540,
  settings: {
    hvacMode: 'cool',
    targetTemperatureCelsius: 21,
    targetHumidityPercent: 45,
    fanMode: 'quiet',
    presetMode: 'home',
    swingMode: 'vertical',
    swingHorizontalMode: 'left',
  },
};

const zoneBlock = {
  id: 'block-upstairs-morning',
  location: { type: 'zone', zoneId: 'zone-upstairs' },
  controllerId: 'controller-upstairs-heat',
  startMinute: 420,
  endMinute: 540,
  settings: { hvacMode: 'heat', targetTemperatureCelsius: 19 },
};

const validSchedule = {
  id: 'schedule-home',
  name: 'Home',
  days: { ...emptyDays, monday: [roomBlock, zoneBlock] },
};

describe('ScheduleSchema', () => {
  it('accepts blocks for different room and zone rows at the same time', () => {
    expect(ScheduleSchema.safeParse(validSchedule).success).toBe(true);
  });

  it('accepts an empty whole-house schedule and days with no blocks', () => {
    expect(ScheduleSchema.safeParse({ ...validSchedule, days: emptyDays }).success).toBe(true);
  });

  it('accepts adjacent blocks on one row and a temperature range', () => {
    expect(
      ScheduleSchema.safeParse({
        ...validSchedule,
        days: {
          ...emptyDays,
          monday: [
            roomBlock,
            {
              ...roomBlock,
              id: 'block-bedroom-later',
              controllerId: 'controller-bedroom-heat',
              startMinute: 540,
              endMinute: 600,
              settings: {
                hvacMode: 'heat_cool',
                targetTemperatureLowCelsius: 19,
                targetTemperatureHighCelsius: 23,
              },
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it('rejects overlap on the same row even with a different controller', () => {
    expect(
      ScheduleSchema.safeParse({
        ...validSchedule,
        days: {
          ...emptyDays,
          monday: [
            roomBlock,
            {
              ...roomBlock,
              id: 'block-bedroom-overlap',
              controllerId: 'controller-bedroom-heat',
              startMinute: 480,
              endMinute: 600,
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects a block that crosses midnight or has invalid minute bounds', () => {
    for (const [startMinute, endMinute] of [
      [1320, 360],
      [-1, 60],
      [0, 1441],
    ]) {
      expect(
        ScheduleSchema.safeParse({
          ...validSchedule,
          days: { ...emptyDays, monday: [{ ...roomBlock, startMinute, endMinute }] },
        }).success,
      ).toBe(false);
    }
  });

  it('requires every day of the week', () => {
    const incompleteDays = Object.fromEntries(
      Object.entries(emptyDays).filter(([day]) => day !== 'sunday'),
    );
    expect(ScheduleSchema.safeParse({ ...validSchedule, days: incompleteDays }).success).toBe(
      false,
    );
  });

  it('rejects incomplete or inverted temperature ranges and mixed single/range settings', () => {
    for (const settings of [
      { hvacMode: 'heat_cool', targetTemperatureLowCelsius: 19 },
      { hvacMode: 'heat_cool', targetTemperatureLowCelsius: 24, targetTemperatureHighCelsius: 20 },
      {
        hvacMode: 'heat_cool',
        targetTemperatureCelsius: 21,
        targetTemperatureLowCelsius: 19,
        targetTemperatureHighCelsius: 23,
      },
    ]) {
      expect(
        ScheduleSchema.safeParse({
          ...validSchedule,
          days: { ...emptyDays, monday: [{ ...roomBlock, settings }] },
        }).success,
      ).toBe(false);
    }
  });

  it('rejects humidity outside 0–100 and unknown settings', () => {
    for (const settings of [
      { hvacMode: 'cool', targetHumidityPercent: 101 },
      { hvacMode: 'cool', vendorCommand: 'boost' },
    ]) {
      expect(
        ScheduleSchema.safeParse({
          ...validSchedule,
          days: { ...emptyDays, monday: [{ ...roomBlock, settings }] },
        }).success,
      ).toBe(false);
    }
  });
});

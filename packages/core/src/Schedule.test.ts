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

const validSchedule = {
  id: 'schedule-bedroom',
  name: 'Bedroom schedule',
  days: {
    ...emptyDays,
    monday: [
      {
        startMinute: 420,
        endMinute: 540,
        minimumTemperature: 19,
        maximumTemperature: 23,
      },
      {
        startMinute: 1080,
        endMinute: 1320,
        minimumTemperature: 18,
        maximumTemperature: 22,
      },
    ],
  },
} as const;

describe('ScheduleSchema', () => {
  it('accepts independently configured daily periods', () => {
    expect(ScheduleSchema.safeParse(validSchedule).success).toBe(true);
  });

  it('allows an empty day to represent off', () => {
    expect(
      ScheduleSchema.safeParse({
        ...validSchedule,
        days: emptyDays,
      }).success,
    ).toBe(true);
  });

  it('allows gaps between periods to represent off', () => {
    expect(ScheduleSchema.safeParse(validSchedule).success).toBe(true);
  });

  it('requires every day of the week', () => {
    const incompleteDays = Object.fromEntries(
      Object.entries(emptyDays).filter(([day]) => day !== 'sunday'),
    );

    expect(
      ScheduleSchema.safeParse({
        ...validSchedule,
        days: incompleteDays,
      }).success,
    ).toBe(false);
  });

  it('rejects overlapping periods regardless of their array order', () => {
    expect(
      ScheduleSchema.safeParse({
        ...validSchedule,
        days: {
          ...emptyDays,
          monday: [
            {
              startMinute: 600,
              endMinute: 720,
              minimumTemperature: 18,
              maximumTemperature: 22,
            },
            {
              startMinute: 540,
              endMinute: 660,
              minimumTemperature: 19,
              maximumTemperature: 23,
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects a period that crosses midnight', () => {
    expect(
      ScheduleSchema.safeParse({
        ...validSchedule,
        days: {
          ...emptyDays,
          monday: [
            {
              startMinute: 1320,
              endMinute: 360,
              minimumTemperature: 18,
              maximumTemperature: 22,
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects inverted temperature bounds', () => {
    expect(
      ScheduleSchema.safeParse({
        ...validSchedule,
        days: {
          ...emptyDays,
          monday: [
            {
              startMinute: 540,
              endMinute: 660,
              minimumTemperature: 24,
              maximumTemperature: 20,
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown schedule properties', () => {
    expect(ScheduleSchema.safeParse({ ...validSchedule, timezone: 'Europe/London' }).success).toBe(
      false,
    );
  });
});

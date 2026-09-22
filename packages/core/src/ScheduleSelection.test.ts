import { describe, expect, it } from 'vitest';

import { resolveSelectedSchedule } from './resolveSelectedSchedule.js';
import { ScheduleSelectionSchema } from './ScheduleSelection.js';

describe('ScheduleSelectionSchema', () => {
  it('stores installation-wide main and override choices', () => {
    expect(
      ScheduleSelectionSchema.safeParse({
        mainScheduleId: 'schedule-home',
        overrideScheduleId: 'schedule-away',
      }).success,
    ).toBe(true);
  });

  it('allows no selection during setup and an override without a main choice', () => {
    expect(ScheduleSelectionSchema.safeParse({}).success).toBe(true);
    expect(ScheduleSelectionSchema.safeParse({ overrideScheduleId: 'schedule-away' }).success).toBe(
      true,
    );
  });

  it('rejects room-specific selection state', () => {
    expect(ScheduleSelectionSchema.safeParse({ roomId: 'room-bedroom' }).success).toBe(false);
  });
});

describe('resolveSelectedSchedule', () => {
  it('uses the override as the complete active choice', () => {
    expect(
      resolveSelectedSchedule(
        ScheduleSelectionSchema.parse({
          mainScheduleId: 'schedule-home',
          overrideScheduleId: 'schedule-away',
        }),
      ),
    ).toEqual({ source: 'override', scheduleId: 'schedule-away' });
  });

  it('uses the main choice when the override is clear', () => {
    expect(
      resolveSelectedSchedule(ScheduleSelectionSchema.parse({ mainScheduleId: 'schedule-home' })),
    ).toEqual({ source: 'main', scheduleId: 'schedule-home' });
  });

  it('has no selected schedule during initial setup', () => {
    expect(resolveSelectedSchedule(ScheduleSelectionSchema.parse({}))).toEqual({ source: 'none' });
  });
});

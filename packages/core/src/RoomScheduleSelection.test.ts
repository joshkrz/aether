import { describe, expect, it } from 'vitest';

import { RoomScheduleSelectionSchema } from './RoomScheduleSelection.js';

describe('RoomScheduleSelectionSchema', () => {
  it('stores independent base and override selections', () => {
    expect(
      RoomScheduleSelectionSchema.safeParse({
        roomId: 'room-bedroom',
        baseScheduleId: 'schedule-bedroom-school-holiday',
        overrideScheduleId: 'schedule-bedroom-away',
      }).success,
    ).toBe(true);
  });

  it('allows an override without a base schedule', () => {
    expect(
      RoomScheduleSelectionSchema.safeParse({
        roomId: 'room-bedroom',
        overrideScheduleId: 'schedule-bedroom-away',
      }).success,
    ).toBe(true);
  });

  it('allows no selection to represent off', () => {
    expect(
      RoomScheduleSelectionSchema.safeParse({
        roomId: 'room-bedroom',
      }).success,
    ).toBe(true);
  });

  it('rejects an ambiguous active schedule property', () => {
    expect(
      RoomScheduleSelectionSchema.safeParse({
        roomId: 'room-bedroom',
        activeScheduleId: 'schedule-bedroom-home',
      }).success,
    ).toBe(false);
  });
});

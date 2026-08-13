import { describe, expect, it } from 'vitest';

import { RoomScheduleLinkSchema } from './RoomScheduleLink.js';

describe('RoomScheduleLinkSchema', () => {
  it('assigns an available schedule to a room', () => {
    expect(
      RoomScheduleLinkSchema.safeParse({
        roomId: 'room-bedroom',
        scheduleId: 'schedule-bedroom-home',
      }).success,
    ).toBe(true);
  });

  it('requires meaningful identifiers', () => {
    expect(
      RoomScheduleLinkSchema.safeParse({
        roomId: 'room-bedroom',
        scheduleId: '  ',
      }).success,
    ).toBe(false);
  });

  it('does not store selection state on the assignment link', () => {
    expect(
      RoomScheduleLinkSchema.safeParse({
        roomId: 'room-bedroom',
        scheduleId: 'schedule-bedroom-home',
        active: true,
      }).success,
    ).toBe(false);
  });
});

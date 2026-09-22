import { describe, expect, it } from 'vitest';

import { RoomSchema } from './Room.js';

const validRoom = {
  id: 'room-bedroom',
  name: 'Bedroom',
  temperatureEntityId: 'sensor.bedroom_temperature',
  humidityEntityId: 'sensor.bedroom_humidity',
  windowOrDoorEntityIds: ['binary_sensor.bedroom_window'],
  windows: [
    {
      id: 'window-bedroom-south',
      name: 'Bedroom south window',
      azimuth: 180,
      tilt: 90,
      area: 2.4,
      relativeSize: 'medium',
      shadingFactor: 0.25,
      solarGainCoefficient: 0.7,
    },
  ],
} as const;

describe('RoomSchema', () => {
  it('accepts a room with inputs and window surfaces', () => {
    expect(RoomSchema.safeParse(validRoom).success).toBe(true);
  });

  it('accepts rooms with or without a zone and without a separate temperature sensor', () => {
    expect(RoomSchema.safeParse({ id: 'room-office', name: 'Office' }).success).toBe(true);
    expect(
      RoomSchema.safeParse({ id: 'room-bedroom', name: 'Bedroom', zoneId: 'zone-upstairs' })
        .success,
    ).toBe(true);
  });

  it('does not allow a parallel controller ID collection', () => {
    expect(
      RoomSchema.safeParse({ ...validRoom, controllerIds: ['controller-bedroom-ac'] }).success,
    ).toBe(false);
  });

  it.each([
    ['scheduleId', { scheduleId: 'schedule-bedroom' }],
    ['occupancyEntityId', { occupancyEntityId: 'binary_sensor.bedroom_occupancy' }],
  ])('does not store superseded room property %s', (_propertyName, property) => {
    expect(RoomSchema.safeParse({ ...validRoom, ...property }).success).toBe(false);
  });
});

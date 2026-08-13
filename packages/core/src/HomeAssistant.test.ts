import { describe, expect, it } from 'vitest';

import {
  ClimateEntityIdSchema,
  HomeAssistantEntityIdSchema,
  HvacModeSchema,
} from './HomeAssistant.js';

describe('Home Assistant schemas', () => {
  it('accepts a well-formed Home Assistant entity ID', () => {
    expect(HomeAssistantEntityIdSchema.safeParse('sensor.bedroom_temperature').success).toBe(true);
  });

  it('requires a climate domain for climate controllers', () => {
    expect(ClimateEntityIdSchema.safeParse('climate.bedroom_ac').success).toBe(true);
    expect(ClimateEntityIdSchema.safeParse('switch.bedroom_ac').success).toBe(false);
  });

  it.each(['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'])(
    'accepts the supported HVAC mode %s',
    (mode) => {
      expect(HvacModeSchema.safeParse(mode).success).toBe(true);
    },
  );

  it.each(['Sensor.bedroom', 'sensor.Bedroom', 'sensor-bedroom'])(
    'rejects malformed entity ID %s',
    (entityId) => {
      expect(HomeAssistantEntityIdSchema.safeParse(entityId).success).toBe(false);
    },
  );
});

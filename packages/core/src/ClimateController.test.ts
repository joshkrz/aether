import { describe, expect, it } from 'vitest';

import { ClimateControllerSchema } from './ClimateController.js';

const validController = {
  id: 'controller-bedroom-ac',
  name: 'Bedroom AC',
  entityId: 'climate.bedroom_ac',
  scope: 'local',
  plantId: 'plant-heat-pump',
  capabilities: { heat: true, cool: true, off: true },
  controlProfile: { heatingMode: 'heat', coolingMode: 'cool', offMode: 'off' },
  manualOverridePolicy: { type: 'until_next_schedule_block' },
} as const;

describe('ClimateControllerSchema', () => {
  it('accepts a climate-backed controller', () => {
    expect(ClimateControllerSchema.safeParse(validController).success).toBe(true);
  });

  it('rejects a non-climate Home Assistant entity', () => {
    expect(
      ClimateControllerSchema.safeParse({ ...validController, entityId: 'switch.bedroom_ac' })
        .success,
    ).toBe(false);
  });

  it('requires heating or cooling capability', () => {
    expect(
      ClimateControllerSchema.safeParse({
        ...validController,
        capabilities: { heat: false, cool: false, off: true },
      }).success,
    ).toBe(false);
  });

  it('does not allow a parallel room ID collection', () => {
    expect(
      ClimateControllerSchema.safeParse({ ...validController, roomIds: ['room-bedroom'] }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { PlantConstraintsSchema } from './PlantConstraints.js';

describe('PlantConstraintsSchema', () => {
  it('accepts shared plant constraints', () => {
    expect(
      PlantConstraintsSchema.safeParse({
        supportedModes: ['heat', 'cool'],
        allowMixedHeatCool: false,
        maximumActiveControllers: 3,
        minimumOnMinutes: 5,
        minimumOffMinutes: 5,
        settlingSeconds: 30,
      }).success,
    ).toBe(true);
  });

  it.each([
    { supportedModes: [] },
    { supportedModes: ['heat', 'heat'] },
    { supportedModes: ['heat'], maximumActiveControllers: 0 },
  ])('rejects invalid constraints: $supportedModes', (constraints) => {
    expect(PlantConstraintsSchema.safeParse(constraints).success).toBe(false);
  });
});

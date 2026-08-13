import { describe, expect, it } from 'vitest';

import { EnergySourceSchema } from './EnergySource.js';

const validEnergySource = {
  id: 'energy-electricity',
  name: 'Grid electricity',
  type: 'electricity',
  tariffEntityId: 'sensor.electricity_tariff',
  emissionsEntityId: 'sensor.grid_carbon_intensity',
  fixedUnitCost: 0.24,
} as const;

describe('EnergySourceSchema', () => {
  it('accepts a valid energy source', () => {
    expect(EnergySourceSchema.safeParse(validEnergySource).success).toBe(true);
  });

  it('rejects a negative fixed cost', () => {
    expect(
      EnergySourceSchema.safeParse({ ...validEnergySource, fixedUnitCost: -0.01 }).success,
    ).toBe(false);
  });

  it('rejects unknown properties', () => {
    expect(EnergySourceSchema.safeParse({ ...validEnergySource, unexpected: true }).success).toBe(
      false,
    );
  });
});

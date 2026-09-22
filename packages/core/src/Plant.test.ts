import { describe, expect, it } from 'vitest';

import { EfficiencyModelSchema, PlantSchema } from './Plant.js';

const validPlant = {
  id: 'plant-heat-pump',
  name: 'Main heat-pump outdoor unit',
  type: 'heat_pump',
  energySourceId: 'energy-electricity',
  constraints: {
    supportedModes: ['heat', 'cool'],
    allowMixedHeatCool: false,
    maximumActiveControllers: 3,
  },
  efficiencyModel: {
    type: 'fixed',
    heatingPerformanceFactor: 3.5,
    coolingPerformanceFactor: 3.2,
  },
} as const;

describe('EfficiencyModelSchema', () => {
  it('accepts positive fixed performance factors', () => {
    expect(EfficiencyModelSchema.safeParse(validPlant.efficiencyModel).success).toBe(true);
  });

  it.each([0, -1])('rejects heating performance factor %s', (heatingPerformanceFactor) => {
    expect(
      EfficiencyModelSchema.safeParse({
        type: 'fixed',
        heatingPerformanceFactor,
      }).success,
    ).toBe(false);
  });

  it('rejects a non-positive cooling performance factor', () => {
    expect(
      EfficiencyModelSchema.safeParse({
        type: 'fixed',
        heatingPerformanceFactor: 3.5,
        coolingPerformanceFactor: 0,
      }).success,
    ).toBe(false);
  });
});

describe('PlantSchema', () => {
  it('accepts a grouping-only HVAC plant', () => {
    expect(PlantSchema.safeParse({ id: 'plant-hvac', name: 'HVAC', type: 'hvac' }).success).toBe(
      true,
    );
  });

  it('accepts physical plant configuration', () => {
    expect(PlantSchema.safeParse(validPlant).success).toBe(true);
  });

  it('requires a meaningful energy-source reference', () => {
    expect(PlantSchema.safeParse({ ...validPlant, energySourceId: '  ' }).success).toBe(false);
  });

  it('does not allow a duplicate controller membership collection', () => {
    expect(
      PlantSchema.safeParse({
        ...validPlant,
        controllerIds: ['controller-bedroom-ac'],
      }).success,
    ).toBe(false);
  });
});

import * as z from 'zod';

import { EnergySourceIdSchema, PlantIdSchema } from './identifiers.js';
import { PlantConstraintsSchema } from './PlantConstraints.js';
import { NonBlankStringSchema } from './schemaPrimitives.js';

export const PlantTypeSchema = z.enum(['boiler', 'heat_pump', 'hvac', 'other']);

export const EfficiencyModelSchema = z.strictObject({
  type: z.literal('fixed'),
  heatingPerformanceFactor: z.number().positive(),
  coolingPerformanceFactor: z.number().positive().optional(),
});

export const PlantSchema = z.strictObject({
  id: PlantIdSchema,
  name: NonBlankStringSchema,
  type: PlantTypeSchema,
  energySourceId: EnergySourceIdSchema.optional(),
  constraints: PlantConstraintsSchema.optional(),
  efficiencyModel: EfficiencyModelSchema.optional(),
});

export type PlantType = z.infer<typeof PlantTypeSchema>;
export type EfficiencyModel = z.infer<typeof EfficiencyModelSchema>;
export type Plant = z.infer<typeof PlantSchema>;

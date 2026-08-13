import * as z from 'zod';

import { ClimateEntityIdSchema, HvacModeSchema } from './HomeAssistant.js';
import { ClimateControllerIdSchema, PlantIdSchema } from './identifiers.js';
import { ManualOverridePolicySchema } from './ManualOverride.js';
import { NonBlankStringSchema } from './schemaPrimitives.js';

export const ControllerScopeSchema = z.enum(['local', 'shared']);

export const ControllerCapabilitiesSchema = z
  .strictObject({
    heat: z.boolean(),
    cool: z.boolean(),
    off: z.boolean(),
  })
  .refine(({ heat, cool }) => heat || cool, 'Controller must support heating or cooling');

export const ClimateControlProfileSchema = z.strictObject({
  heatingMode: HvacModeSchema.optional(),
  coolingMode: HvacModeSchema.optional(),
  offMode: HvacModeSchema.optional(),
});

export const ClimateControllerSchema = z.strictObject({
  id: ClimateControllerIdSchema,
  name: NonBlankStringSchema,
  entityId: ClimateEntityIdSchema,
  scope: ControllerScopeSchema,
  plantId: PlantIdSchema,
  capabilities: ControllerCapabilitiesSchema,
  controlProfile: ClimateControlProfileSchema,
  manualOverridePolicy: ManualOverridePolicySchema,
});

export type ControllerScope = z.infer<typeof ControllerScopeSchema>;
export type ControllerCapabilities = z.infer<typeof ControllerCapabilitiesSchema>;
export type ClimateControlProfile = z.infer<typeof ClimateControlProfileSchema>;
export type ClimateController = z.infer<typeof ClimateControllerSchema>;

import * as z from 'zod';

import { ClimateEntityIdSchema, HvacModeSchema } from './HomeAssistant.js';
import {
  ClimateControllerIdSchema,
  PlantIdSchema,
  RoomIdSchema,
  ZoneIdSchema,
} from './identifiers.js';
import { ManualOverridePolicySchema } from './ManualOverride.js';
import { NonBlankStringSchema } from './schemaPrimitives.js';

export const ControllerLocationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('room'), roomId: RoomIdSchema }),
  z.strictObject({ type: z.literal('zone'), zoneId: ZoneIdSchema }),
]);

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
  location: ControllerLocationSchema,
  plantId: PlantIdSchema,
  capabilities: ControllerCapabilitiesSchema,
  controlProfile: ClimateControlProfileSchema,
  manualOverridePolicy: ManualOverridePolicySchema,
});

export type ControllerLocation = z.infer<typeof ControllerLocationSchema>;
export type ControllerCapabilities = z.infer<typeof ControllerCapabilitiesSchema>;
export type ClimateControlProfile = z.infer<typeof ClimateControlProfileSchema>;
export type ClimateController = z.infer<typeof ClimateControllerSchema>;

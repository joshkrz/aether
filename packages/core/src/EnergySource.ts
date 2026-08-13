import * as z from 'zod';

import { HomeAssistantEntityIdSchema } from './HomeAssistant.js';
import { EnergySourceIdSchema } from './identifiers.js';
import { NonBlankStringSchema } from './schemaPrimitives.js';

export const EnergySourceSchema = z.strictObject({
  id: EnergySourceIdSchema,
  name: NonBlankStringSchema,
  type: z.enum(['electricity', 'gas', 'other']),
  tariffEntityId: HomeAssistantEntityIdSchema.optional(),
  emissionsEntityId: HomeAssistantEntityIdSchema.optional(),
  fixedUnitCost: z.number().nonnegative().optional(),
});

export type EnergySource = z.infer<typeof EnergySourceSchema>;

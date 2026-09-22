import * as z from 'zod';

import { ClimateEntityIdSchema, HvacModeSchema } from './HomeAssistant.js';

export const DiscoveredClimateEntitySchema = z.strictObject({
  entityId: ClimateEntityIdSchema,
  name: z.string().min(1),
  available: z.boolean(),
  hvacModes: z.array(HvacModeSchema),
  fanModes: z.array(z.string()),
  presetModes: z.array(z.string()),
  swingModes: z.array(z.string()),
  swingHorizontalModes: z.array(z.string()),
  supportedFeatures: z.number().int().nonnegative().optional(),
  temperatureUnit: z.string().optional(),
  minTemperature: z.number().finite().optional(),
  maxTemperature: z.number().finite().optional(),
  targetTemperatureStep: z.number().positive().optional(),
  minHumidity: z.number().finite().optional(),
  maxHumidity: z.number().finite().optional(),
});

export const ClimateEntityDiscoveryResponseSchema = z.strictObject({
  entities: z.array(DiscoveredClimateEntitySchema),
});

export type DiscoveredClimateEntity = z.infer<typeof DiscoveredClimateEntitySchema>;
export type ClimateEntityDiscoveryResponse = z.infer<typeof ClimateEntityDiscoveryResponseSchema>;

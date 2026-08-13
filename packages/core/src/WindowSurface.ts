import * as z from 'zod';

import { WindowSurfaceIdSchema } from './identifiers.js';
import { NonBlankStringSchema } from './schemaPrimitives.js';

export const WindowSurfaceSchema = z.strictObject({
  id: WindowSurfaceIdSchema,
  name: NonBlankStringSchema.optional(),
  azimuth: z.number().min(0).lt(360),
  tilt: z.number().min(0).max(180).optional(),
  area: z.number().positive().optional(),
  relativeSize: z.enum(['small', 'medium', 'large']).optional(),
  shadingFactor: z.number().min(0).max(1).optional(),
  solarGainCoefficient: z.number().min(0).max(1).optional(),
});

export type WindowSurface = z.infer<typeof WindowSurfaceSchema>;

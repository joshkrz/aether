import * as z from 'zod';

export const PlantModeSchema = z.enum(['heat', 'cool']);

export const PlantConstraintsSchema = z.strictObject({
  supportedModes: z
    .array(PlantModeSchema)
    .min(1)
    .refine((modes) => new Set(modes).size === modes.length, 'Modes must be unique'),
  allowMixedHeatCool: z.boolean().optional(),
  maximumActiveControllers: z.number().int().positive().optional(),
  minimumOnMinutes: z.number().nonnegative().optional(),
  minimumOffMinutes: z.number().nonnegative().optional(),
  settlingSeconds: z.number().nonnegative().optional(),
});

export type PlantMode = z.infer<typeof PlantModeSchema>;
export type PlantConstraints = z.infer<typeof PlantConstraintsSchema>;

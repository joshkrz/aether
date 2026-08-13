import * as z from 'zod';

const EntityIdPartSchema = z.string().regex(/^[a-z0-9_]+$/);

export const HomeAssistantEntityIdSchema = z
  .templateLiteral([EntityIdPartSchema, '.', EntityIdPartSchema])
  .brand<'HomeAssistantEntityId'>();

export const ClimateEntityIdSchema = z
  .templateLiteral(['climate.', EntityIdPartSchema])
  .brand<'ClimateEntityId'>();

export const HvacModeSchema = z.enum([
  'off',
  'heat',
  'cool',
  'heat_cool',
  'auto',
  'dry',
  'fan_only',
]);

export type HomeAssistantEntityId = z.infer<typeof HomeAssistantEntityIdSchema>;
export type ClimateEntityId = z.infer<typeof ClimateEntityIdSchema>;
export type HvacMode = z.infer<typeof HvacModeSchema>;

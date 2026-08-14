import * as z from 'zod';

import { DisplayTemperatureUnitSchema, TimeZoneSchema } from './Installation.js';
import { InstallationIdSchema } from './identifiers.js';
import { NonBlankStringSchema } from './schemaPrimitives.js';

const EntityCountSchema = z.number().int().nonnegative();

export const InstallationOverviewTopologySchema = z
  .strictObject({
    valid: z.boolean(),
    errorCount: EntityCountSchema,
    warningCount: EntityCountSchema,
  })
  .refine(({ errorCount, valid }) => valid === (errorCount === 0), {
    message: 'Topology is valid if and only if it has no errors',
    path: ['valid'],
  });

export const InstallationOverviewResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('not_configured'),
  }),
  z.strictObject({
    status: z.literal('configured'),
    installation: z.strictObject({
      id: InstallationIdSchema,
      name: NonBlankStringSchema,
      timeZone: TimeZoneSchema,
      displayTemperatureUnit: DisplayTemperatureUnitSchema,
    }),
    counts: z.strictObject({
      rooms: EntityCountSchema,
      climateControllers: EntityCountSchema,
      plants: EntityCountSchema,
      energySources: EntityCountSchema,
      schedules: EntityCountSchema,
    }),
    topology: InstallationOverviewTopologySchema,
  }),
]);

export type InstallationOverviewTopology = z.infer<typeof InstallationOverviewTopologySchema>;
export type InstallationOverviewResponse = z.infer<typeof InstallationOverviewResponseSchema>;

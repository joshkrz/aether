import * as z from 'zod';

import { NonBlankStringSchema } from './schemaPrimitives.js';

export const InstallationIdSchema = NonBlankStringSchema.brand<'InstallationId'>();
export const RoomIdSchema = NonBlankStringSchema.brand<'RoomId'>();
export const ClimateControllerIdSchema = NonBlankStringSchema.brand<'ClimateControllerId'>();
export const PlantIdSchema = NonBlankStringSchema.brand<'PlantId'>();
export const EnergySourceIdSchema = NonBlankStringSchema.brand<'EnergySourceId'>();
export const ScheduleIdSchema = NonBlankStringSchema.brand<'ScheduleId'>();
export const WindowSurfaceIdSchema = NonBlankStringSchema.brand<'WindowSurfaceId'>();

export type InstallationId = z.infer<typeof InstallationIdSchema>;
export type RoomId = z.infer<typeof RoomIdSchema>;
export type ClimateControllerId = z.infer<typeof ClimateControllerIdSchema>;
export type PlantId = z.infer<typeof PlantIdSchema>;
export type EnergySourceId = z.infer<typeof EnergySourceIdSchema>;
export type ScheduleId = z.infer<typeof ScheduleIdSchema>;
export type WindowSurfaceId = z.infer<typeof WindowSurfaceIdSchema>;

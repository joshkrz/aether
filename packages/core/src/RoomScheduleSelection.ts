import * as z from 'zod';

import { RoomIdSchema, ScheduleIdSchema } from './identifiers.js';

export const RoomScheduleSelectionSchema = z.strictObject({
  roomId: RoomIdSchema,
  baseScheduleId: ScheduleIdSchema.optional(),
  overrideScheduleId: ScheduleIdSchema.optional(),
});

export type RoomScheduleSelection = z.infer<typeof RoomScheduleSelectionSchema>;

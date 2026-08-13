import * as z from 'zod';

import { RoomIdSchema, ScheduleIdSchema } from './identifiers.js';

export const RoomScheduleLinkSchema = z.strictObject({
  roomId: RoomIdSchema,
  scheduleId: ScheduleIdSchema,
});

export type RoomScheduleLink = z.infer<typeof RoomScheduleLinkSchema>;

import * as z from 'zod';

import { ScheduleIdSchema } from './identifiers.js';

export const ScheduleSelectionSchema = z.strictObject({
  mainScheduleId: ScheduleIdSchema.optional(),
  overrideScheduleId: ScheduleIdSchema.optional(),
});

export type ScheduleSelection = z.infer<typeof ScheduleSelectionSchema>;

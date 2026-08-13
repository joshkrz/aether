import * as z from 'zod';

import { ScheduleIdSchema } from './identifiers.js';
import { NonBlankStringSchema } from './schemaPrimitives.js';

export const SchedulePeriodSchema = z
  .strictObject({
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    minimumTemperature: z.number(),
    maximumTemperature: z.number(),
  })
  .superRefine((period, context) => {
    if (period.startMinute >= period.endMinute) {
      context.addIssue({
        code: 'custom',
        message: 'Period end must be after its start within the same day',
        path: ['endMinute'],
      });
    }

    if (period.minimumTemperature > period.maximumTemperature) {
      context.addIssue({
        code: 'custom',
        message: 'Maximum temperature must be greater than or equal to minimum temperature',
        path: ['maximumTemperature'],
      });
    }
  });

export const ScheduleDaySchema = z.array(SchedulePeriodSchema).superRefine((periods, context) => {
  for (let currentIndex = 0; currentIndex < periods.length; currentIndex += 1) {
    const current = periods[currentIndex];

    if (current === undefined) {
      continue;
    }

    for (let otherIndex = currentIndex + 1; otherIndex < periods.length; otherIndex += 1) {
      const other = periods[otherIndex];

      if (
        other !== undefined &&
        current.startMinute < other.endMinute &&
        other.startMinute < current.endMinute
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Schedule periods must not overlap',
          path: [otherIndex],
        });
      }
    }
  }
});

export const ScheduleDaysSchema = z.strictObject({
  monday: ScheduleDaySchema,
  tuesday: ScheduleDaySchema,
  wednesday: ScheduleDaySchema,
  thursday: ScheduleDaySchema,
  friday: ScheduleDaySchema,
  saturday: ScheduleDaySchema,
  sunday: ScheduleDaySchema,
});

export const ScheduleSchema = z.strictObject({
  id: ScheduleIdSchema,
  name: NonBlankStringSchema,
  days: ScheduleDaysSchema,
});

export type SchedulePeriod = z.infer<typeof SchedulePeriodSchema>;
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;
export type ScheduleDays = z.infer<typeof ScheduleDaysSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;

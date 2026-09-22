import * as z from 'zod';

import { ControllerLocationSchema } from './ClimateController.js';
import { HvacModeSchema } from './HomeAssistant.js';
import {
  ClimateControllerIdSchema,
  ScheduleBlockIdSchema,
  ScheduleIdSchema,
} from './identifiers.js';
import { NonBlankStringSchema } from './schemaPrimitives.js';

export const ClimateSettingsSchema = z
  .strictObject({
    hvacMode: HvacModeSchema,
    targetTemperatureCelsius: z.number().finite().optional(),
    targetTemperatureLowCelsius: z.number().finite().optional(),
    targetTemperatureHighCelsius: z.number().finite().optional(),
    targetHumidityPercent: z.number().min(0).max(100).optional(),
    fanMode: NonBlankStringSchema.optional(),
    presetMode: NonBlankStringSchema.optional(),
    swingMode: NonBlankStringSchema.optional(),
    swingHorizontalMode: NonBlankStringSchema.optional(),
  })
  .superRefine((settings, context) => {
    const low = settings.targetTemperatureLowCelsius;
    const high = settings.targetTemperatureHighCelsius;

    if ((low === undefined) !== (high === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'A target temperature range requires both low and high values',
        path: [low === undefined ? 'targetTemperatureLowCelsius' : 'targetTemperatureHighCelsius'],
      });
    }

    if (
      settings.targetTemperatureCelsius !== undefined &&
      (low !== undefined || high !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Choose a single target temperature or a range',
        path: ['targetTemperatureCelsius'],
      });
    }

    if (low !== undefined && high !== undefined && low > high) {
      context.addIssue({
        code: 'custom',
        message: 'Low target temperature must not exceed high target temperature',
        path: ['targetTemperatureHighCelsius'],
      });
    }
  });

export const ScheduleBlockSchema = z
  .strictObject({
    id: ScheduleBlockIdSchema,
    location: ControllerLocationSchema,
    controllerId: ClimateControllerIdSchema,
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    settings: ClimateSettingsSchema,
  })
  .refine(({ startMinute, endMinute }) => startMinute < endMinute, {
    message: 'Block end must be after its start within the same day',
    path: ['endMinute'],
  });

const locationKey = (location: z.infer<typeof ControllerLocationSchema>): string =>
  location.type === 'room' ? `room:${location.roomId}` : `zone:${location.zoneId}`;

export const ScheduleDaySchema = z.array(ScheduleBlockSchema).superRefine((blocks, context) => {
  for (let currentIndex = 0; currentIndex < blocks.length; currentIndex += 1) {
    const current = blocks[currentIndex];

    if (current === undefined) {
      continue;
    }

    for (let otherIndex = currentIndex + 1; otherIndex < blocks.length; otherIndex += 1) {
      const other = blocks[otherIndex];

      if (
        other !== undefined &&
        locationKey(current.location) === locationKey(other.location) &&
        current.startMinute < other.endMinute &&
        other.startMinute < current.endMinute
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Blocks on the same room or zone row must not overlap',
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

export type ClimateSettings = z.infer<typeof ClimateSettingsSchema>;
export type ScheduleBlock = z.infer<typeof ScheduleBlockSchema>;
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;
export type ScheduleDays = z.infer<typeof ScheduleDaysSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;

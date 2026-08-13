import * as z from 'zod';

import { ClimateControllerSchema } from './ClimateController.js';
import { EnergySourceSchema } from './EnergySource.js';
import { InstallationIdSchema } from './identifiers.js';
import { InstallationSafetySettingsSchema } from './InstallationSafetySettings.js';
import { PlantSchema } from './Plant.js';
import { RoomSchema } from './Room.js';
import { RoomControllerLinkSchema } from './RoomControllerLink.js';
import { RoomScheduleLinkSchema } from './RoomScheduleLink.js';
import { RoomScheduleSelectionSchema } from './RoomScheduleSelection.js';
import { ScheduleSchema } from './Schedule.js';
import { NonBlankStringSchema } from './schemaPrimitives.js';

const isSupportedIanaTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
};

export const TimeZoneSchema = NonBlankStringSchema.refine(
  isSupportedIanaTimeZone,
  'Timezone must be a supported IANA timezone identifier',
);

export const DisplayTemperatureUnitSchema = z.enum(['celsius', 'fahrenheit']);

export const InstallationSchema = z.strictObject({
  id: InstallationIdSchema,
  name: NonBlankStringSchema,
  timeZone: TimeZoneSchema,
  displayTemperatureUnit: DisplayTemperatureUnitSchema,
  safety: InstallationSafetySettingsSchema,
  rooms: z.array(RoomSchema),
  climateControllers: z.array(ClimateControllerSchema),
  plants: z.array(PlantSchema),
  energySources: z.array(EnergySourceSchema),
  schedules: z.array(ScheduleSchema),
  roomControllerLinks: z.array(RoomControllerLinkSchema),
  roomScheduleLinks: z.array(RoomScheduleLinkSchema),
  roomScheduleSelections: z.array(RoomScheduleSelectionSchema),
});

export type TimeZone = z.infer<typeof TimeZoneSchema>;
export type DisplayTemperatureUnit = z.infer<typeof DisplayTemperatureUnitSchema>;
export type Installation = z.infer<typeof InstallationSchema>;

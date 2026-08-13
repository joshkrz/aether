import * as z from 'zod';

import { HomeAssistantEntityIdSchema } from './HomeAssistant.js';
import { RoomIdSchema } from './identifiers.js';
import { NonBlankStringSchema } from './schemaPrimitives.js';
import { WindowSurfaceSchema } from './WindowSurface.js';

export const RoomSchema = z.strictObject({
  id: RoomIdSchema,
  name: NonBlankStringSchema,
  temperatureEntityId: HomeAssistantEntityIdSchema,
  humidityEntityId: HomeAssistantEntityIdSchema.optional(),
  windowOrDoorEntityIds: z.array(HomeAssistantEntityIdSchema).optional(),
  windows: z.array(WindowSurfaceSchema).optional(),
});

export type Room = z.infer<typeof RoomSchema>;

import * as z from 'zod';

import { ClimateControllerIdSchema, RoomIdSchema } from './identifiers.js';

export const RoomControllerLinkSchema = z.strictObject({
  roomId: RoomIdSchema,
  controllerId: ClimateControllerIdSchema,
});

export type RoomControllerLink = z.infer<typeof RoomControllerLinkSchema>;

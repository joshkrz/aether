import * as z from 'zod';

import { ZoneIdSchema } from './identifiers.js';
import { NonBlankStringSchema } from './schemaPrimitives.js';

export const ZoneSchema = z.strictObject({
  id: ZoneIdSchema,
  name: NonBlankStringSchema,
});

export type Zone = z.infer<typeof ZoneSchema>;

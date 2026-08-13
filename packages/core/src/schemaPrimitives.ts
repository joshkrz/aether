import * as z from 'zod';

export const NonBlankStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, 'Must not be blank');

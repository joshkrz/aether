import * as z from 'zod';

export const ManualOverridePolicySchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('until_resumed'),
  }),
  z.strictObject({
    type: z.literal('duration'),
    minutes: z.number().int().positive(),
  }),
  z.strictObject({
    type: z.literal('until_next_schedule_block'),
  }),
]);

export type ManualOverridePolicy = z.infer<typeof ManualOverridePolicySchema>;

import { describe, expect, it } from 'vitest';

import { ManualOverridePolicySchema } from './ManualOverride.js';

describe('ManualOverridePolicySchema', () => {
  it.each([
    { type: 'until_resumed' },
    { type: 'duration', minutes: 30 },
    { type: 'until_next_schedule_block' },
  ])('accepts $type', (policy) => {
    expect(ManualOverridePolicySchema.safeParse(policy).success).toBe(true);
  });

  it('requires a positive whole-number duration', () => {
    expect(ManualOverridePolicySchema.safeParse({ type: 'duration', minutes: 0 }).success).toBe(
      false,
    );
    expect(ManualOverridePolicySchema.safeParse({ type: 'duration', minutes: 1.5 }).success).toBe(
      false,
    );
  });

  it('rejects unknown properties', () => {
    expect(
      ManualOverridePolicySchema.safeParse({ type: 'until_resumed', unexpected: true }).success,
    ).toBe(false);
  });
});

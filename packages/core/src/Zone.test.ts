import { describe, expect, it } from 'vitest';

import { ZoneSchema } from './Zone.js';

describe('ZoneSchema', () => {
  it('accepts a named zone without rooms or climate controllers', () => {
    expect(ZoneSchema.safeParse({ id: 'zone-upstairs', name: 'Upstairs' }).success).toBe(true);
  });

  it('rejects embedded membership collections', () => {
    expect(
      ZoneSchema.safeParse({ id: 'zone-upstairs', name: 'Upstairs', roomIds: ['room-bedroom'] })
        .success,
    ).toBe(false);
  });
});

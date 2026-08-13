import { describe, expect, it } from 'vitest';

import { RoomIdSchema } from './identifiers.js';

describe('branded identifiers', () => {
  it('accepts a meaningful identifier', () => {
    expect(RoomIdSchema.safeParse('room-bedroom').success).toBe(true);
  });

  it.each(['', '   '])('rejects an empty identifier: %j', (value) => {
    expect(RoomIdSchema.safeParse(value).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { RoomControllerLinkSchema } from './RoomControllerLink.js';

describe('RoomControllerLinkSchema', () => {
  it('represents one normalized room-controller relationship', () => {
    expect(
      RoomControllerLinkSchema.safeParse({
        roomId: 'room-bedroom',
        controllerId: 'controller-bedroom-ac',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown properties', () => {
    expect(
      RoomControllerLinkSchema.safeParse({
        roomId: 'room-bedroom',
        controllerId: 'controller-bedroom-ac',
        scope: 'local',
      }).success,
    ).toBe(false);
  });
});

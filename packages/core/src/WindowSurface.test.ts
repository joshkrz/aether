import { describe, expect, it } from 'vitest';

import { WindowSurfaceSchema } from './WindowSurface.js';

const validWindow = {
  id: 'window-bedroom-south',
  name: 'Bedroom south window',
  azimuth: 180,
  tilt: 90,
  area: 2.4,
  relativeSize: 'medium',
  shadingFactor: 0.25,
  solarGainCoefficient: 0.7,
} as const;

describe('WindowSurfaceSchema', () => {
  it('accepts a valid window surface', () => {
    expect(WindowSurfaceSchema.safeParse(validWindow).success).toBe(true);
  });

  it('enforces bounded physical values', () => {
    expect(WindowSurfaceSchema.safeParse({ ...validWindow, azimuth: 360 }).success).toBe(false);
    expect(WindowSurfaceSchema.safeParse({ ...validWindow, shadingFactor: 1.1 }).success).toBe(
      false,
    );
  });

  it('rejects unknown properties', () => {
    expect(WindowSurfaceSchema.safeParse({ ...validWindow, unexpected: true }).success).toBe(false);
  });
});

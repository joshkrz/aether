import { describe, expect, it } from 'vitest';

import { InstallationOverviewResponseSchema } from './InstallationOverview.js';

const configuredOverview = {
  status: 'configured',
  installation: {
    id: 'installation-home',
    name: 'Home',
    timeZone: 'Europe/London',
    displayTemperatureUnit: 'celsius',
  },
  counts: {
    rooms: 4,
    climateControllers: 5,
    plants: 2,
    energySources: 2,
    schedules: 3,
  },
  topology: {
    valid: true,
    errorCount: 0,
    warningCount: 1,
  },
} as const;

describe('InstallationOverviewResponseSchema', () => {
  it('accepts an installation that has not been configured', () => {
    expect(
      InstallationOverviewResponseSchema.safeParse({
        status: 'not_configured',
      }).success,
    ).toBe(true);
  });

  it('accepts a configured installation overview', () => {
    expect(InstallationOverviewResponseSchema.safeParse(configuredOverview).success).toBe(true);
  });

  it('rejects unknown fields in either response state', () => {
    expect(
      InstallationOverviewResponseSchema.safeParse({
        status: 'not_configured',
        generatedAt: '2026-08-14T12:00:00.000Z',
      }).success,
    ).toBe(false);

    expect(
      InstallationOverviewResponseSchema.safeParse({
        ...configuredOverview,
        source: 'simulation',
      }).success,
    ).toBe(false);
  });

  it('requires entity counts to be non-negative integers', () => {
    expect(
      InstallationOverviewResponseSchema.safeParse({
        ...configuredOverview,
        counts: {
          ...configuredOverview.counts,
          rooms: -1,
        },
      }).success,
    ).toBe(false);

    expect(
      InstallationOverviewResponseSchema.safeParse({
        ...configuredOverview,
        counts: {
          ...configuredOverview.counts,
          rooms: 1.5,
        },
      }).success,
    ).toBe(false);
  });

  it('requires topology validity to agree with the error count', () => {
    expect(
      InstallationOverviewResponseSchema.safeParse({
        ...configuredOverview,
        topology: {
          valid: true,
          errorCount: 1,
          warningCount: 0,
        },
      }).success,
    ).toBe(false);

    expect(
      InstallationOverviewResponseSchema.safeParse({
        ...configuredOverview,
        topology: {
          valid: false,
          errorCount: 0,
          warningCount: 1,
        },
      }).success,
    ).toBe(false);
  });
});

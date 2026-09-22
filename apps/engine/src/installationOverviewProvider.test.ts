import { describe, expect, it } from 'vitest';

import { InstallationSchema } from '@aether/core';

import { createInstallationOverviewProvider } from './installationOverviewProvider.ts';

const emptyInstallation = InstallationSchema.parse({
  id: 'installation-home',
  name: 'Home',
  timeZone: 'Europe/London',
  displayTemperatureUnit: 'celsius',
  safety: {
    minimumTargetTemperatureCelsius: 5,
    maximumTargetTemperatureCelsius: 35,
    maximumTelemetryAgeSeconds: 300,
    minimumCommandIntervalSeconds: 60,
    commandAcknowledgementTimeoutSeconds: 30,
  },
  zones: [],
  rooms: [],
  climateControllers: [],
  plants: [],
  energySources: [],
  schedules: [],
  scheduleSelection: {},
});

describe('createInstallationOverviewProvider', () => {
  it('returns not configured when the repository is empty', () => {
    const getOverview = createInstallationOverviewProvider({
      loadInstallation: () => undefined,
    });

    expect(getOverview()).toEqual({ status: 'not_configured' });
  });

  it('returns identity, zero counts, and valid topology for an empty installation', () => {
    const getOverview = createInstallationOverviewProvider({
      loadInstallation: () => emptyInstallation,
    });

    expect(getOverview()).toEqual({
      status: 'configured',
      installation: {
        id: 'installation-home',
        name: 'Home',
        timeZone: 'Europe/London',
        displayTemperatureUnit: 'celsius',
      },
      counts: {
        rooms: 0,
        climateControllers: 0,
        plants: 0,
        energySources: 0,
        schedules: 0,
      },
      topology: {
        valid: true,
        errorCount: 0,
        warningCount: 0,
      },
    });
  });

  it('reports no topology warnings for plants awaiting climate entities', () => {
    const installation = InstallationSchema.parse({
      ...emptyInstallation,
      plants: [
        { id: 'plant-heating', name: 'Central Heating', type: 'boiler' },
        { id: 'plant-cooling', name: 'HVAC', type: 'hvac' },
      ],
    });
    const getOverview = createInstallationOverviewProvider({
      loadInstallation: () => installation,
    });

    expect(getOverview()).toMatchObject({
      counts: { plants: 2, climateControllers: 0 },
      topology: { valid: true, errorCount: 0, warningCount: 0 },
    });
  });
});

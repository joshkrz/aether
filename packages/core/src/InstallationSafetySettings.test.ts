import { describe, expect, it } from 'vitest';

import { InstallationSafetySettingsSchema } from './InstallationSafetySettings.js';

const validSafetySettings = {
  minimumTargetTemperatureCelsius: 10,
  maximumTargetTemperatureCelsius: 30,
  maximumTelemetryAgeSeconds: 120,
  minimumCommandIntervalSeconds: 30,
  commandAcknowledgementTimeoutSeconds: 15,
};

describe('InstallationSafetySettingsSchema', () => {
  it('accepts an explicit command-safety envelope', () => {
    expect(InstallationSafetySettingsSchema.safeParse(validSafetySettings).success).toBe(true);
  });

  it.each([30, 29])(
    'rejects maximum temperature %s when the minimum is 30',
    (maximumTargetTemperatureCelsius) => {
      expect(
        InstallationSafetySettingsSchema.safeParse({
          ...validSafetySettings,
          minimumTargetTemperatureCelsius: 30,
          maximumTargetTemperatureCelsius,
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    'maximumTelemetryAgeSeconds',
    'minimumCommandIntervalSeconds',
    'commandAcknowledgementTimeoutSeconds',
  ] as const)('requires a positive %s', (field) => {
    expect(
      InstallationSafetySettingsSchema.safeParse({
        ...validSafetySettings,
        [field]: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects unknown safety settings', () => {
    expect(
      InstallationSafetySettingsSchema.safeParse({
        ...validSafetySettings,
        retryCount: 3,
      }).success,
    ).toBe(false);
  });
});

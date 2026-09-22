import { describe, expect, it } from 'vitest';

import { InstallationSchema, TimeZoneSchema } from './Installation.js';

const validInstallation = {
  id: 'installation-home',
  name: 'Home',
  timeZone: 'Europe/London',
  displayTemperatureUnit: 'celsius',
  safety: {
    minimumTargetTemperatureCelsius: 10,
    maximumTargetTemperatureCelsius: 30,
    maximumTelemetryAgeSeconds: 120,
    minimumCommandIntervalSeconds: 30,
    commandAcknowledgementTimeoutSeconds: 15,
  },
  zones: [],
  rooms: [],
  climateControllers: [],
  plants: [],
  energySources: [],
  schedules: [],
  scheduleSelection: {},
} as const;

describe('TimeZoneSchema', () => {
  it('accepts a supported IANA timezone', () => {
    expect(TimeZoneSchema.safeParse('Europe/London').success).toBe(true);
  });

  it('rejects an unknown timezone', () => {
    expect(TimeZoneSchema.safeParse('Europe/Not_A_Zone').success).toBe(false);
  });
});

describe('InstallationSchema', () => {
  it('accepts an empty installation during initial setup', () => {
    expect(InstallationSchema.safeParse(validInstallation).success).toBe(true);
  });

  it('supports Fahrenheit as a display preference', () => {
    expect(
      InstallationSchema.safeParse({
        ...validInstallation,
        displayTemperatureUnit: 'fahrenheit',
      }).success,
    ).toBe(true);
  });

  it('requires every domain collection', () => {
    expect(
      InstallationSchema.safeParse({
        ...validInstallation,
        schedules: undefined,
      }).success,
    ).toBe(false);
    expect(
      InstallationSchema.safeParse({
        ...validInstallation,
        zones: undefined,
      }).success,
    ).toBe(false);
    expect(
      InstallationSchema.safeParse({
        ...validInstallation,
        scheduleSelection: undefined,
      }).success,
    ).toBe(false);
  });

  it('does not accept room-specific schedule links or selections', () => {
    expect(
      InstallationSchema.safeParse({
        ...validInstallation,
        roomScheduleSelections: [],
      }).success,
    ).toBe(false);
  });

  it('validates entities contained in its collections', () => {
    expect(
      InstallationSchema.safeParse({
        ...validInstallation,
        rooms: [{ id: 'room-bedroom' }],
      }).success,
    ).toBe(false);
  });

  it('does not contain Home Assistant connection details', () => {
    expect(
      InstallationSchema.safeParse({
        ...validInstallation,
        homeAssistant: {
          baseUrl: 'http://homeassistant.local:8123',
        },
      }).success,
    ).toBe(false);
  });
});

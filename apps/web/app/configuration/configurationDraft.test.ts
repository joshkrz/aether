import { describe, expect, it } from 'vitest';

import { InstallationSchema, validateInstallationTopology } from '@aether/core';

import {
  createInstallationDraft,
  createClimateControllerDraft,
  createPlantDraft,
  createRoomDraft,
  createZoneDraft,
} from './configurationDraft';

describe('configuration drafts', () => {
  it('prefills an editable installation with the approved safety values', () => {
    const draft = createInstallationDraft('installation-home', 'Europe/London');

    expect(draft).toMatchObject({
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
    });
    expect(InstallationSchema.safeParse(draft).success).toBe(true);
  });

  it('creates independent plants, zones and optionally unzoned rooms', () => {
    const draft = InstallationSchema.parse({
      ...createInstallationDraft('installation-home', 'Europe/London'),
      plants: [createPlantDraft('plant-one')],
      zones: [createZoneDraft('zone-one')],
      rooms: [createRoomDraft('room-one')],
    });

    expect(draft.rooms[0]?.zoneId).toBeUndefined();
    expect(validateInstallationTopology(draft)).toEqual({ valid: true, issues: [] });
  });

  it('creates a controller from discovered modes with a default manual policy', () => {
    const controller = createClimateControllerDraft(
      'controller-lounge',
      {
        entityId: 'climate.lounge' as ReturnType<
          typeof createInstallationDraft
        >['climateControllers'][number]['entityId'],
        name: 'Lounge',
        available: true,
        hvacModes: ['off', 'heat', 'cool'],
        fanModes: ['high'],
        presetModes: [],
        swingModes: [],
        swingHorizontalModes: [],
      },
      { type: 'zone', zoneId: createZoneDraft('zone-lounge').id },
      createPlantDraft('plant-hvac').id,
    );

    expect(controller).toMatchObject({
      entityId: 'climate.lounge',
      capabilities: { heat: true, cool: true, off: true },
      controlProfile: { heatingMode: 'heat', coolingMode: 'cool', offMode: 'off' },
      manualOverridePolicy: { type: 'until_next_schedule_block' },
    });
  });
});

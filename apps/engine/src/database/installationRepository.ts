import { eq } from 'drizzle-orm';

import { InstallationSchema, type Installation } from '@aether/core';

import type { AetherDatabase } from './createDatabase.ts';
import { installationTable } from './schema.ts';

const installationSingletonKey = 1;

export type InstallationSettings = Pick<
  Installation,
  'id' | 'name' | 'timeZone' | 'displayTemperatureUnit' | 'safety'
>;

export type InstallationRepository = {
  loadInstallation: () => Installation | undefined;
  saveInstallationSettings: (settings: InstallationSettings) => Installation;
};

type InstallationSettingsInput = Omit<InstallationSettings, 'id'> & {
  id: string;
};

const createEmptyInstallation = (settings: InstallationSettingsInput): Installation =>
  InstallationSchema.parse({
    ...settings,
    rooms: [],
    climateControllers: [],
    plants: [],
    energySources: [],
    schedules: [],
    roomControllerLinks: [],
    roomScheduleLinks: [],
    roomScheduleSelections: [],
  });

export const createInstallationRepository = (
  database: AetherDatabase['query'],
): InstallationRepository => ({
  loadInstallation: () => {
    const row = database
      .select()
      .from(installationTable)
      .where(eq(installationTable.singletonKey, installationSingletonKey))
      .get();

    if (row === undefined) {
      return undefined;
    }

    return createEmptyInstallation({
      id: row.id,
      name: row.name,
      timeZone: row.timeZone,
      displayTemperatureUnit: row.displayTemperatureUnit,
      safety: {
        minimumTargetTemperatureCelsius: row.minimumTargetTemperatureCelsius,
        maximumTargetTemperatureCelsius: row.maximumTargetTemperatureCelsius,
        maximumTelemetryAgeSeconds: row.maximumTelemetryAgeSeconds,
        minimumCommandIntervalSeconds: row.minimumCommandIntervalSeconds,
        commandAcknowledgementTimeoutSeconds: row.commandAcknowledgementTimeoutSeconds,
      },
    });
  },
  saveInstallationSettings: (settings) => {
    const installation = createEmptyInstallation(settings);
    const values = {
      singletonKey: installationSingletonKey,
      id: installation.id,
      name: installation.name,
      timeZone: installation.timeZone,
      displayTemperatureUnit: installation.displayTemperatureUnit,
      minimumTargetTemperatureCelsius: installation.safety.minimumTargetTemperatureCelsius,
      maximumTargetTemperatureCelsius: installation.safety.maximumTargetTemperatureCelsius,
      maximumTelemetryAgeSeconds: installation.safety.maximumTelemetryAgeSeconds,
      minimumCommandIntervalSeconds: installation.safety.minimumCommandIntervalSeconds,
      commandAcknowledgementTimeoutSeconds:
        installation.safety.commandAcknowledgementTimeoutSeconds,
    };

    database
      .insert(installationTable)
      .values(values)
      .onConflictDoUpdate({
        target: installationTable.singletonKey,
        set: values,
      })
      .run();

    return installation;
  },
});

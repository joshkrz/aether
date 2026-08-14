import { validateInstallationTopology, type InstallationOverviewResponse } from '@aether/core';

import type { InstallationRepository } from './database/installationRepository.ts';

export type InstallationOverviewProvider = () => unknown | Promise<unknown>;

export const createInstallationOverviewProvider =
  (repository: Pick<InstallationRepository, 'loadInstallation'>): InstallationOverviewProvider =>
  (): InstallationOverviewResponse => {
    const installation = repository.loadInstallation();

    if (installation === undefined) {
      return {
        status: 'not_configured',
      };
    }

    const topology = validateInstallationTopology(installation);
    const errorCount = topology.issues.filter(({ severity }) => severity === 'error').length;
    const warningCount = topology.issues.length - errorCount;

    return {
      status: 'configured',
      installation: {
        id: installation.id,
        name: installation.name,
        timeZone: installation.timeZone,
        displayTemperatureUnit: installation.displayTemperatureUnit,
      },
      counts: {
        rooms: installation.rooms.length,
        climateControllers: installation.climateControllers.length,
        plants: installation.plants.length,
        energySources: installation.energySources.length,
        schedules: installation.schedules.length,
      },
      topology: {
        valid: topology.valid,
        errorCount,
        warningCount,
      },
    };
  };

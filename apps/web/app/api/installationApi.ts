import type { Installation, TopologyValidationResult } from '@aether/core';

import { apiClient } from './apiClient';

export type InstallationOverview =
  | { status: 'not_configured' }
  | {
      status: 'configured';
      installation: {
        id: string;
        name: string;
        timeZone: string;
        displayTemperatureUnit: 'celsius' | 'fahrenheit';
      };
      counts: {
        rooms: number;
        climateControllers: number;
        plants: number;
        energySources: number;
        schedules: number;
      };
      topology: {
        valid: boolean;
        errorCount: number;
        warningCount: number;
      };
    };

export const getInstallationOverview = async (): Promise<InstallationOverview> => {
  const response = await apiClient.get<InstallationOverview>('/installation/overview');
  return response.data;
};

export type InstallationConfiguration =
  | { status: 'not_configured'; revision: 0 }
  | {
      status: 'configured';
      revision: number;
      installation: Installation;
      topology: TopologyValidationResult;
    };

export type SaveInstallationInput = {
  revision: number;
  installation: Installation;
};

export const getInstallationConfiguration = async (): Promise<InstallationConfiguration> => {
  const response = await apiClient.get<InstallationConfiguration>('/installation/configuration');
  return response.data;
};

export const saveInstallationConfiguration = async (
  input: SaveInstallationInput,
): Promise<InstallationConfiguration> => {
  const response = await apiClient.put<InstallationConfiguration>(
    '/installation/configuration',
    input,
  );
  return response.data;
};

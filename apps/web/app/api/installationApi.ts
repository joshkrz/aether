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

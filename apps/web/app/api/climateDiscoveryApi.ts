import {
  ClimateEntityDiscoveryResponseSchema,
  type ClimateEntityDiscoveryResponse,
} from '@aether/core';

import { apiClient } from './apiClient';

export const getClimateEntities = async (): Promise<ClimateEntityDiscoveryResponse> => {
  const response = await apiClient.get<ClimateEntityDiscoveryResponse>(
    '/home-assistant/climate-entities',
  );
  return ClimateEntityDiscoveryResponseSchema.parse(response.data);
};

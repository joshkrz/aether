import { queryOptions } from '@tanstack/vue-query';

import { getClimateEntities } from '../api/climateDiscoveryApi';

export const climateDiscoveryQueryOptions = () =>
  queryOptions({
    queryKey: ['home-assistant', 'climate-entities'] as const,
    queryFn: getClimateEntities,
    retry: 1,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

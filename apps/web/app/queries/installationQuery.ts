import { queryOptions } from '@tanstack/vue-query';

import { getInstallationOverview } from '../api/installationApi';

export const installationQueryKeys = {
  all: ['installation'] as const,
  overview: () => [...installationQueryKeys.all, 'overview'] as const,
};

export const installationOverviewQueryOptions = () =>
  queryOptions({
    queryKey: installationQueryKeys.overview(),
    queryFn: getInstallationOverview,
    retry: 1,
    staleTime: 30_000,
  });

import { mutationOptions, queryOptions } from '@tanstack/vue-query';

import {
  getInstallationConfiguration,
  getInstallationOverview,
  saveInstallationConfiguration,
} from '../api/installationApi';

export const installationQueryKeys = {
  all: ['installation'] as const,
  overview: () => [...installationQueryKeys.all, 'overview'] as const,
  configuration: () => [...installationQueryKeys.all, 'configuration'] as const,
};

export const installationOverviewQueryOptions = () =>
  queryOptions({
    queryKey: installationQueryKeys.overview(),
    queryFn: getInstallationOverview,
    retry: 1,
    staleTime: 30_000,
  });

export const installationConfigurationQueryOptions = () =>
  queryOptions({
    queryKey: installationQueryKeys.configuration(),
    queryFn: getInstallationConfiguration,
    retry: 1,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

export const saveInstallationMutationOptions = () =>
  mutationOptions({
    mutationKey: [...installationQueryKeys.all, 'save-configuration'] as const,
    mutationFn: saveInstallationConfiguration,
  });

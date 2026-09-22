import { describe, expect, it } from 'vitest';

import {
  installationConfigurationQueryOptions,
  installationOverviewQueryOptions,
  installationQueryKeys,
  saveInstallationMutationOptions,
} from './installationQuery';

describe('installationQuery', () => {
  it('defines the installation overview cache policy', () => {
    expect(installationQueryKeys.overview()).toEqual(['installation', 'overview']);
    expect(installationOverviewQueryOptions()).toMatchObject({
      queryKey: ['installation', 'overview'],
      retry: 1,
      staleTime: 30_000,
    });
  });

  it('defines the configuration query and save mutation', () => {
    expect(installationQueryKeys.configuration()).toEqual(['installation', 'configuration']);
    expect(installationConfigurationQueryOptions()).toMatchObject({
      queryKey: ['installation', 'configuration'],
      retry: 1,
      refetchOnWindowFocus: false,
    });
    expect(saveInstallationMutationOptions().mutationKey).toEqual([
      'installation',
      'save-configuration',
    ]);
  });
});

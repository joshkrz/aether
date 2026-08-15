import { describe, expect, it } from 'vitest';

import { installationOverviewQueryOptions, installationQueryKeys } from './installationQuery';

describe('installationQuery', () => {
  it('defines the installation overview cache policy', () => {
    expect(installationQueryKeys.overview()).toEqual(['installation', 'overview']);
    expect(installationOverviewQueryOptions()).toMatchObject({
      queryKey: ['installation', 'overview'],
      retry: 1,
      staleTime: 30_000,
    });
  });
});

import type { AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from './apiClient';
import { getInstallationOverview } from './installationApi';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('installationApi', () => {
  it('loads the protected installation overview', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { status: 'not_configured' },
    } as AxiosResponse<{ status: 'not_configured' }>);

    await expect(getInstallationOverview()).resolves.toEqual({ status: 'not_configured' });
    expect(apiClient.get).toHaveBeenCalledWith('/installation/overview');
  });
});

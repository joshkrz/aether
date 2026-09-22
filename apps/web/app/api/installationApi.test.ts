import type { AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from './apiClient';
import {
  getInstallationConfiguration,
  getInstallationOverview,
  saveInstallationConfiguration,
} from './installationApi';

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

  it('loads and saves the revisioned installation configuration', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { status: 'not_configured', revision: 0 },
    });
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({
      data: { status: 'not_configured', revision: 0 },
    });

    await expect(getInstallationConfiguration()).resolves.toEqual({
      status: 'not_configured',
      revision: 0,
    });
    expect(get).toHaveBeenCalledWith('/installation/configuration');

    const input = { revision: 0, installation: {} } as Parameters<
      typeof saveInstallationConfiguration
    >[0];
    await saveInstallationConfiguration(input);
    expect(put).toHaveBeenCalledWith('/installation/configuration', input);
  });
});

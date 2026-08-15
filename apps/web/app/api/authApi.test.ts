import type { AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from './apiClient';
import { getAuthStatus, logout, reconnectEngine, startEngineSetup, startLogin } from './authApi';

const response = <T>(data: T): AxiosResponse<T> => ({ data }) as AxiosResponse<T>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('authApi', () => {
  it('loads the current authentication status', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue(response({ status: 'setup_required' }));

    await expect(getAuthStatus()).resolves.toEqual({ status: 'setup_required' });
    expect(apiClient.get).toHaveBeenCalledWith('/auth/status');
  });

  it('starts setup with the exact engine request shape', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue(
      response({ authorizationUrl: 'https://ha/auth' }),
    );
    const input = {
      homeAssistantOrigin: 'https://ha.example.com',
      returnPath: '/',
      setupCode: 'setup-code',
    };

    await expect(startEngineSetup(input)).resolves.toEqual({
      authorizationUrl: 'https://ha/auth',
    });
    expect(apiClient.post).toHaveBeenCalledWith('/auth/engine/setup', input);
  });

  it.each([
    ['login', startLogin, '/auth/login'],
    ['engine reconnect', reconnectEngine, '/auth/engine/reconnect'],
  ] as const)('starts %s authorization', async (_name, operation, path) => {
    vi.spyOn(apiClient, 'post').mockResolvedValue(
      response({ authorizationUrl: 'https://ha/auth' }),
    );

    await operation({ returnPath: '/' });

    expect(apiClient.post).toHaveBeenCalledWith(path, { returnPath: '/' });
  });

  it('logs out the current session', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue(response(undefined));

    await expect(logout()).resolves.toBeUndefined();
    expect(apiClient.post).toHaveBeenCalledWith('/auth/logout');
  });
});

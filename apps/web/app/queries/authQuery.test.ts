import { QueryClient } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';

import {
  authQueryKeys,
  authStatusQueryOptions,
  engineReconnectMutationOptions,
  engineSetupMutationOptions,
  loginMutationOptions,
  logoutMutationOptions,
} from './authQuery';

describe('authQuery', () => {
  it('keeps authentication state under one context key', () => {
    expect(authQueryKeys.status()).toEqual(['auth', 'status']);
    expect(authStatusQueryOptions()).toMatchObject({
      queryKey: ['auth', 'status'],
      retry: false,
      staleTime: 0,
    });
  });

  it('defines distinct mutation keys for each authorization purpose', () => {
    expect(engineSetupMutationOptions().mutationKey).toEqual(['auth', 'engine-setup']);
    expect(loginMutationOptions().mutationKey).toEqual(['auth', 'login']);
    expect(engineReconnectMutationOptions().mutationKey).toEqual(['auth', 'engine-reconnect']);
  });

  it('invalidates authentication state after logout', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    const options = logoutMutationOptions(queryClient);

    await options.onSuccess?.(undefined, undefined, undefined, {} as never);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: authQueryKeys.all });
  });
});

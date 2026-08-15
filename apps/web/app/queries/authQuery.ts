import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/vue-query';

import {
  getAuthStatus,
  logout,
  reconnectEngine,
  startEngineSetup,
  startLogin,
} from '../api/authApi';

export const authQueryKeys = {
  all: ['auth'] as const,
  status: () => [...authQueryKeys.all, 'status'] as const,
};

export const authStatusQueryOptions = () =>
  queryOptions({
    queryKey: authQueryKeys.status(),
    queryFn: getAuthStatus,
    retry: false,
    staleTime: 0,
  });

export const engineSetupMutationOptions = () =>
  mutationOptions({
    mutationKey: [...authQueryKeys.all, 'engine-setup'] as const,
    mutationFn: startEngineSetup,
  });

export const loginMutationOptions = () =>
  mutationOptions({
    mutationKey: [...authQueryKeys.all, 'login'] as const,
    mutationFn: startLogin,
  });

export const engineReconnectMutationOptions = () =>
  mutationOptions({
    mutationKey: [...authQueryKeys.all, 'engine-reconnect'] as const,
    mutationFn: reconnectEngine,
  });

export const logoutMutationOptions = (queryClient: QueryClient) =>
  mutationOptions({
    mutationKey: [...authQueryKeys.all, 'logout'] as const,
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.all });
    },
  });

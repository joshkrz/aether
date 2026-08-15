import { apiClient } from './apiClient';

export type AuthStatus =
  | { status: 'setup_required' }
  | { status: 'unauthenticated' }
  | {
      status: 'authenticated';
      user: {
        displayName: string;
        isAdmin: boolean;
        isOwner: boolean;
      };
    };

export type EngineSetupInput = {
  homeAssistantOrigin: string;
  returnPath: string;
  setupCode: string;
};

export type AuthorizationInput = {
  returnPath: string;
};

export type AuthorizationStart = {
  authorizationUrl: string;
};

export const getAuthStatus = async (): Promise<AuthStatus> => {
  const response = await apiClient.get<AuthStatus>('/auth/status');
  return response.data;
};

export const startEngineSetup = async (input: EngineSetupInput): Promise<AuthorizationStart> => {
  const response = await apiClient.post<AuthorizationStart>('/auth/engine/setup', input);
  return response.data;
};

export const startLogin = async (input: AuthorizationInput): Promise<AuthorizationStart> => {
  const response = await apiClient.post<AuthorizationStart>('/auth/login', input);
  return response.data;
};

export const reconnectEngine = async (input: AuthorizationInput): Promise<AuthorizationStart> => {
  const response = await apiClient.post<AuthorizationStart>('/auth/engine/reconnect', input);
  return response.data;
};

export const logout = async (): Promise<void> => {
  await apiClient.post('/auth/logout');
};

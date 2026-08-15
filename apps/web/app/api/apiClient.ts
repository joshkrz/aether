import axios from 'axios';

import { normalizeApiError } from './apiError';

export const apiClient = axios.create({
  baseURL: '/api/v1',
  headers: {
    Accept: 'application/json',
  },
  timeout: 10_000,
  withCredentials: true,
  xsrfCookieName: 'aether_csrf',
  xsrfHeaderName: 'X-Aether-CSRF',
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => Promise.reject(normalizeApiError(error)),
);

import { describe, expect, it } from 'vitest';

import { apiClient } from './apiClient';

describe('apiClient', () => {
  it('uses the same-origin API and Aether CSRF contract', () => {
    expect(apiClient.defaults).toMatchObject({
      baseURL: '/api/v1',
      timeout: 10_000,
      withCredentials: true,
      xsrfCookieName: 'aether_csrf',
      xsrfHeaderName: 'X-Aether-CSRF',
    });
  });
});

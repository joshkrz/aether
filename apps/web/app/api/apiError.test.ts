import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';

import { normalizeApiError } from './apiError';

const axiosError = (response?: Pick<AxiosResponse, 'data' | 'status'>): AxiosError => {
  const error = new AxiosError('Request failed');

  if (response !== undefined) {
    error.response = {
      config: { headers: {} },
      headers: {},
      statusText: '',
      ...response,
    } as AxiosResponse;
  }

  return error;
};

describe('normalizeApiError', () => {
  it('preserves the engine error code and HTTP status', () => {
    expect(
      normalizeApiError(axiosError({ data: { error: { code: 'unauthenticated' } }, status: 401 })),
    ).toMatchObject({ code: 'unauthenticated', message: 'Request failed', status: 401 });
  });

  it('distinguishes network failures from unstructured responses', () => {
    expect(normalizeApiError(axiosError())).toMatchObject({ code: 'network_error' });
    expect(normalizeApiError(axiosError({ data: {}, status: 500 }))).toMatchObject({
      code: 'request_failed',
      status: 500,
    });
  });
});

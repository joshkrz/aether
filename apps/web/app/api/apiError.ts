import { isAxiosError } from 'axios';

type ApiErrorBody = {
  error?: {
    code?: unknown;
  };
};

export type ApiError = Error & {
  code: string;
  status?: number;
};

const isApiError = (error: unknown): error is ApiError =>
  error instanceof Error && 'code' in error && typeof error.code === 'string';

const readErrorCode = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }

  const code = (body as ApiErrorBody).error?.code;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
};

const createApiError = (message: string, code: string, status?: number): ApiError =>
  Object.assign(new Error(message), {
    code,
    ...(status === undefined ? {} : { status }),
  });

export const normalizeApiError = (error: unknown): ApiError => {
  if (isApiError(error)) {
    return error;
  }

  if (isAxiosError(error)) {
    const status = error.response?.status;
    const code =
      readErrorCode(error.response?.data) ??
      (error.response === undefined ? 'network_error' : 'request_failed');

    return createApiError(error.message, code, status);
  }

  return createApiError(
    error instanceof Error ? error.message : 'Unknown API error',
    'unknown_error',
  );
};

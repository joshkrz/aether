import type { AuthRepository } from './authRepository.ts';
import type { createAuthCookieManager } from './authCookies.ts';
import type { createAuthSessionService } from './authSessionService.ts';
import { HomeAssistantAuthClientError } from './homeAssistantOAuthClient.ts';
import type { InitialSetupCode } from './initialSetupCode.ts';
import type { createOAuthFlowService } from './oauthFlowService.ts';
import { authSecretMatchesHash, hashAuthSecret } from './tokenEncryption.ts';

const authStatusPath = '/api/v1/auth/status';
const engineSetupPath = '/api/v1/auth/engine/setup';
const userLoginPath = '/api/v1/auth/login';
const engineReconnectPath = '/api/v1/auth/engine/reconnect';
const oauthCallbackPath = '/api/v1/auth/callback';
const logoutPath = '/api/v1/auth/logout';
const authErrorPath = '/auth/error';
export const maximumAuthJsonBodyBytes = 16 * 1_024;
const maximumInputLength = 2_048;
const authSecretPattern = /^[\w-]{43}$/u;

type AuthCookieManager = ReturnType<typeof createAuthCookieManager>;
type AuthSessionService = ReturnType<typeof createAuthSessionService>;
type OAuthFlowService = ReturnType<typeof createOAuthFlowService>;

type AuthHttpWarning = {
  code: 'auth_http_operation_failed';
  operation: 'authorization_callback' | 'authorization_start';
};

type AuthHttpHandlerOptions = {
  authCookies: AuthCookieManager;
  authRepository: Pick<AuthRepository, 'loadHomeAssistantConnection'>;
  authSessionService: AuthSessionService;
  initialSetupCode?: InitialSetupCode;
  nowEpochSeconds?: () => number;
  oauthFlowService: OAuthFlowService;
  onWarning: (warning: AuthHttpWarning) => void;
  publicOrigin: string;
};

export type AuthHttpRequest = {
  body?: Uint8Array;
  headers: {
    contentType?: string;
    cookie?: string;
    csrfToken?: string;
    origin?: string;
  };
  method: string;
  pathname: string;
  searchParams?: URLSearchParams;
};

export type AuthHttpResponse = {
  body?: string;
  headers: Readonly<Record<string, string | readonly string[]>>;
  statusCode: number;
};

export type AuthHttpHandler = (request: AuthHttpRequest) => Promise<AuthHttpResponse | undefined>;

type JsonObject = Record<string, unknown>;

type AuthenticatedSession = Extract<
  Awaited<ReturnType<AuthSessionService['authenticateSession']>>,
  { status: 'authenticated' }
>['session'];

type AuthenticatedRequestResult =
  | { response: AuthHttpResponse; status: 'rejected' }
  | { session: AuthenticatedSession; status: 'authenticated' };

export type AuthHttpBoundary = {
  authenticateReadRequest: (
    cookieHeader: string | undefined,
  ) => Promise<AuthenticatedRequestResult>;
  handleRequest: AuthHttpHandler;
};

const defaultNowEpochSeconds = (): number => Math.floor(Date.now() / 1_000);

const normalizePublicOrigin = (value: string): string => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('Auth HTTP public origin must be a valid absolute HTTP(S) origin');
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error('Auth HTTP public origin must be an absolute HTTP(S) origin only');
  }

  return url.origin;
};

const assertEpochSeconds = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Auth HTTP clock must return a non-negative safe integer epoch timestamp');
  }

  return value;
};

const jsonResponse = (
  statusCode: number,
  body: unknown,
  headers: Readonly<Record<string, string | readonly string[]>> = {},
): AuthHttpResponse => ({
  body: JSON.stringify(body),
  headers: {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  },
  statusCode,
});

const emptyResponse = (
  statusCode: number,
  headers: Readonly<Record<string, string | readonly string[]>> = {},
): AuthHttpResponse => ({
  headers: {
    'cache-control': 'no-store',
    ...headers,
  },
  statusCode,
});

const errorResponse = (
  statusCode: number,
  code: string,
  headers: Readonly<Record<string, string | readonly string[]>> = {},
): AuthHttpResponse => jsonResponse(statusCode, { error: { code } }, headers);

const methodNotAllowed = (allowedMethod: 'GET' | 'POST'): AuthHttpResponse =>
  errorResponse(405, 'method_not_allowed', { allow: allowedMethod });

const redirectResponse = (location: string, setCookies: readonly string[]): AuthHttpResponse =>
  emptyResponse(303, {
    location,
    'set-cookie': setCookies,
  });

const callbackErrorResponse = (code: string, clearOAuthBindingCookie: string): AuthHttpResponse =>
  redirectResponse(`${authErrorPath}?code=${encodeURIComponent(code)}`, [clearOAuthBindingCookie]);

const isJsonContentType = (value: string | undefined): boolean =>
  value?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';

const parseJsonObject = (
  request: AuthHttpRequest,
): { status: 'parsed'; value: JsonObject } | { response: AuthHttpResponse; status: 'rejected' } => {
  if (!isJsonContentType(request.headers.contentType)) {
    return { response: errorResponse(415, 'unsupported_media_type'), status: 'rejected' };
  }

  if (request.body === undefined || request.body.byteLength === 0) {
    return { response: errorResponse(400, 'invalid_request_body'), status: 'rejected' };
  }

  if (request.body.byteLength > maximumAuthJsonBodyBytes) {
    return { response: errorResponse(413, 'request_body_too_large'), status: 'rejected' };
  }

  try {
    const value: unknown = JSON.parse(Buffer.from(request.body).toString('utf8'));

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { response: errorResponse(400, 'invalid_request_body'), status: 'rejected' };
    }

    return { status: 'parsed', value: value as JsonObject };
  } catch {
    return { response: errorResponse(400, 'invalid_request_body'), status: 'rejected' };
  }
};

const exactStringFields = <FieldName extends string>(
  value: JsonObject,
  fieldNames: readonly FieldName[],
): Record<FieldName, string> | undefined => {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...fieldNames].sort();

  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    return undefined;
  }

  const fields = {} as Record<FieldName, string>;

  for (const fieldName of fieldNames) {
    const field = value[fieldName];

    if (typeof field !== 'string' || field.length === 0 || field.length > maximumInputLength) {
      return undefined;
    }

    fields[fieldName] = field;
  }

  return fields;
};

const isSafeReturnPath = (value: string): boolean => {
  const containsControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });

  return (
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !containsControlCharacter
  );
};

const normalizeHomeAssistantOrigin = (value: string): string | undefined => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return undefined;
  }

  return url.origin;
};

const singleQueryValue = (searchParams: URLSearchParams, name: string): string | undefined => {
  const values = searchParams.getAll(name);
  return values.length === 1 &&
    values[0] !== undefined &&
    values[0].length > 0 &&
    values[0].length <= maximumInputLength
    ? values[0]
    : undefined;
};

const isSetupComplete = (
  connection: ReturnType<AuthRepository['loadHomeAssistantConnection']>,
): boolean => connection?.connectedAtEpochSeconds !== undefined;

const csrfTokensMatch = (cookieToken: string, headerToken: string): boolean =>
  authSecretMatchesHash(headerToken, hashAuthSecret(cookieToken));

const callbackErrorCode = (error: unknown): string => {
  if (!(error instanceof HomeAssistantAuthClientError)) {
    return 'authorization_failed';
  }

  if (error.code === 'timeout' || error.code === 'unavailable') {
    return 'home_assistant_unavailable';
  }

  return error.code === 'rejected' ? 'authorization_rejected' : 'authorization_failed';
};

export const createAuthHttpBoundary = (options: AuthHttpHandlerOptions): AuthHttpBoundary => {
  const publicOrigin = normalizePublicOrigin(options.publicOrigin);
  const nowEpochSeconds = options.nowEpochSeconds ?? defaultNowEpochSeconds;
  const readNow = (): number => assertEpochSeconds(nowEpochSeconds());

  const emitWarning = (warning: AuthHttpWarning): void => {
    try {
      options.onWarning(warning);
    } catch {
      // Diagnostics must not change HTTP authentication outcomes.
    }
  };

  const requireOrigin = (request: AuthHttpRequest): AuthHttpResponse | undefined =>
    request.headers.origin === publicOrigin ? undefined : errorResponse(403, 'invalid_origin');

  const rejectUnauthenticated = (clearCookies: boolean): AuthHttpResponse =>
    errorResponse(
      401,
      'unauthenticated',
      clearCookies ? { 'set-cookie': options.authCookies.clearSessionCookies() } : {},
    );

  const authenticateReadRequest = async (
    cookieHeader: string | undefined,
  ): Promise<AuthenticatedRequestResult> => {
    const cookies = options.authCookies.readCookies(cookieHeader);

    if (cookies.sessionToken === undefined) {
      return {
        response: rejectUnauthenticated(cookieHeader !== undefined),
        status: 'rejected',
      };
    }

    const authentication = await options.authSessionService.authenticateSession(
      cookies.sessionToken,
    );

    return authentication.status === 'authenticated'
      ? authentication
      : { response: rejectUnauthenticated(true), status: 'rejected' };
  };

  const authenticateUnsafeRequest = async (
    request: AuthHttpRequest,
  ): Promise<AuthenticatedRequestResult> => {
    const cookies = options.authCookies.readCookies(request.headers.cookie);

    if (cookies.sessionToken === undefined) {
      return {
        response: rejectUnauthenticated(request.headers.cookie !== undefined),
        status: 'rejected',
      };
    }

    if (
      cookies.csrfToken === undefined ||
      request.headers.csrfToken === undefined ||
      !csrfTokensMatch(cookies.csrfToken, request.headers.csrfToken)
    ) {
      return { response: errorResponse(403, 'invalid_csrf_token'), status: 'rejected' };
    }

    const authentication = await options.authSessionService.authenticateSessionWithCsrf(
      cookies.sessionToken,
      cookies.csrfToken,
    );

    return authentication.status === 'authenticated'
      ? authentication
      : { response: rejectUnauthenticated(true), status: 'rejected' };
  };

  const beginAuthorization = (
    input:
      | { homeAssistantOrigin: string; purpose: 'engine_setup'; returnPath: string }
      | { purpose: 'engine_reconnect' | 'user_login'; returnPath: string },
  ): AuthHttpResponse => {
    try {
      const result = options.oauthFlowService.beginAuthorization(input);
      const bindingCookie = options.authCookies.createOAuthBindingCookie({
        browserBindingSecret: result.browserBindingSecret,
        expiresAtEpochSeconds: result.expiresAtEpochSeconds,
        nowEpochSeconds: readNow(),
      });

      return jsonResponse(
        200,
        { authorizationUrl: result.authorizationUrl },
        {
          'set-cookie': bindingCookie,
        },
      );
    } catch {
      emitWarning({ code: 'auth_http_operation_failed', operation: 'authorization_start' });
      return errorResponse(500, 'authorization_start_failed');
    }
  };

  const handleStatus = async (request: AuthHttpRequest): Promise<AuthHttpResponse> => {
    if (request.method !== 'GET') {
      return methodNotAllowed('GET');
    }

    if (!isSetupComplete(options.authRepository.loadHomeAssistantConnection())) {
      return jsonResponse(200, { status: 'setup_required' });
    }

    const authentication = await authenticateReadRequest(request.headers.cookie);

    if (authentication.status === 'rejected') {
      const clearCookies = authentication.response.headers['set-cookie'];
      return jsonResponse(
        200,
        { status: 'unauthenticated' },
        clearCookies === undefined ? {} : { 'set-cookie': clearCookies },
      );
    }

    return jsonResponse(200, {
      status: 'authenticated',
      user: {
        displayName: authentication.session.displayName,
        isAdmin: authentication.session.isAdmin,
        isOwner: authentication.session.isOwner,
      },
    });
  };

  const handleEngineSetup = (request: AuthHttpRequest): AuthHttpResponse => {
    if (request.method !== 'POST') {
      return methodNotAllowed('POST');
    }

    const originRejection = requireOrigin(request);

    if (originRejection !== undefined) {
      return originRejection;
    }

    if (isSetupComplete(options.authRepository.loadHomeAssistantConnection())) {
      return errorResponse(409, 'setup_complete');
    }

    if (options.initialSetupCode === undefined) {
      emitWarning({ code: 'auth_http_operation_failed', operation: 'authorization_start' });
      return errorResponse(503, 'initial_setup_unavailable');
    }

    const parsed = parseJsonObject(request);

    if (parsed.status === 'rejected') {
      return parsed.response;
    }

    const fields = exactStringFields(parsed.value, [
      'homeAssistantOrigin',
      'returnPath',
      'setupCode',
    ]);

    if (fields === undefined) {
      return errorResponse(400, 'invalid_request_body');
    }

    if (!options.initialSetupCode.matches(fields['setupCode'])) {
      return errorResponse(403, 'invalid_setup_code');
    }

    const homeAssistantOrigin = normalizeHomeAssistantOrigin(fields.homeAssistantOrigin);
    const returnPath = fields.returnPath;

    if (homeAssistantOrigin === undefined || !isSafeReturnPath(returnPath)) {
      return errorResponse(400, 'invalid_request_body');
    }

    return beginAuthorization({ homeAssistantOrigin, purpose: 'engine_setup', returnPath });
  };

  const handleUserLogin = (request: AuthHttpRequest): AuthHttpResponse => {
    if (request.method !== 'POST') {
      return methodNotAllowed('POST');
    }

    const originRejection = requireOrigin(request);

    if (originRejection !== undefined) {
      return originRejection;
    }

    if (!isSetupComplete(options.authRepository.loadHomeAssistantConnection())) {
      return errorResponse(409, 'setup_required');
    }

    const parsed = parseJsonObject(request);

    if (parsed.status === 'rejected') {
      return parsed.response;
    }

    const fields = exactStringFields(parsed.value, ['returnPath']);
    const returnPath = fields?.['returnPath'];

    if (returnPath === undefined || !isSafeReturnPath(returnPath)) {
      return errorResponse(400, 'invalid_request_body');
    }

    return beginAuthorization({ purpose: 'user_login', returnPath });
  };

  const handleEngineReconnect = async (request: AuthHttpRequest): Promise<AuthHttpResponse> => {
    if (request.method !== 'POST') {
      return methodNotAllowed('POST');
    }

    const originRejection = requireOrigin(request);

    if (originRejection !== undefined) {
      return originRejection;
    }

    const authentication = await authenticateUnsafeRequest(request);

    if (authentication.status === 'rejected') {
      return authentication.response;
    }

    if (!authentication.session.isAdmin) {
      return errorResponse(403, 'administrator_required');
    }

    if (!isSetupComplete(options.authRepository.loadHomeAssistantConnection())) {
      return errorResponse(409, 'setup_required');
    }

    const parsed = parseJsonObject(request);

    if (parsed.status === 'rejected') {
      return parsed.response;
    }

    const fields = exactStringFields(parsed.value, ['returnPath']);
    const returnPath = fields?.['returnPath'];

    if (returnPath === undefined || !isSafeReturnPath(returnPath)) {
      return errorResponse(400, 'invalid_request_body');
    }

    return beginAuthorization({ purpose: 'engine_reconnect', returnPath });
  };

  const handleCallback = async (request: AuthHttpRequest): Promise<AuthHttpResponse> => {
    if (request.method !== 'GET') {
      return methodNotAllowed('GET');
    }

    const clearBindingCookie = options.authCookies.clearOAuthBindingCookie();
    const cookies = options.authCookies.readCookies(request.headers.cookie);
    const searchParams = request.searchParams ?? new URLSearchParams();
    const stateSecret = singleQueryValue(searchParams, 'state');
    const authorizationCode = singleQueryValue(searchParams, 'code');
    const providerError = singleQueryValue(searchParams, 'error');

    if (
      cookies.oauthBindingSecret === undefined ||
      stateSecret === undefined ||
      !authSecretPattern.test(stateSecret)
    ) {
      return callbackErrorResponse('invalid_oauth_transaction', clearBindingCookie);
    }

    if (
      (authorizationCode === undefined && providerError === undefined) ||
      (authorizationCode !== undefined && providerError !== undefined)
    ) {
      return callbackErrorResponse('invalid_oauth_callback', clearBindingCookie);
    }

    try {
      const result = await options.oauthFlowService.completeAuthorization({
        ...(authorizationCode === undefined ? {} : { authorizationCode }),
        browserBindingSecret: cookies.oauthBindingSecret,
        stateSecret,
      });

      if (result.status === 'invalid_transaction') {
        return callbackErrorResponse('invalid_oauth_transaction', clearBindingCookie);
      }

      if (result.status === 'authorization_denied') {
        return callbackErrorResponse('authorization_denied', clearBindingCookie);
      }

      if (result.status === 'engine_reconnected') {
        return redirectResponse(result.returnPath, [clearBindingCookie]);
      }

      const sessionCookies = options.authCookies.createSessionCookies({
        csrfToken: result.csrfToken,
        expiresAtEpochSeconds: result.expiresAtEpochSeconds,
        nowEpochSeconds: readNow(),
        sessionToken: result.sessionToken,
      });

      return redirectResponse(result.returnPath, [...sessionCookies, clearBindingCookie]);
    } catch (error) {
      emitWarning({ code: 'auth_http_operation_failed', operation: 'authorization_callback' });
      return callbackErrorResponse(callbackErrorCode(error), clearBindingCookie);
    }
  };

  const handleLogout = async (request: AuthHttpRequest): Promise<AuthHttpResponse> => {
    if (request.method !== 'POST') {
      return methodNotAllowed('POST');
    }

    const originRejection = requireOrigin(request);

    if (originRejection !== undefined) {
      return originRejection;
    }

    const cookies = options.authCookies.readCookies(request.headers.cookie);

    if (cookies.sessionToken === undefined) {
      return rejectUnauthenticated(request.headers.cookie !== undefined);
    }

    if (
      cookies.csrfToken === undefined ||
      request.headers.csrfToken === undefined ||
      !csrfTokensMatch(cookies.csrfToken, request.headers.csrfToken)
    ) {
      return errorResponse(403, 'invalid_csrf_token');
    }

    const logout = await options.authSessionService.logout(cookies.sessionToken, cookies.csrfToken);

    return logout.status === 'logged_out'
      ? emptyResponse(204, { 'set-cookie': options.authCookies.clearSessionCookies() })
      : rejectUnauthenticated(true);
  };

  const handleRequest: AuthHttpHandler = async (request) => {
    switch (request.pathname) {
      case authStatusPath:
        return handleStatus(request);
      case engineSetupPath:
        return handleEngineSetup(request);
      case userLoginPath:
        return handleUserLogin(request);
      case engineReconnectPath:
        return handleEngineReconnect(request);
      case oauthCallbackPath:
        return handleCallback(request);
      case logoutPath:
        return handleLogout(request);
      default:
        return undefined;
    }
  };

  return { authenticateReadRequest, handleRequest };
};

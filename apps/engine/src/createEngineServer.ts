import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { InstallationOverviewResponseSchema } from '@aether/core';

import type { AuthHttpBoundary } from './auth/authHttpHandler.ts';
import { createAuthNodeAdapter, writeAuthNodeResponse } from './auth/authNodeAdapter.ts';
import type { InstallationOverviewProvider } from './installationOverviewProvider.ts';
import { parseRequestPath, serveGeneratedWebApp } from './serveGeneratedWebApp.ts';

const healthPath = '/api/v1/health';
const installationOverviewPath = '/api/v1/installation/overview';

export interface EngineServerOptions {
  auth: AuthHttpBoundary;
  getInstallationOverview: InstallationOverviewProvider;
  webRoot?: string;
}

const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.statusCode = statusCode;
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
};

const isApiPath = (pathname: string): boolean =>
  pathname === '/api' || pathname.startsWith('/api/');

const handleRequest = async (
  { auth, getInstallationOverview, webRoot }: EngineServerOptions,
  handleAuthRequest: ReturnType<typeof createAuthNodeAdapter>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const requestUrl = request.url ?? '/';
  const method = request.method ?? 'GET';
  const requestPath = parseRequestPath(requestUrl);

  if (!requestPath.success) {
    request.resume();
    writeJson(response, 400, {
      error: {
        code: 'invalid_request_path',
      },
    });
    return;
  }

  const { pathname } = requestPath;

  if (pathname === healthPath) {
    request.resume();

    if (method !== 'GET') {
      response.setHeader('allow', 'GET');
      writeJson(response, 405, {
        error: {
          code: 'method_not_allowed',
        },
      });
      return;
    }

    writeJson(response, 200, { status: 'ok' });
    return;
  }

  if (await handleAuthRequest(request, response, pathname)) {
    return;
  }

  if (pathname !== installationOverviewPath) {
    request.resume();

    if (isApiPath(pathname) || webRoot === undefined) {
      writeJson(response, 404, {
        error: {
          code: 'not_found',
        },
      });
      return;
    }

    await serveGeneratedWebApp({
      method,
      pathname,
      response,
      webRoot,
    });
    return;
  }

  request.resume();

  if (method !== 'GET') {
    response.setHeader('allow', 'GET');
    writeJson(response, 405, {
      error: {
        code: 'method_not_allowed',
      },
    });
    return;
  }

  const authentication = await auth.authenticateReadRequest(request.headers.cookie);

  if (authentication.status === 'rejected') {
    writeAuthNodeResponse(response, authentication.response);
    return;
  }

  try {
    const overview = InstallationOverviewResponseSchema.safeParse(await getInstallationOverview());

    if (!overview.success) {
      writeJson(response, 500, {
        error: {
          code: 'invalid_installation_overview',
        },
      });
      return;
    }

    writeJson(response, 200, overview.data);
  } catch {
    writeJson(response, 500, {
      error: {
        code: 'installation_overview_unavailable',
      },
    });
  }
};

export const createEngineServer = (options: EngineServerOptions) => {
  const handleAuthRequest = createAuthNodeAdapter({ handleRequest: options.auth.handleRequest });

  return createServer((request, response) => {
    void handleRequest(options, handleAuthRequest, request, response).catch(() => {
      if (response.headersSent) {
        response.destroy();
        return;
      }

      writeJson(response, 500, {
        error: {
          code: 'internal_server_error',
        },
      });
    });
  });
};

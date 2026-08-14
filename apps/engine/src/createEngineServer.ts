import { createServer, type ServerResponse } from 'node:http';

import { InstallationOverviewResponseSchema } from '@aether/core';

import type { InstallationOverviewProvider } from './installationOverviewProvider.ts';
import { parseRequestPath, serveGeneratedWebApp } from './serveGeneratedWebApp.ts';

const installationOverviewPath = '/api/v1/installation/overview';

export interface EngineServerOptions {
  getInstallationOverview: InstallationOverviewProvider;
  webRoot?: string;
}

const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
};

const isApiPath = (pathname: string): boolean =>
  pathname === '/api' || pathname.startsWith('/api/');

const handleRequest = async (
  { getInstallationOverview, webRoot }: EngineServerOptions,
  requestUrl: string,
  method: string,
  response: ServerResponse,
): Promise<void> => {
  const requestPath = parseRequestPath(requestUrl);

  if (!requestPath.success) {
    writeJson(response, 400, {
      error: {
        code: 'invalid_request_path',
      },
    });
    return;
  }

  const { pathname } = requestPath;

  if (pathname !== installationOverviewPath) {
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

  if (method !== 'GET') {
    response.setHeader('allow', 'GET');
    writeJson(response, 405, {
      error: {
        code: 'method_not_allowed',
      },
    });
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

export const createEngineServer = (options: EngineServerOptions) =>
  createServer((request, response) => {
    void handleRequest(options, request.url ?? '/', request.method ?? 'GET', response).catch(() => {
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

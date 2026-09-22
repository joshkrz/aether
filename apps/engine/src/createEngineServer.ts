import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { InstallationOverviewResponseSchema } from '@aether/core';

import type { AuthHttpBoundary } from './auth/authHttpHandler.ts';
import {
  createAuthNodeAdapter,
  readAuthNodeRequestBody,
  writeAuthNodeResponse,
} from './auth/authNodeAdapter.ts';
import type { InstallationRepository } from './database/installationRepository.ts';
import {
  ClimateDiscoveryError,
  type ClimateEntityDiscovery,
} from './homeAssistantClimateDiscovery.ts';
import {
  createInstallationConfigurationHandler,
  maximumConfigurationJsonBodyBytes,
} from './installationConfigurationHandler.ts';
import type { InstallationOverviewProvider } from './installationOverviewProvider.ts';
import { parseRequestPath, serveGeneratedWebApp } from './serveGeneratedWebApp.ts';

const healthPath = '/api/v1/health';
const installationOverviewPath = '/api/v1/installation/overview';
const installationConfigurationPath = '/api/v1/installation/configuration';
const climateEntitiesPath = '/api/v1/home-assistant/climate-entities';

export interface EngineServerOptions {
  auth: AuthHttpBoundary;
  getClimateEntities: ClimateEntityDiscovery;
  getInstallationOverview: InstallationOverviewProvider;
  installationRepository: Pick<
    InstallationRepository,
    'loadInstallationWithRevision' | 'saveInstallation'
  >;
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
  {
    auth,
    getClimateEntities,
    getInstallationOverview,
    installationRepository,
    webRoot,
  }: EngineServerOptions,
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

  if (pathname === climateEntitiesPath) {
    request.resume();

    if (method !== 'GET') {
      response.setHeader('allow', 'GET');
      writeJson(response, 405, { error: { code: 'method_not_allowed' } });
      return;
    }

    const authentication = await auth.authenticateReadRequest(request.headers.cookie);
    if (authentication.status === 'rejected') {
      writeAuthNodeResponse(response, authentication.response);
      return;
    }
    if (!authentication.session.isAdmin) {
      writeJson(response, 403, { error: { code: 'administrator_required' } });
      return;
    }

    try {
      writeJson(response, 200, await getClimateEntities());
    } catch (error) {
      writeJson(
        response,
        error instanceof ClimateDiscoveryError && error.code === 'not_connected' ? 409 : 502,
        {
          error: {
            code: error instanceof ClimateDiscoveryError ? error.code : 'unavailable',
          },
        },
      );
    }
    return;
  }

  if (pathname === installationConfigurationPath) {
    const header = (value: string | string[] | undefined): string | undefined =>
      typeof value === 'string' ? value : undefined;
    const body =
      method === 'PUT'
        ? await readAuthNodeRequestBody(request, maximumConfigurationJsonBodyBytes)
        : undefined;

    if (method !== 'PUT') {
      request.resume();
    }

    const handleConfiguration = createInstallationConfigurationHandler(
      auth,
      installationRepository,
    );
    const contentType = header(request.headers['content-type']);
    const cookie = header(request.headers.cookie);
    const csrfToken = header(request.headers['x-aether-csrf']);
    const origin = header(request.headers.origin);
    const result = await handleConfiguration({
      pathname,
      method,
      headers: {
        ...(contentType === undefined ? {} : { contentType }),
        ...(cookie === undefined ? {} : { cookie }),
        ...(csrfToken === undefined ? {} : { csrfToken }),
        ...(origin === undefined ? {} : { origin }),
      },
      ...(body === undefined ? {} : { body }),
    });
    writeAuthNodeResponse(response, result);
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

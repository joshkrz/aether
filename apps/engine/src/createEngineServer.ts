import { createServer, type ServerResponse } from 'node:http';

import { InstallationOverviewResponseSchema } from '@aether/core';

import type { InstallationOverviewProvider } from './installationOverviewProvider.ts';

const installationOverviewPath = '/api/v1/installation/overview';

const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
};

export const createEngineServer = (getInstallationOverview: InstallationOverviewProvider) =>
  createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://engine.internal');

    if (requestUrl.pathname !== installationOverviewPath) {
      writeJson(response, 404, {
        error: {
          code: 'not_found',
        },
      });
      return;
    }

    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET');
      writeJson(response, 405, {
        error: {
          code: 'method_not_allowed',
        },
      });
      return;
    }

    try {
      const overview = InstallationOverviewResponseSchema.safeParse(
        await getInstallationOverview(),
      );

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
  });

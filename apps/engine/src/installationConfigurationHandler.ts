import * as z from 'zod';

import { InstallationSchema, validateInstallationTopology } from '@aether/core';

import type {
  AuthHttpBoundary,
  AuthHttpRequest,
  AuthHttpResponse,
} from './auth/authHttpHandler.ts';
import type { InstallationRepository } from './database/installationRepository.ts';

export const maximumConfigurationJsonBodyBytes = 4 * 1_024 * 1_024;

const SaveInstallationRequestSchema = z.strictObject({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  installation: InstallationSchema,
});

const duplicateIssueCodes = new Set([
  'duplicate_entity_id',
  'duplicate_controller_entity_id',
  'duplicate_schedule_block_id',
]);

const jsonResponse = (statusCode: number, body: unknown): AuthHttpResponse => ({
  statusCode,
  headers: {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  },
  body: JSON.stringify(body),
});

const errorResponse = (statusCode: number, code: string): AuthHttpResponse =>
  jsonResponse(statusCode, { error: { code } });

const representation = (
  installation: NonNullable<ReturnType<InstallationRepository['loadInstallation']>>,
  revision: number,
) => ({
  status: 'configured' as const,
  revision,
  installation,
  topology: validateInstallationTopology(installation),
});

export const createInstallationConfigurationHandler =
  (
    auth: AuthHttpBoundary,
    repository: Pick<InstallationRepository, 'loadInstallationWithRevision' | 'saveInstallation'>,
  ) =>
  async (request: AuthHttpRequest): Promise<AuthHttpResponse> => {
    if (request.method === 'GET') {
      const authentication = await auth.authenticateReadRequest(request.headers.cookie);

      if (authentication.status === 'rejected') {
        return authentication.response;
      }

      try {
        const current = repository.loadInstallationWithRevision();
        return current === undefined
          ? jsonResponse(200, { status: 'not_configured', revision: 0 })
          : jsonResponse(200, representation(current.installation, current.revision));
      } catch {
        return errorResponse(500, 'configuration_unavailable');
      }
    }

    if (request.method !== 'PUT') {
      const response = errorResponse(405, 'method_not_allowed');
      return { ...response, headers: { ...response.headers, allow: 'GET, PUT' } };
    }

    const authentication = await auth.authenticateMutationRequest(request);

    if (authentication.status === 'rejected') {
      return authentication.response;
    }

    if (!authentication.session.isAdmin) {
      return errorResponse(403, 'administrator_required');
    }

    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers.contentType ?? '')) {
      return errorResponse(415, 'unsupported_media_type');
    }

    if (request.body === undefined || request.body.byteLength === 0) {
      return errorResponse(400, 'invalid_json');
    }

    if (request.body.byteLength > maximumConfigurationJsonBodyBytes) {
      return errorResponse(413, 'request_body_too_large');
    }

    let value: unknown;

    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request.body));
    } catch {
      return errorResponse(400, 'invalid_json');
    }

    const parsed = SaveInstallationRequestSchema.safeParse(value);

    if (!parsed.success) {
      return jsonResponse(422, {
        error: {
          code: 'invalid_configuration',
          issues: parsed.error.issues.map(({ path, message }) => ({ path, message })),
        },
      });
    }

    const topology = validateInstallationTopology(parsed.data.installation);
    const duplicateIssues = topology.issues.filter(({ code }) => duplicateIssueCodes.has(code));

    if (duplicateIssues.length > 0) {
      return jsonResponse(422, {
        error: { code: 'duplicate_configuration_identifier', issues: duplicateIssues },
      });
    }

    try {
      const saved = repository.saveInstallation(parsed.data.installation, parsed.data.revision);

      return saved.status === 'conflict'
        ? errorResponse(409, 'configuration_revision_conflict')
        : jsonResponse(200, representation(saved.installation, saved.revision));
    } catch {
      return errorResponse(500, 'configuration_save_failed');
    }
  };

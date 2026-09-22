import {
  ClimateEntityIdSchema,
  HvacModeSchema,
  type ClimateEntityDiscoveryResponse,
  type DiscoveredClimateEntity,
  type HvacMode,
} from '@aether/core';

import type { AuthRepository } from './auth/authRepository.ts';
import type { HomeAssistantOAuthClient } from './auth/homeAssistantOAuthClient.ts';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type ClimateDiscoveryDependencies = {
  authRepository: Pick<AuthRepository, 'loadActiveEngineCredential' | 'updateCredentialTokens'>;
  homeAssistantClient: Pick<HomeAssistantOAuthClient, 'refreshAccessToken'>;
  fetch?: FetchImplementation;
  nowEpochSeconds?: () => number;
};

export type ClimateEntityDiscovery = () => Promise<ClimateEntityDiscoveryResponse>;

export class ClimateDiscoveryError extends Error {
  constructor(readonly code: 'not_connected' | 'unavailable') {
    super(code);
    this.name = 'ClimateDiscoveryError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringChoices = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((choice): choice is string => typeof choice === 'string' && choice.length > 0)
    : [];

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const positiveNumber = (value: unknown): number | undefined => {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
};

const hvacModes = (value: unknown): HvacMode[] =>
  stringChoices(value).filter((mode): mode is HvacMode => HvacModeSchema.safeParse(mode).success);

export const parseClimateStates = (value: unknown): ClimateEntityDiscoveryResponse => {
  if (!Array.isArray(value)) throw new ClimateDiscoveryError('unavailable');

  const entities: DiscoveredClimateEntity[] = [];

  for (const state of value) {
    if (!isRecord(state) || !ClimateEntityIdSchema.safeParse(state['entity_id']).success) {
      continue;
    }

    const attributes = isRecord(state['attributes']) ? state['attributes'] : {};
    const entityId = ClimateEntityIdSchema.parse(state['entity_id']);
    const friendlyName = attributes['friendly_name'];
    const name =
      typeof friendlyName === 'string' && friendlyName.trim().length > 0
        ? friendlyName.trim()
        : entityId;
    const supportedFeatures = finiteNumber(attributes['supported_features']);
    const temperatureUnit = attributes['temperature_unit'];
    const minTemperature = finiteNumber(attributes['min_temp']);
    const maxTemperature = finiteNumber(attributes['max_temp']);
    const targetTemperatureStep = positiveNumber(attributes['target_temp_step']);
    const minHumidity = finiteNumber(attributes['min_humidity']);
    const maxHumidity = finiteNumber(attributes['max_humidity']);

    entities.push({
      entityId,
      name,
      available:
        typeof state['state'] === 'string' &&
        state['state'] !== 'unavailable' &&
        state['state'] !== 'unknown',
      hvacModes: hvacModes(attributes['hvac_modes']),
      fanModes: stringChoices(attributes['fan_modes']),
      presetModes: stringChoices(attributes['preset_modes']),
      swingModes: stringChoices(attributes['swing_modes']),
      swingHorizontalModes: stringChoices(attributes['swing_horizontal_modes']),
      ...(supportedFeatures !== undefined &&
      Number.isSafeInteger(supportedFeatures) &&
      supportedFeatures >= 0
        ? { supportedFeatures }
        : {}),
      ...(typeof temperatureUnit === 'string' && temperatureUnit.length > 0
        ? { temperatureUnit }
        : {}),
      ...(minTemperature === undefined ? {} : { minTemperature }),
      ...(maxTemperature === undefined ? {} : { maxTemperature }),
      ...(targetTemperatureStep === undefined ? {} : { targetTemperatureStep }),
      ...(minHumidity === undefined ? {} : { minHumidity }),
      ...(maxHumidity === undefined ? {} : { maxHumidity }),
    });
  }

  entities.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.entityId.localeCompare(right.entityId),
  );
  return { entities };
};

export const createClimateEntityDiscovery = ({
  authRepository,
  homeAssistantClient,
  fetch: fetchImplementation = fetch,
  nowEpochSeconds = () => Math.floor(Date.now() / 1_000),
}: ClimateDiscoveryDependencies): ClimateEntityDiscovery => {
  let refreshInFlight: Promise<string> | undefined;

  const refreshToken = async (): Promise<string> => {
    if (refreshInFlight !== undefined) return refreshInFlight;

    const refresh = async (): Promise<string> => {
      const credential = authRepository.loadActiveEngineCredential();
      if (credential === undefined) throw new ClimateDiscoveryError('not_connected');

      try {
        const result = await homeAssistantClient.refreshAccessToken(
          credential.homeAssistantOrigin,
          credential.tokenBundle.refreshToken,
        );
        const now = nowEpochSeconds();
        const updated = authRepository.updateCredentialTokens(
          credential.id,
          {
            accessToken: result.accessToken,
            refreshToken: credential.tokenBundle.refreshToken,
            tokenType: result.tokenType,
          },
          now + result.expiresInSeconds,
          now,
        );
        if (!updated) throw new ClimateDiscoveryError('unavailable');
        return result.accessToken;
      } catch {
        throw new ClimateDiscoveryError('unavailable');
      }
    };

    refreshInFlight = refresh();
    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = undefined;
    }
  };

  return async () => {
    const credential = authRepository.loadActiveEngineCredential();
    if (credential === undefined) throw new ClimateDiscoveryError('not_connected');

    const requestStates = async (accessToken: string): Promise<Response> =>
      fetchImplementation(new URL('/api/states', credential.homeAssistantOrigin), {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });

    try {
      const now = nowEpochSeconds();
      const accessToken =
        credential.accessTokenExpiresAtEpochSeconds <= now + 60
          ? await refreshToken()
          : credential.tokenBundle.accessToken;
      let response = await requestStates(accessToken);

      if (response.status === 401) response = await requestStates(await refreshToken());
      if (!response.ok) throw new ClimateDiscoveryError('unavailable');
      return parseClimateStates(await response.json());
    } catch {
      throw new ClimateDiscoveryError('unavailable');
    }
  };
};

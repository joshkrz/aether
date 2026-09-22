import { describe, expect, it, vi } from 'vitest';

import {
  ClimateDiscoveryError,
  createClimateEntityDiscovery,
  parseClimateStates,
} from './homeAssistantClimateDiscovery.ts';

const credential = {
  id: 'engine-credential',
  purpose: 'engine' as const,
  homeAssistantOrigin: 'https://home-assistant.example',
  homeAssistantUserId: 'owner',
  createdAtEpochSeconds: 100,
  updatedAtEpochSeconds: 100,
  accessTokenExpiresAtEpochSeconds: 2_000,
  tokenBundle: {
    accessToken: 'server-only-token',
    refreshToken: 'server-only-refresh',
    tokenType: 'Bearer' as const,
  },
};

describe('Home Assistant climate discovery', () => {
  it('reports a missing engine connection without making a state request', async () => {
    const fetchStates = vi.fn();
    const discover = createClimateEntityDiscovery({
      authRepository: {
        loadActiveEngineCredential: () => undefined,
        updateCredentialTokens: () => false,
      },
      homeAssistantClient: {
        refreshAccessToken: () => Promise.reject(new Error('Unexpected refresh')),
      },
      fetch: fetchStates,
    });

    await expect(discover()).rejects.toEqual(new ClimateDiscoveryError('not_connected'));
    expect(fetchStates).not.toHaveBeenCalled();
  });

  it('returns only climate entity capability fields and marks unavailable entities', () => {
    expect(
      parseClimateStates([
        { entity_id: 'sensor.temperature', state: '20', attributes: { friendly_name: 'Secret' } },
        {
          entity_id: 'climate.lounge',
          state: 'heat',
          attributes: {
            friendly_name: 'Lounge',
            hvac_modes: ['off', 'heat', 'cool', 'unsupported'],
            fan_modes: ['auto', 'high'],
            preset_modes: ['eco'],
            swing_modes: [],
            swing_horizontal_modes: ['left', 'right'],
            min_temp: 16,
            max_temp: 30,
            target_temp_step: 0.5,
            temperature_unit: '°C',
            supported_features: 401,
            access_token: 'must-not-leak',
          },
        },
        {
          entity_id: 'climate.bedroom',
          state: 'unavailable',
          attributes: { hvac_modes: ['off', 'heat'] },
        },
      ]),
    ).toEqual({
      entities: [
        {
          entityId: 'climate.bedroom',
          name: 'climate.bedroom',
          available: false,
          hvacModes: ['off', 'heat'],
          fanModes: [],
          presetModes: [],
          swingModes: [],
          swingHorizontalModes: [],
        },
        {
          entityId: 'climate.lounge',
          name: 'Lounge',
          available: true,
          hvacModes: ['off', 'heat', 'cool'],
          fanModes: ['auto', 'high'],
          presetModes: ['eco'],
          swingModes: [],
          swingHorizontalModes: ['left', 'right'],
          minTemperature: 16,
          maxTemperature: 30,
          targetTemperatureStep: 0.5,
          temperatureUnit: '°C',
          supportedFeatures: 401,
        },
      ],
    });
  });

  it('refreshes an expiring engine token and never returns it to the caller', async () => {
    const fetchStates = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual({
        authorization: 'Bearer fresh-token',
        accept: 'application/json',
      });
      return Response.json([
        { entity_id: 'climate.lounge', state: 'off', attributes: { hvac_modes: ['off', 'heat'] } },
      ]);
    });
    const updateCredentialTokens = vi.fn(() => true);
    const discover = createClimateEntityDiscovery({
      authRepository: {
        loadActiveEngineCredential: () => ({
          ...credential,
          accessTokenExpiresAtEpochSeconds: 1_050,
        }),
        updateCredentialTokens,
      },
      homeAssistantClient: {
        refreshAccessToken: () =>
          Promise.resolve({
            accessToken: 'fresh-token',
            expiresInSeconds: 1_800,
            tokenType: 'Bearer',
          }),
      },
      fetch: fetchStates,
      nowEpochSeconds: () => 1_000,
    });

    const result = await discover();
    expect(result.entities[0]?.entityId).toBe('climate.lounge');
    expect(JSON.stringify(result)).not.toContain('fresh-token');
    expect(updateCredentialTokens).toHaveBeenCalledWith(
      credential.id,
      {
        accessToken: 'fresh-token',
        refreshToken: credential.tokenBundle.refreshToken,
        tokenType: 'Bearer',
      },
      2_800,
      1_000,
    );
  });

  it('retries a rejected state request once after token refresh', async () => {
    const fetchStates = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json([]));
    const refreshAccessToken = vi.fn(() =>
      Promise.resolve({
        accessToken: 'fresh-token',
        expiresInSeconds: 1_800,
        tokenType: 'Bearer' as const,
      }),
    );
    const discover = createClimateEntityDiscovery({
      authRepository: {
        loadActiveEngineCredential: () => credential,
        updateCredentialTokens: () => true,
      },
      homeAssistantClient: { refreshAccessToken },
      fetch: fetchStates,
      nowEpochSeconds: () => 1_000,
    });

    await expect(discover()).resolves.toEqual({ entities: [] });
    expect(fetchStates).toHaveBeenCalledTimes(2);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});

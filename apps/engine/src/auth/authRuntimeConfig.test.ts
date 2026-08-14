import { describe, expect, it } from 'vitest';

import { parseAuthRuntimeConfig } from './authRuntimeConfig.ts';

describe('parseAuthRuntimeConfig', () => {
  it('normalizes a secure public origin and callback URL', () => {
    expect(
      parseAuthRuntimeConfig({
        AETHER_PUBLIC_URL: 'https://aether.example.com/',
        AETHER_AUTH_KEY_PATH: '/config/aether-auth.key',
      }),
    ).toEqual({
      allowInsecureHttp: false,
      authKeyPath: '/config/aether-auth.key',
      oauthCallbackUrl: 'https://aether.example.com/api/v1/auth/callback',
      publicOrigin: 'https://aether.example.com',
      secureCookies: true,
    });
  });

  it('allows HTTP only through the exact insecure opt-in', () => {
    expect(
      parseAuthRuntimeConfig({
        AETHER_PUBLIC_URL: 'http://192.168.1.50:3001',
        AETHER_ALLOW_INSECURE_HTTP: 'true',
      }),
    ).toEqual({
      allowInsecureHttp: true,
      authKeyPath: './aether-auth.key',
      oauthCallbackUrl: 'http://192.168.1.50:3001/api/v1/auth/callback',
      publicOrigin: 'http://192.168.1.50:3001',
      secureCookies: false,
    });

    expect(() => parseAuthRuntimeConfig({ AETHER_PUBLIC_URL: 'http://192.168.1.50:3001' })).toThrow(
      'AETHER_PUBLIC_URL must use HTTPS',
    );
    expect(() =>
      parseAuthRuntimeConfig({
        AETHER_PUBLIC_URL: 'http://192.168.1.50:3001',
        AETHER_ALLOW_INSECURE_HTTP: 'TRUE',
      }),
    ).toThrow('AETHER_ALLOW_INSECURE_HTTP must be exactly true or false');
  });

  it('defaults the auth key to the persistent config mount in production', () => {
    expect(
      parseAuthRuntimeConfig({
        AETHER_PUBLIC_URL: 'https://aether.example.com',
        NODE_ENV: 'production',
      }).authKeyPath,
    ).toBe('/config/aether-auth.key');
  });

  it.each([
    undefined,
    '',
    'aether.example.com',
    'ftp://aether.example.com',
    'https://user:password@aether.example.com',
    'https://aether.example.com/aether',
    'https://aether.example.com?mode=setup',
    'https://aether.example.com#setup',
  ])('rejects a non-origin public URL: %s', (publicUrl) => {
    expect(() => parseAuthRuntimeConfig({ AETHER_PUBLIC_URL: publicUrl })).toThrow();
  });

  it('rejects an explicitly empty auth key path', () => {
    expect(() =>
      parseAuthRuntimeConfig({
        AETHER_PUBLIC_URL: 'https://aether.example.com',
        AETHER_AUTH_KEY_PATH: '  ',
      }),
    ).toThrow('AETHER_AUTH_KEY_PATH must not be empty');
  });
});

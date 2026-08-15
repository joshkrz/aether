import { parseSetCookie } from 'cookie';
import { describe, expect, it } from 'vitest';

import { createAuthCookieManager } from './authCookies.ts';

const secret = (label: string): string => `${label}-`.padEnd(43, 'x');

describe('createAuthCookieManager', () => {
  it('reads valid Aether secrets and ignores malformed cookie values', () => {
    const cookies = createAuthCookieManager({ secure: true });

    expect(
      cookies.readCookies(
        [
          `aether_session=${secret('session')}`,
          'unrelated=value',
          'aether_csrf=too-short',
          `aether_oauth_binding=${secret('binding')}`,
        ].join('; '),
      ),
    ).toEqual({
      oauthBindingSecret: secret('binding'),
      sessionToken: secret('session'),
    });
    expect(cookies.readCookies(undefined)).toEqual({});
  });

  it('creates persistent secure session and strict CSRF cookies', () => {
    const cookies = createAuthCookieManager({ secure: true });
    const [sessionHeader, csrfHeader] = cookies.createSessionCookies({
      csrfToken: secret('csrf'),
      expiresAtEpochSeconds: 2_000,
      nowEpochSeconds: 1_000,
      sessionToken: secret('session'),
    });

    expect(parseSetCookie(sessionHeader)).toEqual({
      name: 'aether_session',
      value: secret('session'),
      expires: new Date(2_000_000),
      httpOnly: true,
      maxAge: 1_000,
      path: '/',
      sameSite: 'lax',
      secure: true,
    });
    expect(parseSetCookie(csrfHeader)).toEqual({
      name: 'aether_csrf',
      value: secret('csrf'),
      expires: new Date(2_000_000),
      maxAge: 1_000,
      path: '/',
      sameSite: 'strict',
      secure: true,
    });
    expect(csrfHeader).not.toContain('HttpOnly');
    expect(sessionHeader).not.toContain('Domain=');
    expect(csrfHeader).not.toContain('Domain=');
  });

  it('omits Secure only for the explicitly approved insecure runtime mode', () => {
    const cookies = createAuthCookieManager({ secure: false });
    const headers = cookies.createSessionCookies({
      csrfToken: secret('csrf'),
      expiresAtEpochSeconds: 2_000,
      nowEpochSeconds: 1_000,
      sessionToken: secret('session'),
    });

    expect(headers.every((header) => !header.includes('Secure'))).toBe(true);
  });

  it('creates a callback-scoped ten-minute OAuth binding cookie', () => {
    const cookies = createAuthCookieManager({ secure: true });
    const header = cookies.createOAuthBindingCookie({
      browserBindingSecret: secret('binding'),
      expiresAtEpochSeconds: 1_600,
      nowEpochSeconds: 1_000,
    });

    expect(parseSetCookie(header)).toEqual({
      name: 'aether_oauth_binding',
      value: secret('binding'),
      expires: new Date(1_600_000),
      httpOnly: true,
      maxAge: 600,
      path: '/api/v1/auth/callback',
      sameSite: 'lax',
      secure: true,
    });
  });

  it('clears every cookie using its original security and path attributes', () => {
    const cookies = createAuthCookieManager({ secure: true });
    const binding = parseSetCookie(cookies.clearOAuthBindingCookie());
    const [session, csrf] = cookies.clearSessionCookies().map((header) => parseSetCookie(header));

    expect(binding).toMatchObject({
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      path: '/api/v1/auth/callback',
      sameSite: 'lax',
      secure: true,
      value: '',
    });
    expect(session).toMatchObject({
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      secure: true,
      value: '',
    });
    expect(csrf).toMatchObject({
      expires: new Date(0),
      maxAge: 0,
      path: '/',
      sameSite: 'strict',
      secure: true,
      value: '',
    });
  });

  it('rejects malformed secrets and non-future cookie lifetimes', () => {
    const cookies = createAuthCookieManager({ secure: true });

    expect(() =>
      cookies.createSessionCookies({
        csrfToken: secret('csrf'),
        expiresAtEpochSeconds: 2_000,
        nowEpochSeconds: 1_000,
        sessionToken: 'not-a-secret',
      }),
    ).toThrow('Session token must be a 32-byte base64url auth secret');
    expect(() =>
      cookies.createOAuthBindingCookie({
        browserBindingSecret: secret('binding'),
        expiresAtEpochSeconds: 1_000,
        nowEpochSeconds: 1_000,
      }),
    ).toThrow('Cookie expiry must be a safe integer epoch timestamp in the future');
  });
});

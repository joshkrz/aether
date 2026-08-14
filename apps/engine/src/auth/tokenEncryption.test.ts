import { describe, expect, it } from 'vitest';

import {
  authSecretMatchesHash,
  decryptTokenBundle,
  encryptTokenBundle,
  generateAuthSecret,
  hashAuthSecret,
  tokenEncryptionVersion,
} from './tokenEncryption.ts';

const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
const tokenBundle = {
  accessToken: 'access-token-that-must-remain-secret',
  refreshToken: 'refresh-token-that-must-remain-secret',
  tokenType: 'Bearer',
} as const;

describe('Home Assistant token encryption', () => {
  it('round-trips a token bundle without storing plaintext tokens', () => {
    const encrypted = encryptTokenBundle(tokenBundle, key, 'credential:engine-1:engine');

    expect(encrypted.toString('utf8')).not.toContain(tokenBundle.accessToken);
    expect(encrypted.toString('utf8')).not.toContain(tokenBundle.refreshToken);
    expect(
      decryptTokenBundle(encrypted, tokenEncryptionVersion, key, 'credential:engine-1:engine'),
    ).toEqual(tokenBundle);
  });

  it('uses a distinct nonce for each encryption', () => {
    const first = encryptTokenBundle(tokenBundle, key, 'credential:engine-1:engine');
    const second = encryptTokenBundle(tokenBundle, key, 'credential:engine-1:engine');

    expect(second).not.toEqual(first);
  });

  it('rejects tampering, the wrong key, context swapping, and unknown versions', () => {
    const encrypted = encryptTokenBundle(tokenBundle, key, 'credential:engine-1:engine');
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;

    expect(() =>
      decryptTokenBundle(tampered, tokenEncryptionVersion, key, 'credential:engine-1:engine'),
    ).toThrow('could not be authenticated');
    expect(() =>
      decryptTokenBundle(
        encrypted,
        tokenEncryptionVersion,
        Buffer.alloc(32, 7),
        'credential:engine-1:engine',
      ),
    ).toThrow('could not be authenticated');
    expect(() =>
      decryptTokenBundle(encrypted, tokenEncryptionVersion, key, 'credential:user-1:user'),
    ).toThrow('could not be authenticated');
    expect(() =>
      decryptTokenBundle(encrypted, tokenEncryptionVersion + 1, key, 'credential:engine-1:engine'),
    ).toThrow('Unsupported token encryption version');
  });
});

describe('authentication secrets', () => {
  it('generates independent high-entropy URL-safe secrets', () => {
    const first = generateAuthSecret();
    const second = generateAuthSecret();

    expect(first).toMatch(/^[\w-]{43}$/u);
    expect(second).toMatch(/^[\w-]{43}$/u);
    expect(second).not.toBe(first);
  });

  it('hashes and compares secrets without accepting malformed hashes', () => {
    const secret = generateAuthSecret();
    const hash = hashAuthSecret(secret);

    expect(hash).toMatch(/^[a-f\d]{64}$/u);
    expect(authSecretMatchesHash(secret, hash)).toBe(true);
    expect(authSecretMatchesHash(`${secret}-wrong`, hash)).toBe(false);
    expect(authSecretMatchesHash(secret, 'not-a-sha256-hash')).toBe(false);
  });
});

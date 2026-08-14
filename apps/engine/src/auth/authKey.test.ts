import { chmodSync, lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadOrCreateAuthKey } from './authKey.ts';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'aether-auth-key-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('loadOrCreateAuthKey', () => {
  it('creates an owner-only 256-bit key and reloads it unchanged', () => {
    const path = join(createTemporaryDirectory(), 'aether-auth.key');
    const createdKey = loadOrCreateAuthKey(path);
    const reloadedKey = loadOrCreateAuthKey(path);

    expect(createdKey).toHaveLength(32);
    expect(reloadedKey).toEqual(createdKey);
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
  });

  it('rejects a key file accessible by group or other users', () => {
    const path = join(createTemporaryDirectory(), 'aether-auth.key');
    writeFileSync(path, Buffer.alloc(32), { mode: 0o600 });
    chmodSync(path, 0o640);

    expect(() => loadOrCreateAuthKey(path)).toThrow(
      'Aether auth key must not be accessible by group or other users',
    );
  });

  it('rejects a malformed key without replacing it', () => {
    const path = join(createTemporaryDirectory(), 'aether-auth.key');
    writeFileSync(path, Buffer.alloc(31), { mode: 0o600 });

    expect(() => loadOrCreateAuthKey(path)).toThrow('must contain exactly 32 bytes');
    expect(lstatSync(path).size).toBe(31);
  });

  it('rejects a symlink even when its target is a valid key', () => {
    const directory = createTemporaryDirectory();
    const targetPath = join(directory, 'target.key');
    const linkPath = join(directory, 'aether-auth.key');
    writeFileSync(targetPath, Buffer.alloc(32), { mode: 0o600 });
    symlinkSync(targetPath, linkPath);

    expect(() => loadOrCreateAuthKey(linkPath)).toThrow('readable, non-symlink key file');
  });
});

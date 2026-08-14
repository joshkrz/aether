import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';

const authKeyByteLength = 32;
const ownerReadWriteMode = 0o600;
const disallowedPermissionMask = 0o077;

const isAlreadyExistsError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'EEXIST';

const openExistingAuthKey = (path: string): number =>
  openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);

const validateAndReadAuthKey = (path: string): Buffer => {
  let descriptor: number;

  try {
    descriptor = openExistingAuthKey(path);
  } catch (error) {
    throw new Error(
      `AETHER_AUTH_KEY_PATH must identify a readable, non-symlink key file: ${path}`,
      { cause: error },
    );
  }

  try {
    const metadata = fstatSync(descriptor);

    if (!metadata.isFile()) {
      throw new Error(`AETHER_AUTH_KEY_PATH must identify a regular file: ${path}`);
    }

    if ((metadata.mode & disallowedPermissionMask) !== 0) {
      throw new Error(`Aether auth key must not be accessible by group or other users: ${path}`);
    }

    const key = readFileSync(descriptor);

    if (key.length !== authKeyByteLength) {
      throw new Error(`Aether auth key must contain exactly ${authKeyByteLength} bytes: ${path}`);
    }

    return key;
  } finally {
    closeSync(descriptor);
  }
};

const createAuthKey = (path: string): boolean => {
  let descriptor: number;

  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      ownerReadWriteMode,
    );
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return false;
    }

    throw new Error(`Unable to create the Aether auth key at AETHER_AUTH_KEY_PATH: ${path}`, {
      cause: error,
    });
  }

  try {
    fchmodSync(descriptor, ownerReadWriteMode);
    writeFileSync(descriptor, randomBytes(authKeyByteLength));
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }

  return true;
};

export const loadOrCreateAuthKey = (path: string): Buffer => {
  if (path.trim().length === 0) {
    throw new Error('AETHER_AUTH_KEY_PATH must not be empty');
  }

  createAuthKey(path);
  return validateAndReadAuthKey(path);
};

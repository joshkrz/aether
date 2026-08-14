import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const algorithm = 'aes-256-gcm';
const authKeyByteLength = 32;
const initializationVectorByteLength = 12;
const authenticationTagByteLength = 16;

export const tokenEncryptionVersion = 1;

export type HomeAssistantTokenBundle = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
};

const validateAuthKey = (key: Buffer): void => {
  if (key.length !== authKeyByteLength) {
    throw new Error(`Aether auth key must contain exactly ${authKeyByteLength} bytes`);
  }
};

const validateEncryptionContext = (context: string): void => {
  if (context.length === 0) {
    throw new Error('Token encryption context must not be empty');
  }
};

const parseTokenBundle = (serializedBundle: string): HomeAssistantTokenBundle => {
  let value: unknown;

  try {
    value = JSON.parse(serializedBundle);
  } catch {
    throw new Error('Encrypted Home Assistant token bundle is invalid');
  }

  if (
    typeof value !== 'object' ||
    value === null ||
    !('accessToken' in value) ||
    typeof value.accessToken !== 'string' ||
    value.accessToken.length === 0 ||
    !('refreshToken' in value) ||
    typeof value.refreshToken !== 'string' ||
    value.refreshToken.length === 0 ||
    !('tokenType' in value) ||
    value.tokenType !== 'Bearer'
  ) {
    throw new Error('Encrypted Home Assistant token bundle is invalid');
  }

  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    tokenType: value.tokenType,
  };
};

export const encryptTokenBundle = (
  bundle: HomeAssistantTokenBundle,
  key: Buffer,
  context: string,
): Buffer => {
  validateAuthKey(key);
  validateEncryptionContext(context);
  const validatedBundle = parseTokenBundle(JSON.stringify(bundle));
  const initializationVector = randomBytes(initializationVectorByteLength);
  const cipher = createCipheriv(algorithm, key, initializationVector, {
    authTagLength: authenticationTagByteLength,
  });
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(validatedBundle), 'utf8'),
    cipher.final(),
  ]);

  return Buffer.concat([initializationVector, cipher.getAuthTag(), ciphertext]);
};

export const decryptTokenBundle = (
  encryptedBundle: Buffer,
  encryptionVersion: number,
  key: Buffer,
  context: string,
): HomeAssistantTokenBundle => {
  validateAuthKey(key);
  validateEncryptionContext(context);

  if (encryptionVersion !== tokenEncryptionVersion) {
    throw new Error(`Unsupported token encryption version: ${encryptionVersion}`);
  }

  if (encryptedBundle.length <= initializationVectorByteLength + authenticationTagByteLength) {
    throw new Error('Encrypted Home Assistant token bundle is invalid');
  }

  const initializationVector = encryptedBundle.subarray(0, initializationVectorByteLength);
  const authenticationTag = encryptedBundle.subarray(
    initializationVectorByteLength,
    initializationVectorByteLength + authenticationTagByteLength,
  );
  const ciphertext = encryptedBundle.subarray(
    initializationVectorByteLength + authenticationTagByteLength,
  );

  try {
    const decipher = createDecipheriv(algorithm, key, initializationVector, {
      authTagLength: authenticationTagByteLength,
    });
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(authenticationTag);
    const serializedBundle = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');

    return parseTokenBundle(serializedBundle);
  } catch {
    throw new Error('Encrypted Home Assistant token bundle could not be authenticated');
  }
};

export const generateAuthSecret = (): string => randomBytes(32).toString('base64url');

export const hashAuthSecret = (secret: string): string =>
  createHash('sha256').update(secret, 'utf8').digest('hex');

export const authSecretMatchesHash = (secret: string, expectedHash: string): boolean => {
  if (!/^[a-f\d]{64}$/u.test(expectedHash)) {
    return false;
  }

  const actualHash = Buffer.from(hashAuthSecret(secret), 'hex');
  return timingSafeEqual(actualHash, Buffer.from(expectedHash, 'hex'));
};

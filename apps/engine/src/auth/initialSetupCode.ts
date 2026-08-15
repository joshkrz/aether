import { authSecretMatchesHash, generateAuthSecret, hashAuthSecret } from './tokenEncryption.ts';

const authSecretPattern = /^[\w-]{43}$/u;

type InitialSetupCodeOptions = {
  generateSecret?: () => string;
};

export type InitialSetupCode = {
  code: string;
  matches: (candidate: string | undefined) => boolean;
};

export const createInitialSetupCode = (options: InitialSetupCodeOptions = {}): InitialSetupCode => {
  const code = (options.generateSecret ?? generateAuthSecret)();

  if (!authSecretPattern.test(code)) {
    throw new Error('Initial setup code generator must return a 32-byte base64url secret');
  }

  const codeHash = hashAuthSecret(code);

  return {
    code,
    matches: (candidate) => candidate !== undefined && authSecretMatchesHash(candidate, codeHash),
  };
};

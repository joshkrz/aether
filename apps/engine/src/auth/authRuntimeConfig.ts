const defaultContainerAuthKeyPath = '/config/aether-auth.key';
const defaultDevelopmentAuthKeyPath = './aether-auth.key';
const oauthCallbackPath = '/api/v1/auth/callback';

export type AuthRuntimeEnvironment = {
  AETHER_ALLOW_INSECURE_HTTP?: string | undefined;
  AETHER_AUTH_KEY_PATH?: string | undefined;
  AETHER_PUBLIC_URL?: string | undefined;
  NODE_ENV?: string | undefined;
};

export type AuthRuntimeConfig = {
  allowInsecureHttp: boolean;
  authKeyPath: string;
  oauthCallbackUrl: string;
  publicOrigin: string;
  secureCookies: boolean;
};

const parseAllowInsecureHttp = (configuredValue: string | undefined): boolean => {
  if (configuredValue === undefined || configuredValue === 'false') {
    return false;
  }

  if (configuredValue === 'true') {
    return true;
  }

  throw new Error('AETHER_ALLOW_INSECURE_HTTP must be exactly true or false');
};

const parsePublicOrigin = (configuredValue: string | undefined): URL => {
  if (configuredValue === undefined || configuredValue.trim().length === 0) {
    throw new Error('AETHER_PUBLIC_URL is required when authentication is enabled');
  }

  let publicUrl: URL;

  try {
    publicUrl = new URL(configuredValue);
  } catch {
    throw new Error('AETHER_PUBLIC_URL must be a valid absolute HTTP(S) origin');
  }

  if (publicUrl.protocol !== 'http:' && publicUrl.protocol !== 'https:') {
    throw new Error('AETHER_PUBLIC_URL must use HTTP or HTTPS');
  }

  if (
    publicUrl.username.length > 0 ||
    publicUrl.password.length > 0 ||
    (publicUrl.pathname !== '' && publicUrl.pathname !== '/') ||
    publicUrl.search.length > 0 ||
    publicUrl.hash.length > 0
  ) {
    throw new Error(
      'AETHER_PUBLIC_URL must be an origin without credentials, path, query, or hash',
    );
  }

  return publicUrl;
};

const parseAuthKeyPath = (
  configuredValue: string | undefined,
  nodeEnvironment: string | undefined,
): string => {
  if (configuredValue === undefined) {
    return nodeEnvironment === 'production'
      ? defaultContainerAuthKeyPath
      : defaultDevelopmentAuthKeyPath;
  }

  const path = configuredValue.trim();

  if (path.length === 0) {
    throw new Error('AETHER_AUTH_KEY_PATH must not be empty');
  }

  return path;
};

export const parseAuthRuntimeConfig = (environment: AuthRuntimeEnvironment): AuthRuntimeConfig => {
  const allowInsecureHttp = parseAllowInsecureHttp(environment.AETHER_ALLOW_INSECURE_HTTP);
  const publicUrl = parsePublicOrigin(environment.AETHER_PUBLIC_URL);
  const secureCookies = publicUrl.protocol === 'https:';

  if (!secureCookies && !allowInsecureHttp) {
    throw new Error(
      'AETHER_PUBLIC_URL must use HTTPS unless AETHER_ALLOW_INSECURE_HTTP=true is explicitly set',
    );
  }

  const publicOrigin = publicUrl.origin;

  return {
    allowInsecureHttp,
    authKeyPath: parseAuthKeyPath(environment.AETHER_AUTH_KEY_PATH, environment.NODE_ENV),
    oauthCallbackUrl: new URL(oauthCallbackPath, publicOrigin).toString(),
    publicOrigin,
    secureCookies,
  };
};

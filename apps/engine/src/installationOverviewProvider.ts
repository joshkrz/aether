export type InstallationOverviewProvider = () => unknown | Promise<unknown>;

export const createUnconfiguredInstallationOverviewProvider =
  (): InstallationOverviewProvider => () => ({
    status: 'not_configured',
  });

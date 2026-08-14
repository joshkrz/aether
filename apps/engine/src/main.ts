import { createEngineServer } from './createEngineServer.ts';
import { createDatabase } from './database/createDatabase.ts';
import { createInstallationRepository } from './database/installationRepository.ts';
import { databaseMigrations } from './database/migrations.ts';
import { runMigrations } from './database/runMigrations.ts';
import { createInstallationOverviewProvider } from './installationOverviewProvider.ts';
import { resolveGeneratedWebRoot } from './serveGeneratedWebApp.ts';

const defaultHost = '127.0.0.1';
const defaultPort = 3001;
const defaultDatabasePath = './aether.sqlite';

const host = process.env['AETHER_ENGINE_HOST']?.trim() || defaultHost;
const configuredPort = process.env['AETHER_ENGINE_PORT'];
const port = configuredPort === undefined ? defaultPort : Number(configuredPort);
const configuredWebRoot = process.env['AETHER_WEB_ROOT']?.trim();
const databasePath = process.env['AETHER_DATABASE_PATH']?.trim() || defaultDatabasePath;

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('AETHER_ENGINE_PORT must be an integer between 1 and 65535');
}

const webRoot =
  configuredWebRoot === undefined || configuredWebRoot.length === 0
    ? undefined
    : await resolveGeneratedWebRoot(configuredWebRoot);

const database = createDatabase(databasePath);

try {
  runMigrations(database.client, databaseMigrations);
} catch (error) {
  database.close();
  throw error;
}

const installationRepository = createInstallationRepository(database.query);
const getInstallationOverview = createInstallationOverviewProvider(installationRepository);
const server = createEngineServer(
  webRoot === undefined ? { getInstallationOverview } : { getInstallationOverview, webRoot },
);

server.listen(port, host, () => {
  console.log(`Aether engine listening at http://${host}:${port}`);
});

let isClosing = false;

const closeServer = (): void => {
  if (isClosing) {
    return;
  }

  isClosing = true;
  server.close((error) => {
    try {
      database.close();
    } catch (databaseError) {
      console.error('Aether database failed to close cleanly', databaseError);
      process.exitCode = 1;
    }

    if (error !== undefined) {
      console.error('Aether engine failed to stop cleanly', error);
      process.exitCode = 1;
    }
  });
};

process.once('SIGINT', closeServer);
process.once('SIGTERM', closeServer);

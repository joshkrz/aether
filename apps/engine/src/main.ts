import { createEngineServer } from './createEngineServer.ts';
import { createUnconfiguredInstallationOverviewProvider } from './installationOverviewProvider.ts';

const defaultHost = '127.0.0.1';
const defaultPort = 3001;

const host = process.env['AETHER_ENGINE_HOST']?.trim() || defaultHost;
const configuredPort = process.env['AETHER_ENGINE_PORT'];
const port = configuredPort === undefined ? defaultPort : Number(configuredPort);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('AETHER_ENGINE_PORT must be an integer between 1 and 65535');
}

const server = createEngineServer(createUnconfiguredInstallationOverviewProvider());

server.listen(port, host, () => {
  console.log(`Aether engine listening at http://${host}:${port}`);
});

const closeServer = (): void => {
  server.close((error) => {
    if (error !== undefined) {
      console.error('Aether engine failed to stop cleanly', error);
      process.exitCode = 1;
    }
  });
};

process.once('SIGINT', closeServer);
process.once('SIGTERM', closeServer);

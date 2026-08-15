# Aether

Aether is a local-first hybrid climate orchestrator for Home Assistant. It coordinates heating and cooling through configured `climate.*` entities while accounting for room demand, shared physical plant, schedules, predictions, energy cost, manual operation, and equipment constraints.

The product and architecture source of truth is [SPEC.md](./SPEC.md).

## Status

The core domain foundation and initial Nuxt web shell are implemented in an npm-workspaces monorepo containing:

- a client-rendered Nuxt 4/Vue 3 web application;
- an always-running Node.js/TypeScript climate engine;
- a shared deterministic climate-core package.

Production is packaged as one Unraid-oriented container in which the engine serves the generated Nuxt application from the same port as its API. The engine migrates `/config/aether.sqlite` before serving requests, persists Home Assistant OAuth credentials and browser sessions, and protects application APIs. The setup/login UI, persistent engine connection, entity persistence, configuration UI, and live engine-to-web data are not implemented yet.

## Core boundary

Home Assistant owns the equipment. Aether may read relevant Home Assistant entities, but all HVAC mode and target-temperature changes must go through configured `climate.*` entities.

The canonical domain relationship is:

```text
Room ⇄ Climate Controller → Plant → Energy Source
```

## Documentation

- [SPEC.md](./SPEC.md) — living product and architecture specification
- [CONTRIBUTING.md](./CONTRIBUTING.md) — development and change conventions
- [AGENTS.md](./AGENTS.md) — repository guidance for coding agents
- [DEPENDENCY_EXCEPTIONS.md](./DEPENDENCY_EXCEPTIONS.md) — approved temporary dependency-policy exceptions

## Run the web application

Use Node.js 24.19 and npm 11.17, then run:

```sh
npm install
npm run dev:web
```

The Nuxt development server is available at `http://localhost:3000` by default.

To run the authenticated engine directly for local development, explicitly opt into loopback HTTP:

```sh
AETHER_PUBLIC_URL=http://127.0.0.1:3001 \
  AETHER_ALLOW_INSECURE_HTTP=true \
  npm run dev:engine
```

The local database and authentication key use ignored development paths, and an incomplete setup code is printed in the engine output.

## Build and run the production container

The multi-stage build compiles the core and engine, generates the client-side Nuxt application, and copies only runtime dependencies and production output into a non-root Debian slim image.

```sh
docker build --tag aether:local .
docker volume create aether-config
docker run --rm --name aether \
  --publish 3001:3001 \
  --volume aether-config:/config \
  --env AETHER_PUBLIC_URL=http://localhost:3001 \
  --env AETHER_ALLOW_INSECURE_HTTP=true \
  aether:local
```

Aether is then available at `http://localhost:3001`. The engine serves both the generated UI and same-origin `/api/*` routes. Until the setup UI is added, the generated initial setup code appears once in the container output whenever Home Assistant setup is incomplete; restarting the incomplete setup generates a replacement code.

The engine applies checked, transactional SQLite migrations before opening the HTTP listener. In the container the database is `/config/aether.sqlite`; local engine development defaults to `./aether.sqlite` and may override it with `AETHER_DATABASE_PATH`.

The container:

- runs as the Unraid-compatible non-root UID/GID `99:100`;
- exposes one HTTP port, `3001`;
- persists application data under `/config`;
- includes a liveness-only health check against `/api/v1/health`; and
- contains neither npm nor the development toolchain.

The Dockerfile is platform-neutral. Local Apple Silicon builds produce `linux/arm64`; release publishing will build both `linux/amd64` for Unraid and `linux/arm64`.

### Authentication, public URL, and HTTPS

Authentication delegates identity to Home Assistant and stores OAuth credentials only in encrypted server-side SQLite records. The browser receives opaque Aether cookies rather than Home Assistant tokens.

- `AETHER_PUBLIC_URL` is required and is the externally visible origin, such as `https://aether.example.com`. It must not include a path, query, or fragment.
- `AETHER_ALLOW_INSECURE_HTTP` defaults to `false`. Only the exact value `true` opts into an HTTP public URL for local development or a trusted private network.
- `AETHER_AUTH_KEY_PATH` defaults to `/config/aether-auth.key` in the container and identifies the owner-only key file used to encrypt Home Assistant OAuth credentials.

For a reverse-proxied installation, HTTPS terminates at the proxy while the proxy may reach Aether over private HTTP on port 3001:

```sh
docker run --rm --name aether \
  --publish 3001:3001 \
  --volume aether-config:/config \
  --env AETHER_PUBLIC_URL=https://aether.example.com \
  aether:local
```

For an explicitly insecure private-LAN installation:

```sh
docker run --rm --name aether \
  --publish 3001:3001 \
  --volume aether-config:/config \
  --env AETHER_PUBLIC_URL=http://192.168.1.50:3001 \
  --env AETHER_ALLOW_INSECURE_HTTP=true \
  aether:local
```

Insecure mode is not suitable for internet exposure. Authentication configuration is validated before the engine opens its HTTP listener; missing or unsafe values fail startup rather than silently weakening cookies or origin checks.

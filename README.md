# Aether

Aether is a local-first whole-house climate scheduler for Home Assistant. Its MVP will run zone and room schedule blocks through configured `climate.*` entities, with main and override schedules selectable from Home Assistant. The earlier hybrid orchestration ideas remain in the roadmap.

The current product and architecture source of truth is [SPEC.md](./SPEC.md). The complete earlier specification is archived at [docs/ORIGINAL_SPEC.md](./docs/ORIGINAL_SPEC.md), and [ROADMAP.md](./ROADMAP.md) indexes its ideas.

## Status

The initial domain foundation and Nuxt web shell are implemented in an npm-workspaces monorepo containing:

- a client-rendered Nuxt 4/Vue 3 web application;
- an always-running Node.js/TypeScript climate engine;
- a shared deterministic climate-core package.

Production is packaged as one Unraid-oriented container in which the engine serves the generated Nuxt application from the same port as its API. The engine migrates `/config/aether.sqlite` before serving requests, persists Home Assistant OAuth credentials and browser sessions, and protects application APIs. Initial setup and sign-in screens exist. MVP topology and schedule schemas, pure schedule evaluation, and engine configuration persistence and API are implemented. Administrators can edit installation settings, plants, zones, rooms, and discovered Home Assistant climate entity assignments in the web app. The schedule editor, ongoing Home Assistant state observation, MQTT selection, schedule execution, and live device state remain to be built.

The authenticated `GET /api/v1/installation/configuration` route returns the complete installation, its integer revision, and topology issues. Before the first save it returns `{ "status": "not_configured", "revision": 0 }`. An administrator can send `PUT /api/v1/installation/configuration` with `{ "revision": 0, "installation": { ... } }` to create it, then use the returned revision for each later save. An outdated revision returns HTTP 409. Writes require the canonical `Origin` and `X-Aether-CSRF` header, and accept up to 4 MiB of JSON. Incomplete linked drafts are saved and their topology issues returned; duplicate identifiers are rejected because the database cannot represent them.

## Core boundary

Home Assistant owns the equipment. Aether may read relevant Home Assistant entities, but all HVAC mode and target-temperature changes must go through configured `climate.*` entities.

The MVP domain relationship is:

```text
Zone → zero or more Rooms
Zone or Room → zero or more Climate Controllers → Plant
Installation → whole-house Schedules → main/override selection
```

Each schedule block selects one attached climate entity and its supported settings. Plants group controllers in the MVP; automatic heat-source selection is later work.

## Documentation

- [SPEC.md](./SPEC.md) — active MVP product and architecture specification
- [ROADMAP.md](./ROADMAP.md) — deferred ideas and superseded design decisions
- [docs/ORIGINAL_SPEC.md](./docs/ORIGINAL_SPEC.md) — verbatim earlier specification
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

Aether is then available at `http://localhost:3001`. The engine serves both the generated UI and same-origin `/api/*` routes. The generated initial setup code appears once in the container output whenever Home Assistant setup is incomplete; restarting the incomplete setup generates a replacement code.

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

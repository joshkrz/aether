# Aether

Aether is a local-first hybrid climate orchestrator for Home Assistant. It coordinates heating and cooling through configured `climate.*` entities while accounting for room demand, shared physical plant, schedules, predictions, energy cost, manual operation, and equipment constraints.

The product and architecture source of truth is [SPEC.md](./SPEC.md).

## Status

The core domain foundation and initial Nuxt web shell are implemented in an npm-workspaces monorepo containing:

- a Nuxt 4/Vue 3 web application;
- an always-running Node.js/TypeScript climate engine;
- a shared deterministic climate-core package;
- MariaDB with Drizzle; and
- Docker Compose for local deployment.

Persistence, Home Assistant connectivity, and live engine-to-web data are not implemented yet.

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

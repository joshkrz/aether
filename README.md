# Aether

Aether is a local-first hybrid climate orchestrator for Home Assistant. It coordinates heating and cooling through configured `climate.*` entities while accounting for room demand, shared physical plant, schedules, predictions, energy cost, manual operation, and equipment constraints.

The product and architecture source of truth is [SPEC.md](./SPEC.md).

## Status

The project is in the specification and initial setup phase. The intended implementation is an npm-workspaces monorepo containing:

- a Nuxt 4/Vue 3 web application;
- an always-running Node.js/TypeScript climate engine;
- shared domain and database packages;
- MariaDB with Drizzle; and
- Docker Compose for local deployment.

Do not treat the proposed package layout as implemented until the corresponding files exist.

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

Setup and run instructions will be added when the initial workspace is scaffolded.

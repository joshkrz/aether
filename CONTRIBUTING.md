# Contributing

## Before changing code

Read `SPEC.md`. Preserve the unified Room ⇄ Climate Controller → Plant → Energy Source model and the rule that HVAC commands target Home Assistant `climate.*` entities only.

## Working conventions

- Use npm workspaces and root-level scripts.
- Use TypeScript throughout the application and engine.
- Keep the climate core independent of Nuxt/Nitro.
- Prefer configuration, capabilities, and plant constraints over technology-specific branches.
- Keep server state in TanStack Query; do not duplicate it in client stores.
- Add dependencies only for a demonstrated need. New libraries must be current, actively maintained, widely adopted, compatible with the supported stack, and checked for known critical security issues. Do not use deprecated, abandoned, archived, or materially out-of-date packages.
- Update `SPEC.md` when an architectural or product decision changes.

## Quality checks

Changes should pass the relevant formatting, lint, dead-code, type, unit, and end-to-end checks once those scripts exist. Climate decision logic requires deterministic unit coverage, especially for shared controllers, plant constraints, manual reservations, interlocks, source switching, and schedule/DST behaviour.

### Tooling configuration dependencies

The checked-in root ESLint and Prettier configurations require these development packages when the workspace is scaffolded:

- `eslint`
- `@eslint/js`
- `typescript`
- `typescript-eslint`
- `eslint-plugin-vue`
- `globals`
- `@tanstack/eslint-plugin-query`
- `@vue/eslint-config-prettier`
- `prettier`
- `prettier-plugin-tailwindcss`

The web workspace will additionally use the official `@nuxt/eslint` module for Nuxt-generated, project-aware rules once `apps/web` exists. Keep its configuration composed with the repository rules rather than maintaining a second conflicting rule set.

Oxlint and JSDoc lint plugins are intentionally not part of this project.

### Pre-commit checks

Husky runs `npm run precommit` before every commit. The hook:

1. Uses lint-staged to format staged supported files with Prettier.
2. Runs ESLint with automatic fixes on staged code files.
3. Re-stages successful fixes.
4. Runs Knip across the complete workspace.

An unfixable formatting, lint, or Knip error blocks the commit. Run `npm run precommit` to execute the same checks manually.

## Repository hygiene

- Never commit secrets or populated environment files.
- Keep machine-specific IDE state out of Git.
- Shared editor recommendations may be committed under `.vscode/`; personal settings belong outside the repository.
- Do not commit generated build, coverage, test-report, or local runtime-data directories.

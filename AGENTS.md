# Repository guidance

## Collaboration and approval

Work through requested changes step by step. Before editing:

1. Inspect the relevant existing files and current Git state.
2. Explain the proposed ordered steps, why each step is needed, what will happen, and which files may change.
3. State any missing information, ambiguity, or assumption that could affect behaviour, architecture, dependencies, data, or user experience.
4. Ask the user to resolve each such point before implementing it. Do not silently choose a default or infer an unstated requirement.
5. Wait for the user's explicit go-ahead before starting the first implementation step.
6. Implement only that approved step.
7. Explain what changed, why it changed, what happened during implementation, and how the result was verified.
8. Invite feedback and wait for the user's explicit go-ahead before moving to the next step.
9. After the final approved step, clearly report all changed files, checks performed, and anything still undecided.

Read-only discovery and verification may proceed without approval. Implementation must pause at every step boundary even when the request is explicit or the edit appears mechanical. Never treat approval of one step as approval of later steps. Ask separately before destructive actions, dependency or tooling choices, architectural changes, external side effects, or any assumption that could materially change the result.

## Source of truth

Read `SPEC.md` before implementation. It is the active MVP contract. `docs/ORIGINAL_SPEC.md` preserves the earlier vision verbatim, and `ROADMAP.md` indexes deferred and superseded ideas; neither overrides the active spec. The current code still reflects parts of the earlier design. If code and the active spec disagree, surface the discrepancy and resolve it explicitly rather than silently changing the domain model. Resolve `SPEC.md`'s open decisions before implementing the affected behaviour.

## Architecture invariants

- Use the MVP hierarchy: Installation → Zones / Rooms / Climate Controllers / Plants / whole-house Schedules.
- A Room belongs to zero or one Zone; a Zone contains zero or more Rooms. Zones and Rooms may each have multiple Climate Controllers.
- Every Climate Controller wraps one configured Home Assistant `climate.*` entity, belongs to a Zone or Room, and references one Plant. A `climate.*` entity is configured only once.
- Plants group Climate Controllers in the MVP. Automatic source selection, efficiency modelling, and advanced plant constraints remain future work; resolve the active spec's shared-plant safety question before affected live control.
- Each schedule block selects one Climate Controller attached to its Zone or Room and stores only settings supported by that `climate.*` entity.
- Main and override schedule selections are installation-wide. The override replaces the main schedule in full. MQTT exposes those selections to Home Assistant; it does not carry HVAC equipment commands.
- An active Room block suppresses every automatically controlled Climate Controller on its Zone. Manual Zone and Room control follows the precedence and expiry rules in `SPEC.md`.
- Only configured `climate.*` entities may receive HVAC state or target-temperature commands.
- When prediction is introduced, keep it separate from deterministic control policy. The MVP uses each climate entity's own thermostat for temperature regulation.
- Keep deterministic domain and climate policy in `packages/core`.
- Keep `packages/core` free of Nuxt, Vue, databases, networks, filesystems, process state, wall-clock access, Home Assistant clients, and other side effects. Pass these values in as plain typed data.
- Use `apps/engine` as the imperative Node.js shell for scheduling, persistence, Home Assistant communication, reconciliation, command execution, and process lifecycle.
- Use `apps/web` as the Nuxt shell for configuration, dashboards, diagnostics, and user interaction.
- Do not duplicate climate policy in either shell. The web app must not control Home Assistant directly; control requests go through the engine boundary.
- Standalone authentication delegates identity to Home Assistant OAuth; do not add local passwords or expose Home Assistant tokens to browser code.
- Keep MQTT broker credentials server-side; configure the broker through authenticated Aether application APIs.
- Keep Home Assistant OAuth tokens server-side and use an opaque, host-only, `HttpOnly`, `SameSite=Lax` Aether session cookie. Use `Secure` whenever the public URL is HTTPS.
- Treat `AETHER_PUBLIC_URL` as the explicit canonical origin for OAuth callbacks, redirects, cookie security, and origin checks. Do not infer it from forwarded headers.
- Require HTTPS unless the user explicitly sets `AETHER_ALLOW_INSECURE_HTTP=true`. Insecure mode is limited to local development or trusted private networks, must warn prominently, and must never be silently enabled.
- Require authentication, authorization, origin validation, and CSRF protection as appropriate before adding mutating APIs. Keep the health endpoint independent of authenticated application APIs.

## Implementation style

- Preserve user changes and keep edits scoped.
- Prefer simple, explicit TypeScript and data-driven policies.
- Name files that primarily export a domain schema/type in PascalCase, matching the domain concept, for example `Room.ts` or `ClimateController.ts`.
- Name utility, operation, and cross-entity policy files in camelCase, for example `topologyValidation.ts` or `sourceSelection.ts`. Do not use kebab-case filenames.
- In `packages/core`, represent entities as plain data defined by Zod schemas and infer their TypeScript types from those schemas. Do not maintain duplicate handwritten interfaces.
- Implement core behaviour with pure functions and discriminated unions. Do not use classes or class inheritance in the core.
- Use classes in a shell only when genuinely stateful lifecycle or resource ownership makes them clearer, such as a persistent Home Assistant connection. Prefer interfaces, factories, and functions otherwise, and do not create broad classes that absorb climate policy.
- Keep Vue components flat and descriptive; abstract behaviour or domain meaning, not trivial markup.
- Add tests alongside climate-core behaviour changes.
- Run the smallest relevant verification first, then broader checks before handoff.

## Dependency policy

- Add a library only when it provides clear value that is not reasonably covered by the platform or existing dependencies.
- Before proposing or installing it, verify that it is current, actively maintained, widely adopted, compatible with the project's supported runtime and framework versions, and free of known critical security issues.
- Check recent releases, maintenance activity, documentation quality, ecosystem usage, and the health of its transitive dependencies. Popularity alone is not sufficient.
- Do not add deprecated, obsolete, abandoned, archived, or materially out-of-date libraries.
- Prefer stable releases and well-supported first-party or established ecosystem packages. Do not use prerelease packages without explicit user approval.
- Explain the choice and credible alternatives before installing a new dependency. If no maintained option exists, stop and ask the user rather than silently selecting an unmaintained package.

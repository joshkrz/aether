# Aether MVP checkpoint — 22 September 2026

This is a handoff note, not a replacement for the [active MVP specification](./SPEC.md). Read [AGENTS.md](./AGENTS.md) before changing code. The earlier vision is preserved in [docs/ORIGINAL_SPEC.md](./docs/ORIGINAL_SPEC.md), and [ROADMAP.md](./ROADMAP.md) indexes ideas deferred or superseded by the MVP.

## Where the project stands

Aether is intended to run whole-house heating and cooling schedules through configured Home Assistant `climate.*` entities. A zone can contain any number of rooms; a room may have no zone. Both zones and rooms can have multiple climate entities. Every configured climate entity belongs to one plant and one zone **or** room. Plants group equipment for now; automatic heat-source selection is later work.

The current working tree is on `main` at base commit `dd7a83f` (`Fan and cleaning mode spec`) and contains **many uncommitted and untracked MVP changes**. The checkpoint itself is another untracked file until committed. Preserve the working tree when resuming; do not assume `git reset`, branch switching, or a clean checkout is safe. Run `git status --short` first.

### Implemented and verified

- Standalone Home Assistant OAuth setup and sign-in, server-side encrypted credentials, protected application APIs, and a same-origin Nuxt/engine deployment. See [README.md](./README.md).
- MVP topology and schedule schemas, topology checks, whole-house main/override resolution, and pure automatic schedule evaluation in [packages/core](./packages/core/src/index.ts). Evaluation already produces off intent when no schedule or block applies and suppresses zone entities while a room in that zone has an active block. This is **policy calculation**, not equipment execution.
- SQLite tables and a revisioned whole-installation read/save API. Incomplete linked drafts can be saved with topology errors; duplicate identifiers and stale revisions are rejected. See [installationConfigurationHandler.ts](./apps/engine/src/installationConfigurationHandler.ts) and [installationRepository.ts](./apps/engine/src/database/installationRepository.ts).
- Administrator UI for installation settings, plants, zones, rooms, and climate entity assignments in [InstallationConfigurationPanel.vue](./apps/web/app/components/InstallationConfigurationPanel.vue). A plant can exist without an assigned controller.
- Administrator-only, read-only Home Assistant climate discovery through the engine, using its server-side grant. The browser receives filtered names, modes, and capability fields, not OAuth tokens. The editor assigns each available `climate.*` entity at most once to one plant and one zone or room. See [homeAssistantClimateDiscovery.ts](./apps/engine/src/homeAssistantClimateDiscovery.ts) and [ClimateEntityDiscovery.ts](./packages/core/src/ClimateEntityDiscovery.ts).
- Saved assignments remain when an entity disappears, becomes unavailable, or reports changed modes; the editor warns for review. Devices with only `auto` or `heat_cool` and no separate `heat` or `cool` mode appear but cannot be newly assigned. An entity without a reported `off` mode can be assigned, but the editor warns that automatic off cannot be enforced for it.

The last completed verification passed `npm run build` and `npm run check` (format, lint, type checks, and 271 root unit tests). The discovery and assignment path has mock-based tests; it has **not been tested against a live Home Assistant installation**. No schedule editor, continuous observation, MQTT connection, or live climate command path is present.

## Agreed MVP behaviour to preserve

- Each reusable weekly schedule spans the whole installation and shows every zone and room. A block belongs to one row, selects one climate entity attached to that row, and stores settings that device reports as supported. Saved target temperatures use Celsius internally.
- `overrideScheduleId`, when selected, completely replaces `mainScheduleId`. No schedule, a missing selected schedule, or no active block means automatic **off** intent for the affected configured entities.
- Any active room block turns **all zone climate entities off** under automatic control, even when the zone has its own block.
- External manual control normally lasts until the next relevant schedule-block boundary, with an optional per-entity **Manual until** time. Changing either whole-house schedule slot ends manual control. A manually activated room forces its zone off; a manually activated zone stops the room entities; the most recent conflicting manual on-action wins. Re-evaluate the current schedule when manual control ends.
- Home Assistant MQTT select entities will choose the installation-wide main and override schedules. MQTT does not send equipment commands; Aether will command only its configured Home Assistant `climate.*` entities. Live control must begin as dry-run and require explicit enabling.

The detailed rules, especially daylight-saving behaviour, capabilities, authentication, and execution safety, are in [SPEC.md](./SPEC.md).

## Next implementation step

Build the **whole-house schedule editor** on the existing revisioned installation save flow:

1. Create, rename, and remove multiple weekly schedules. Show every configured zone and room as a row for each day, including empty rows.
2. Add and edit timed, non-overlapping blocks. A new block first picks a climate entity attached to that row.
3. Show only the selected entity's reported writable settings and choices: HVAC mode, single target or range, fan, preset, swing, horizontal swing, and humidity where supported. Respect reported limits, steps, and display unit; store temperatures in Celsius.
4. Make saved blocks with missing entities or changed capabilities visible for repair, without silently deleting them. Keep topology and schema errors visible in drafts.

Before implementing deletion behaviour for a selected schedule, resolve the open decision in [SPEC.md §8](./SPEC.md#8-open-decisions-before-affected-implementation). Work on this as one approved repository step at a time under [AGENTS.md](./AGENTS.md).

## Remaining MVP work after schedule editing

1. **MQTT configuration and selection:** secure broker settings in the app, connection test/status, Home Assistant discovery for the main and override select entities, validated persisted requests, confirmed state, and reconnect behaviour.
2. **Ongoing Home Assistant observation and dry-run:** track actual `climate.*` states and capabilities, evaluate the selected schedule with fresh observations, and show proposed commands separately from executed commands.
3. **Manual control:** distinguish external setting changes from Aether acknowledgements; persist per-entity expiry; enforce the room/zone precedence and most-recent-action rules.
4. **Live command path and diagnostics:** explicitly enable live mode; revalidate entity capabilities and temperature limits; check telemetry freshness; space and acknowledge commands; reconcile after restart or reconnect; audit decisions and failures; show requested mode versus `hvac_action` and why commands were blocked.

Open decisions still recorded in [SPEC.md §8](./SPEC.md#8-open-decisions-before-affected-implementation): the minimum interlock for incompatible modes on a shared HVAC plant, selected-schedule deletion and affected-block recovery, and MQTT broker/TLS/topic defaults. Resolve each before implementing the affected behaviour. The archived ideas in [ROADMAP.md](./ROADMAP.md) remain available for later releases.

## Resuming

1. Read this file, [SPEC.md](./SPEC.md), and [AGENTS.md](./AGENTS.md); check `git status --short` before editing.
2. Confirm the next step's behaviour and any open decision it touches. Keep edits scoped to that step and preserve the existing uncommitted work.
3. Run the smallest relevant tests, then `npm run check` and `npm run build` before handoff. HTTP server tests need permission to bind localhost in restricted sandboxes.

# Aether — MVP Specification

## Status and source of truth

This document defines the current MVP. It replaces the earlier product specification, which is preserved verbatim in [docs/ORIGINAL_SPEC.md](./docs/ORIGINAL_SPEC.md). [ROADMAP.md](./ROADMAP.md) indexes the earlier ideas so they remain available for later work. The original specification records the earlier design; it does not override this document where they differ.

This specification records agreed product behaviour, not a claim that the behaviour is implemented. The current implementation has authentication, MVP topology and schedule schemas, pure schedule evaluation, engine persistence and a protected read/save API for installation configuration, a topology editor for installation settings, plants, zones, rooms, and climate entity assignments, read-only Home Assistant climate discovery, and a read-only overview. The schedule block editor, ongoing Home Assistant state observation, MQTT schedule selection, and climate execution still need to be built. Open decisions below must be settled before implementing the affected behaviour.

## 1. Purpose and first usable release

Aether is a local application that executes whole-house schedules across multiple Home Assistant heating and cooling systems. A user can configure zones, rooms, and the `climate.*` entities assigned to them; create whole-house schedules; choose the active main or override schedule from Home Assistant; and see and control what each configured climate entity is doing.

The MVP is usable when an administrator can:

1. Connect Aether to Home Assistant and configure the MQTT broker in Aether.
2. Add plants, zones, rooms, and multiple `climate.*` entities on either zones or rooms.
3. Create more than one whole-house schedule and add timed blocks to zone and room rows.
4. Select a climate entity for each block and set the controls that entity exposes through Home Assistant.
5. Select a main schedule and an optional override in Home Assistant using Aether's MQTT select entities.
6. Run the schedule with the room/zone priority and manual-control rules below.
7. Inspect the active schedule, requested settings, actual Home Assistant state, manual status, and failed or inhibited commands in Aether.
8. Explicitly enable live execution after reviewing dry-run decisions.

The selected Home Assistant climate entity uses its own thermostat to regulate toward Aether's requested target. A separate room temperature sensor, room-demand calculation, prediction, and automatic heat-source selection are not required for MVP control.

## 2. Topology

```text
Installation
├─ Zones ── zero or more Rooms
├─ Rooms ── zero or one Zone each
├─ Climate Controllers ── attached to one Zone or Room
├─ Plants ── group Climate Controllers
└─ Whole-house Schedules
   └─ Installation-wide main and override selections
```

- A zone may have no rooms. A room may have no zone.
- A zone or room may have zero or more Climate Controllers. Every Climate Controller wraps one configured Home Assistant `climate.*` entity. A `climate.*` entity is configured only once.
- Every Climate Controller references one Plant. A Plant may group multiple controllers: for example, Upstairs and Downstairs central-heating thermostats under a Central Heating plant, or three indoor AC units under an HVAC plant.
- A Plant may have no assigned Climate Controllers during setup or later; this is valid topology and does not produce a warning.
- A Climate Controller belongs to a zone or a room as its scheduling location. The hierarchy does not assume that every zone has a boiler or that every room has an AC.
- Plants are grouping and descriptive configuration in the MVP. They do not select heat sources, estimate efficiency, or optimize cost. Future plant constraints and source modelling remain in the roadmap. The live-control policy for incompatible simultaneous modes on one physical plant is an open decision.
- The engine controls HVAC mode, target temperature, and other configured climate settings only through those configured `climate.*` entities. It does not directly control valves, switches, relays, TRVs, or vendor-specific services.

## 3. Whole-house schedules and selection

A Schedule is a reusable weekly whole-house plan. Its timeline presents every configured zone and room, including those with no blocks. A schedule may be named Home, Away, School Holiday, or anything else; names do not carry built-in behaviour.

There are two installation-wide schedule slots:

- `mainScheduleId` is the normal selection.
- `overrideScheduleId` is optional. When set, its schedule is applied as a complete replacement. No blocks or settings are inherited from the main schedule. Clearing it restores the then-current main selection.

The effective schedule is `overrideScheduleId ?? mainScheduleId`. Home Assistant can change either slot independently, including changing the main selection while an override is active. If no schedule is selected, or the selected schedule no longer exists, the automatic schedule intent for every configured climate entity is off. A missing selected schedule is also a visible configuration error; it must never produce an on-request, but safe off-commands may still be issued to configured entities after the other execution checks. If a selected schedule has no active block for a location, the automatic schedule intent for that location's climate entities is off. Aether must not leave an automatically owned entity running after its applicable block has ended. Manual control may temporarily supersede these automatic intents under section 5.

Schedule times use the installation's IANA timezone. Blocks have a start and end within a local day. Two blocks on the same zone or room row may not overlap, even if they select different climate entities; adjacent blocks are allowed. Blocks on different rows may overlap. Evaluation uses the local wall-clock day and minute at the supplied instant. Nonexistent local minutes during a spring clock change are skipped. A repeated local minute during an autumn clock change applies the same block during both occurrences.

### 3.1 Blocks and climate capabilities

Creating a block on a zone or room first presents the `climate.*` entities attached to that location. The user selects one entity for the block. The editor then presents the writable settings that entity reports through the standard Home Assistant climate model. Depending on the device, these can include HVAC mode, a target temperature or temperature range, fan mode, preset mode, swing modes, and target humidity. A central-heating thermostat may expose only mode and target temperature; an AC may expose more.

The editor must use the entity's reported choices, limits, units, and supported features. It must not invent integration-specific mode or fan labels. The engine validates saved settings against current capabilities again before a command. Unsupported or out-of-range settings must not be sent and must be visible as a configuration or execution problem. A block selects one climate entity; Plant membership does not implicitly select another.

Saved target temperatures use Celsius internally. The editor converts to and from the climate entity's reported display unit, and the engine converts before sending a Home Assistant command. Fan, preset, and swing choices retain the entity's reported labels and are checked against its current choices before execution.

Home Assistant's `hvac_mode` is the requested operating mode. `hvac_action` reports physical activity and must not be presented as a command or as proof that a requested mode is heating or cooling at that instant.

### 3.2 Room and zone priority

While any room in a zone has an active schedule block, every climate entity attached to that zone must be off under automatic schedule control, regardless of the zone's own blocks or which zone entity those blocks select. The room's selected entity follows its room block. A room without a zone does not suppress a zone. Other zones continue independently.

Manual operation has the precedence described in section 5. In particular, an active manual zone command is temporarily allowed to override scheduled room blocking, while a manually activated room forces the zone off.

## 4. Home Assistant and MQTT connections

The existing standalone deployment uses Home Assistant OAuth for identity and a separate server-side engine authorization. Home Assistant tokens remain in the engine. The browser uses an opaque Aether session cookie. Home Assistant administrators configure Aether; the unauthenticated health endpoint remains separate from application APIs.

The engine reads configured climate entity state and capabilities from Home Assistant. The web app communicates with the engine's same-origin API. MQTT is used for choosing Aether schedules in Home Assistant; Aether still executes equipment commands through configured Home Assistant `climate.*` entities.

The initial topology editor discovers `climate.*` states through an administrator-only engine API using the engine's server-side OAuth grant. It shows reported modes and options, and allows a discovered, available entity with a separate `heat` or `cool` mode to be assigned once to a Plant and a room or zone. Devices reporting only `auto` or `heat_cool` remain visible but cannot be newly assigned until that mode model is supported. Saved assignments are not removed or rewritten when an entity disappears, becomes unavailable, or reports changed capabilities; the editor warns the administrator to review them. This discovery step does not itself execute climate commands.

An administrator configures MQTT in the Aether app, including broker address and port, transport security, credentials when needed, and the Home Assistant discovery prefix. Credentials are stored server-side in protected persistent storage and are never returned to browser code. The app displays connection state and provides a way to verify the connection. The exact defaults and connection settings require review during the MQTT implementation step.

Aether publishes two Home Assistant MQTT select entities:

- Main schedule: the available Aether schedules.
- Override schedule: the available Aether schedules plus an explicit no-override choice.

Aether publishes updated options as schedules change. A Home Assistant selection is treated as a request: the engine validates it against existing schedules, persists the accepted selection, and publishes the confirmed state. The engine's persisted selection is authoritative. MQTT command messages must not be retained, so an old request cannot replay after a reconnect. Availability reports when Aether is offline; discovery and confirmed state are republished as needed after reconnect or restart. Broker access to the command topics grants schedule-control authority and must be treated accordingly.

If MQTT disconnects, Aether continues the last accepted, persisted main and override selections. Home Assistant selectors become unavailable until the connection recovers. Loss of MQTT by itself does not turn equipment on or off or select a different schedule.

## 5. Manual control

Automatic control is separate from the Home Assistant HVAC mode. Aether distinguishes a material external change to a controlled climate setting from acknowledgement of one of its own commands. External physical telemetry changes, including `hvac_action`, do not alone create a manual override.

- By default, external manual control of a climate entity lasts until the next schedule-block boundary relevant to that entity. For a manual change at 10:00 during a 09:00–11:00 block, automatic control resumes at 11:00.
- A user may set an explicit **Manual until** time for an individual climate entity in Aether. That time may extend manual control across block boundaries and persists across engine restarts.
- A change to either installation-wide schedule slot ends manual control so the newly effective whole-house schedule can take effect.
- When manual control ends, Aether evaluates the schedule active at that time. It does not restore an old scheduled command blindly.

Manually turning on a zone climate entity turns off the climate entities attached to all rooms in that zone. Manually turning on a room climate entity turns off every climate entity attached to its zone. If these manual on-actions conflict, the most recent action wins and cancels the older conflicting manual override. When the winning manual period ends, Aether re-evaluates the current schedule rather than reviving the cancelled manual setting. Manual actions on unrelated zones or rooms do not affect each other.

An active manual zone on-action temporarily overrides the normal scheduled room-block suppression. An active manual room on-action always forces its zone entities off. This exception and precedence supersede the archived specification's blanket rule that manual controllers are never commanded.

## 6. Execution, safety, and visibility

`packages/core` owns pure topology validation, schedule resolution, room/zone precedence, manual precedence, and deterministic command planning. It receives observations and time as plain typed inputs. `apps/engine` owns Home Assistant and MQTT connections, persistence, the clock, reconciliation, audit, and command execution. `apps/web` owns configuration, schedule editing, status, and diagnostics; it does not send equipment commands directly.

The engine starts in `dry_run`. Dry-run uses real observations and records intended commands but sends no climate service calls or synthetic acknowledgements. Only an explicit `live` setting enables equipment commands. The UI labels dry-run intentions and live commands distinctly.

Before live execution, the engine must:

- Validate topology, the configured `climate.*` target, and current entity capabilities and temperature limits.
- Check observation freshness and connection status. Missing or stale evidence must not be treated as a successful command.
- Apply the room/zone and manual priority rules at planning time and again immediately before execution.
- Enforce safe command spacing and acknowledge or reconcile commands before retrying.
- Re-read actual Home Assistant state and reconcile manual ownership after startup or reconnection before issuing automatic commands.
- Record the decision, selected schedule and block, target entity, requested settings, observed state, issued service call, acknowledgement, and any failure or inhibition.
- Restrict configuration and live-mode mutations to authenticated, authorized requests with origin and CSRF protection as appropriate. The health endpoint remains independent.

The UI must show the effective main or override schedule, each zone and room's current block, why a zone is blocked, current requested HVAC mode versus actual `hvac_action`, manual owner and expiry, and unavailable or rejected commands. Aether must never present a proposed dry-run action as executed.

## 7. Deferred ideas and design history

The original specification is retained exactly in [docs/ORIGINAL_SPEC.md](./docs/ORIGINAL_SPEC.md). [ROADMAP.md](./ROADMAP.md) indexes its ideas and distinguishes features deferred for later from domain choices superseded by this MVP. In particular, future work may add separate room sensors, demand prediction, solar exposure, outdoor/forecast gates, energy-source and tariff modelling, automatic heat-source selection, plant efficiency and constraints, post-cooling cleaning, and deeper diagnostics. Safety, authentication, and command reconciliation needed for live control remain MVP work.

## 8. Open decisions before affected implementation

These points are intentionally unsettled. Do not infer a rule from the archived specification or current code when it conflicts with this MVP.

1. What minimum plant-level interlock is needed before live control when several indoor units share one physical HVAC plant and request incompatible modes? Plant membership does not perform automatic source selection in the MVP.
2. What should happen if a selected schedule is deleted after blocks were saved? Unsupported settings may never be sent. For climate entities that disappear or change capabilities, retain their assignment and warn for review; the later schedule editor and live executor still need a recovery and editing experience for affected blocks.
3. What exact broker defaults, TLS validation behaviour, and topic authorization model should the MQTT settings UI use?

Resolve each before implementing the affected feature, update this document, then proceed with that approved step.

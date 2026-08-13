# Hybrid Climate Orchestrator — Living Specification

## 1. Purpose

Hybrid Climate Orchestrator is a local-first application that coordinates heating and cooling exposed by Home Assistant. It predicts room demand, applies schedules and manual overrides, selects suitable climate controllers, enforces shared-equipment constraints, and explains every decision.

The system supports any number of rooms, controllers, plants, energy sources, and schedules. The MVP targets boiler thermostat zones and split or multi-split heat pumps without embedding those technologies as parallel orchestration models.

## 2. Architectural principles

- Home Assistant owns equipment; this application orchestrates Home Assistant `climate.*` entities.
- The application may read any relevant HA entity, but may change HVAC mode or target temperature only through configured `climate.*` entities.
- Prediction estimates future temperature; deterministic policy decides what to do. A model must never directly control equipment.
- Configuration, constraints, and capabilities drive behaviour. The core pipeline must not branch around special-case domains such as `SharedHeatingZone`.
- Automatic actions must be safe, bounded, observable, and explainable.
- A single active engine instance may control an installation.

## 3. Unified entity hierarchy

```text
Installation
├─ Rooms
├─ Climate Controllers
├─ Plants
├─ Energy Sources
└─ Schedules
```

The primary topology is:

```text
Room ⇄ Climate Controller → Plant → Energy Source
Room ⇄ Schedule
Room → Sensors / Window Surfaces
```

### 3.1 Installation

The installation is the configuration and coordination boundary. Its core representation defines the IANA timezone, display temperature unit, and collections of all top-level entities and normalized relationships.

```ts
interface Installation {
  id: InstallationId;
  name: string;
  timeZone: string;
  displayTemperatureUnit: 'celsius' | 'fahrenheit';
  safety: InstallationSafetySettings;
  rooms: Room[];
  climateControllers: ClimateController[];
  plants: Plant[];
  energySources: EnergySource[];
  schedules: Schedule[];
  roomControllerLinks: RoomControllerLink[];
  roomScheduleLinks: RoomScheduleLink[];
  roomScheduleSelections: RoomScheduleSelection[];
}

interface InstallationSafetySettings {
  minimumTargetTemperatureCelsius: number;
  maximumTargetTemperatureCelsius: number;
  maximumTelemetryAgeSeconds: number;
  minimumCommandIntervalSeconds: number;
  commandAcknowledgementTimeoutSeconds: number;
}
```

Home Assistant connection details and credentials are engine-owned infrastructure configuration and never enter deterministic core policy.

All safety values are explicit configuration; the core schema does not silently supply operational defaults. The minimum target must be lower than the maximum. An outgoing target must satisfy both the installation envelope and the controller entity's reported limits; out-of-range targets are rejected and explained rather than silently changed. Stale telemetry blocks new automatic heating or cooling commands. Command spacing applies per controller, although a safety-motivated `off` may bypass the interval and must be logged. A missing command acknowledgement triggers reconciliation rather than blind retries.

Plant-specific active-controller limits, minimum run/rest durations, and source-switch settling remain in `PlantConstraints`. Temperature hysteresis belongs to deterministic demand policy rather than installation safety configuration.

Schedule instants are evaluated in the installation timezone. DST gaps and repeated local times must be handled deterministically and tested.

Core temperatures are stored and evaluated in Celsius. The engine converts Home Assistant readings and outgoing targets at the shell boundary when necessary. `displayTemperatureUnit` controls presentation only and does not change core calculations.

Installation data is structurally parsed before a separate pure topology validation pass. Topology errors make a configuration invalid: duplicate IDs within an entity collection, duplicate controller `climate.*` entities, dangling controller-to-plant or plant-to-energy-source references, dangling or duplicate relationship links, duplicate room schedule-selection records, missing or unassigned selected schedules, and controller modes unsupported by their plant.

Safe but incomplete setup is reported as warnings rather than errors: controllers with no room link, plants with no controller, and identical base and override schedule selections. Empty installations, rooms without controllers, rooms with no selected schedule, unassigned reusable schedules, unused energy sources, and sensor reuse across rooms remain valid. Textual IDs are unique within their entity type rather than globally across different entity types. Validation returns structured issues and never mutates installation configuration.

### 3.2 Room

A room is the unit of comfort, sensing, prediction, and demand. A room may be linked to zero or more climate controllers, and a controller may serve one or more rooms. This is an explicit many-to-many relationship.

```ts
interface Room {
  id: string;
  name: string;
  temperatureEntityId: string;
  humidityEntityId?: string;
  windowOrDoorEntityIds?: string[];
  windows?: WindowSurface[];
}
```

Multiple controllers in one room are valid, including multiple indoor AC units plus a shared boiler controller. A shared controller may serve any number of rooms.

The room temperature sensor may differ from a controller's internal sensor. Room demand and comfort use the configured room sensor; controller-reported temperature remains diagnostic input unless explicitly selected.

Aether does not infer occupancy or presence. Home Assistant owns presence, calendar, and household-mode automation and may use those inputs to select a room's schedule through the engine API.

### 3.3 Climate Controller

A climate controller is the only controllable HVAC abstraction. Every controller:

- is backed by exactly one Home Assistant `climate.*` entity;
- references exactly one plant;
- serves one or more rooms;
- declares `local` or `shared` scope; and
- exposes resolved heating, cooling, and off capabilities.

```ts
type ClimateEntityId = `climate.${string}`;
type ControllerScope = 'local' | 'shared';

interface ClimateController {
  id: string;
  name: string;
  entityId: ClimateEntityId;
  scope: ControllerScope;
  plantId: string;
  capabilities: {
    heat: boolean;
    cool: boolean;
    off: boolean;
  };
  controlProfile: {
    heatingMode?: string;
    coolingMode?: string;
    offMode?: string;
  };
  manualOverridePolicy: ManualOverridePolicy;
}
```

The many-to-many relationship is stored once as normalized links:

```ts
interface RoomControllerLink {
  roomId: RoomId;
  controllerId: ClimateControllerId;
}
```

Room-to-controller and controller-to-room collections are derived from these links. `Room.controllerIds` and `ClimateController.roomIds` are not persisted because duplicate writable lists could disagree. The database maps this relationship to a join table.

`local` describes a controller whose effects are normally confined to its served room or rooms, such as an indoor split unit. `shared` describes a controller whose activation has consequences across several rooms, such as a boiler thermostat zone. Scope informs demand aggregation and explanations; it does not change the entity shape.

Standard HA modes are discovered from `hvac_modes`: prefer `heat`, `cool`, and `off`. Ambiguous modes such as `auto` or `heat_cool` are not selected automatically. Advanced overrides may resolve unusual integrations. `hvac_action` indicates actual activity and must not be confused with the configured HVAC mode.

### 3.4 Plant

A plant represents physical equipment shared by one or more controllers, such as a gas boiler or a heat-pump outdoor unit. It is a modelling and constraint object and need not have a Home Assistant entity.

```ts
type PlantType = 'boiler' | 'heat_pump' | 'other';

interface Plant {
  id: string;
  name: string;
  type: PlantType;
  energySourceId: string;
  constraints: PlantConstraints;
  efficiencyModel: EfficiencyModel;
}

interface PlantConstraints {
  supportedModes: Array<'heat' | 'cool'>;
  allowMixedHeatCool?: boolean;
  maximumActiveControllers?: number;
  minimumOnMinutes?: number;
  minimumOffMinutes?: number;
  settlingSeconds?: number;
}

interface EfficiencyModel {
  type: 'fixed';
  heatingPerformanceFactor: number;
  coolingPerformanceFactor?: number;
}
```

All controllers that depend on the same physical outdoor unit or boiler reference the same plant. Reverse controller membership is derived from `controller.plantId`; duplicate writable membership lists are avoided.

Plant constraints are evaluated against the complete proposed plant state, including manual controllers. For a multi-split with `allowMixedHeatCool: false`, no attached controller may automatically cool while another reserves or uses heating, or vice versa.

Efficiency is modelled at plant level so it can account for outdoor conditions, combined load, active-controller count, capacities, minimum useful load, tariffs, and learned or measured performance. The MVP uses positive fixed performance factors: useful heating or cooling energy delivered per unit of source energy consumed. A later model may add configured curves or learned performance. The orchestrator may coordinate overlapping genuine demand across several controllers when beneficial, but must not manufacture demand in a comfortable room merely to increase plant load.

### 3.5 Energy Source

An energy source represents electricity, gas, or another input consumed by a plant.

```ts
interface EnergySource {
  id: string;
  name: string;
  type: 'electricity' | 'gas' | 'other';
  tariffEntityId?: string;
  emissionsEntityId?: string;
  fixedUnitCost?: number;
}
```

Cost and emissions are inputs to source selection, not safety constraints.

### 3.6 Schedule

A schedule defines time-bounded comfort bands. Rooms and schedules have a many-to-many relationship, allowing each room to offer several schedules and each schedule to be reused by several rooms.

```ts
interface Schedule {
  id: string;
  name: string;
  days: {
    monday: SchedulePeriod[];
    tuesday: SchedulePeriod[];
    wednesday: SchedulePeriod[];
    thursday: SchedulePeriod[];
    friday: SchedulePeriod[];
    saturday: SchedulePeriod[];
    sunday: SchedulePeriod[];
  };
}

interface SchedulePeriod {
  startMinute: number;
  endMinute: number;
  minimumTemperature: number;
  maximumTemperature: number;
}

interface RoomScheduleLink {
  roomId: RoomId;
  scheduleId: ScheduleId;
}

interface RoomScheduleSelection {
  roomId: RoomId;
  baseScheduleId?: ScheduleId;
  overrideScheduleId?: ScheduleId;
}
```

Each day is configured independently. An empty day is off for the full day, and gaps between periods are off. Off means the room produces no scheduled heating or cooling demand; it does not force shared equipment off when another room has genuine demand. Manual controller operation is unaffected.

Both temperature bounds are required in every period. The minimum drives heating demand and the maximum drives cooling demand. Periods use inclusive start and exclusive end minutes in the installation's local day, cannot cross midnight, and cannot overlap. Adjacent periods are allowed. Temperatures are stored in the core's canonical Celsius unit.

The base schedule is the room's normal selection. A temporary override takes precedence without replacing that base: the effective schedule is `overrideScheduleId ?? baseScheduleId`. Clearing an Away override therefore restores the currently selected Home or School Holiday schedule, including a base selection that Home Assistant changed while the override was active. With neither selection, the room is off.

Both selected schedule IDs must be assigned to the room through `RoomScheduleLink`. The web UI and Home Assistant use the same engine operations to set a base schedule, set a temporary override, or clear an override. Aether does not interpret presence sensors or hard-code schedule roles such as Home, Away, or Occupied.

## 4. MVP boiler-zone semantics

There is no separate top-level `SharedHeatingZone` domain. A boiler zone is represented by:

```text
Rooms ⇄ shared Climate Controller → boiler Plant → gas Energy Source
```

Example:

```text
Bedroom ─┐
Nursery ─┼⇄ climate.upstairs_heating [shared] → Gas Boiler → Gas
Office ──┘
```

The MVP controls the shared zone's single `climate.*` entity using aggregate demand from its rooms. It does not independently actuate TRVs, valves, relays, or emitters. Future TRV arrangements remain possible when Home Assistant exposes an appropriate climate-controller boundary, without changing the core hierarchy.

A shared controller cannot satisfy incompatible room demands independently. The engine must expose this as constrained or unsatisfiable demand rather than oscillating the controller or implying per-room control that does not exist.

## 5. Demand and source selection

For every evaluation cycle:

```text
Inputs and schedules
→ resolve ownership/manual state
→ predict room temperature
→ calculate room demand
→ find capable controllers
→ aggregate consequences of shared controllers
→ evaluate complete plant constraints
→ estimate plant cost/efficiency
→ select a control plan
→ executor interlock
→ climate.* commands
→ observe and reconcile
```

Selection must account for comfort, controller scope, rooms affected, plant availability, existing reservations, efficiency, energy price, hysteresis, and minimum run/rest periods. Marginal economic changes must not cause rapid source switching.

Source exclusivity is derived from overlapping room/controller/plant relationships and configured policy, not hard-coded upstairs/downstairs or AC/CH identifiers. A local controller active in Bedroom may inhibit a conflicting shared controller that serves Bedroom while leaving an unrelated downstairs controller available.

Switches between mutually exclusive sources use break-before-make: stop the old source, confirm it is idle/off where possible, apply the configured settling period, then start the new source. The executor repeats constraint checks immediately before every command.

## 6. Control ownership and manual operation

Application control mode is separate from device HVAC state:

```ts
type ControlMode = 'automatic' | 'manual';
type ManualOverridePolicy =
  | { type: 'until_resumed' }
  | { type: 'duration'; minutes: number }
  | { type: 'until_next_schedule_block' };
```

- **Automatic:** the orchestrator owns mode and target decisions; `off` may be its chosen device state.
- **Manual:** the orchestrator does not command that controller until the override expires or automatic control is resumed.

Manual state is persistent across restarts. A material external change to a property owned by the orchestrator—HVAC mode, target, or explicit off/on state—may enter Manual after distinguishing it from acknowledgement of a recent orchestrator command. Device telemetry changes do not.

Manual controllers still reserve their plant mode and participate in all interlocks. If externally configured controllers create an impossible plant state, the engine must not "correct" them; it marks an external conflict, inhibits additional automatic commands on that plant, and explains the condition.

There is no separate Boost domain. A timed Manual override provides boost-like behaviour. A future convenience button may create such an override.

## 7. Prediction and solar exposure

Each room predictor estimates future temperature without proposed HVAC intervention and reports confidence/error. Initial implementations may use transparent historical nearest-neighbour or similarly simple models; sophisticated ML is optional.

Windows are room-owned solar surfaces:

```ts
interface WindowSurface {
  id: string;
  name?: string;
  azimuth: number; // 0° north, 90° east, 180° south, 270° west
  tilt?: number; // 90° for a vertical window
  area?: number;
  relativeSize?: 'small' | 'medium' | 'large';
  shadingFactor?: number;
  solarGainCoefficient?: number;
}
```

The solar model combines deterministic sun geometry, forecast irradiance or cloud conditions, and window orientation. Current lux or irradiance may correct present conditions. It outputs normalised room solar exposure or estimated gain for prediction; prediction does not need to understand window geometry directly. Basic setup asks for direction, approximate size, and shading; detailed physical values are optional.

## 8. Safety, resilience, and reconciliation

- Validate every controllable entity ID as `climate.*`.
- Apply target-temperature bounds and reject unsupported modes.
- Enforce plant constraints both during planning and at the execution boundary.
- Use minimum on/off times, hysteresis, and command rate limits.
- Persist decisions, overrides, and command correlation data.
- On startup or HA reconnection, acquire the single-engine lease, read actual states, reconcile manual/conflict status, and only then issue commands.
- Treat unavailable, stale, or inconsistent HA state conservatively.
- Never queue UI control actions while offline or claim they succeeded.
- Manufacturer/native schedules should be disabled where they would fight automatic ownership, or their interference must be detected as external control.

## 9. Explainability and diagnostics

Every automatic decision records:

- room readings, comfort bands, predictions, and confidence;
- demand and affected rooms;
- eligible and rejected controllers with reasons;
- plant constraints, reservations, and efficiency/cost estimates;
- selected controller set, targets, and modes;
- interlock and switching state;
- issued commands, acknowledgements, and failures.

The UI must distinguish requested HVAC mode from actual `hvac_action`, show Manual and constrained states prominently, and answer "why is this running or inhibited?" without requiring log inspection.

## 10. System architecture and technology

Use an npm-workspaces monorepo with this top-level structure:

```text
packages/core
apps/engine
apps/web
```

`packages/core` is the functional climate core. It owns domain types, validation, demand calculation, controller eligibility, plant-constraint evaluation, source selection, interlock decisions, and other deterministic policy. It accepts plain typed inputs and returns plain typed results. It must not depend on Nuxt, Vue, databases, networks, filesystems, process state, wall-clock access, Home Assistant clients, or other side-effecting infrastructure.

Core entities are plain serializable data defined by Zod runtime schemas, with TypeScript types inferred from those schemas. Core behaviour uses pure functions and discriminated unions rather than classes or inheritance. Classes are reserved for shell infrastructure with justified stateful lifecycle or resource ownership.

`apps/engine` is the always-running Node.js/TypeScript imperative shell. It owns scheduling, clock access, persistence, Home Assistant communication, runtime reconciliation, command execution, process lifecycle, and other side effects. It translates external state into core inputs and executes only plans that pass final shell-level safety checks. Climate policy must not be implemented in the engine shell when it can live as deterministic core logic.

`apps/web` is the Nuxt 4/Vue 3/TypeScript web shell. It owns configuration, dashboards, diagnostics, and user interaction. It may consume shared core types and explanations, but must not duplicate climate policy or communicate directly with Home Assistant to control equipment. Control requests go through the engine boundary.

```text
Home Assistant / database / clock / network
                    ↓
               apps/engine
                    ↓
              packages/core
                    ↑
                apps/web
```

MariaDB with Drizzle stores configuration, schedules, learned data, runtime ownership, and audit history. Docker Compose is the deployment baseline.

The web app communicates with the engine through a small internal HTTP API; polling is sufficient initially, with SSE/WebSockets optional later. Do not add Redis, RabbitMQ, MQTT, Nx, or Turborepo without a demonstrated requirement.

Tooling: Vite, ESLint, Prettier, Knip, Vitest, Playwright, and Zod 4. Unit tests must heavily cover demand, schedules, many-to-many topology, shared-controller aggregation, plant constraints, manual reservations, interlocks, source switching, and DST behaviour. A small end-to-end suite covers setup and critical control journeys.

## 11. User interface conventions

The UI is room- and decision-first; equipment topology belongs in System/Settings. It is mobile-first, responsive, installable as a PWA, and supports light, dark, and system themes. First-party colour tokens use OKLCH.

Use Tailwind CSS and DaisyUI. Use TanStack Query for server state; do not duplicate it in Pinia. Use Google Material Symbols imported as SVG Vue components for first-party UI and a dedicated dynamic MDI renderer only for HA-supplied `mdi:*` icons.

Keep Vue components flat and descriptively named. Use `App*`, `Field*`, `Overlay*`, `View*`, `Layout*`, `Nav*`, `Chart*`, `Status*`, and `Form*` only where their roles apply. Components should encapsulate behaviour, domain meaning, validation, or substantial reusable UI—not merely wrap HTML or DaisyUI classes.

Offline screens may show clearly labelled cached data with a last-updated time. Mutating controls are disabled when the engine or HA cannot be reached.

## 12. Non-goals for the MVP

- Direct control of switches, valves, relays, TRVs, MQTT devices, or vendor-specific services.
- Independent per-room boiler emission control when only one shared thermostat exists.
- Exact physical building simulation or guaranteed COP estimates.
- Turning on equipment in rooms without genuine demand to optimise plant loading.
- Automatic resolution of externally created manual plant conflicts.
- Dedicated `SharedHeatingZone`, `PlantGroup`, or Boost top-level domains.

## 13. Canonical examples

```text
Bedroom ⇄ climate.bedroom_ac [local] ─┐
Nursery ⇄ climate.nursery_ac [local] ─┼→ MHI Outdoor Unit → Electricity
Office  ⇄ climate.office_ac [local] ───┘

Bedroom ─┐
Nursery ─┼⇄ climate.upstairs_heating [shared] ─┐
Office ──┘                                      ├→ Gas Boiler → Gas
Lounge ──┐                                      │
Kitchen ─┴⇄ climate.downstairs_heating [shared] ┘
```

This hierarchy is canonical. New HVAC technologies should normally enter through controller capabilities, plant types, constraints, and efficiency models rather than through a parallel orchestration path.

---

This document is the living product and architecture specification. Where implementation and this specification differ, resolve the discrepancy explicitly and update this document with the agreed decision.

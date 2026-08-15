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
  advanced: InstallationAdvancedSettings;
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

interface InstallationAdvancedSettings {
  outdoorActivationConfirmationSamples: number;
}
```

Home Assistant connection details and credentials are engine-owned infrastructure configuration and never enter deterministic core policy.

All safety values are explicit configuration; the core schema does not silently supply operational defaults. The minimum target must be lower than the maximum. An outgoing target must satisfy both the installation envelope and the controller entity's reported limits; out-of-range targets are rejected and explained rather than silently changed. Stale controller or plant telemetry blocks new automatic heating or cooling commands; missing outdoor-gate evidence follows the explicit fail-open rule in the schedule section. Command spacing applies per controller, although a safety-motivated `off` may bypass the interval and must be logged. A missing command acknowledgement triggers reconciliation rather than blind retries.

Plant-specific active-controller limits, minimum run/rest durations, and source-switch settling remain in `PlantConstraints`. Temperature hysteresis belongs to deterministic demand policy rather than installation safety configuration.

`outdoorActivationConfirmationSamples` is the installation-wide number of consecutive, distinct, fresh current-outdoor-temperature observations required to open or close a configured outdoor gate. It is an advanced deterministic-policy setting rather than a per-schedule tuning value and must be a positive integer. The engine maintains one installation-wide observation buffer so a newly active schedule period can evaluate current evidence immediately.

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

Standard HA modes are discovered from `hvac_modes`: prefer `heat`, `cool`, and `off`. Ambiguous modes such as `auto` or `heat_cool` are not selected automatically. Advanced overrides may resolve unusual integrations. Aether determines and commands each automatically owned controller's HVAC mode. The controller does not choose between heating and cooling; `hvac_action` only reports the resulting physical activity and must not be confused with Aether's configured HVAC mode.

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

Efficiency is modelled at plant level so it can account for outdoor conditions, combined load, active-controller count, capacities, minimum useful load, tariffs, and learned or measured performance. The MVP uses positive fixed performance factors: useful heating or cooling energy delivered per unit of source energy consumed. A later model may add configured curves or learned performance. The orchestrator may coordinate overlapping genuine demand across several controllers when beneficial, but must not claim actual heating or cooling merely to increase plant load. An open schedule-period outdoor gate may place a controller in its scheduled mode and target while the room is within the comfort band; this is a readiness request, and the controller's reported `hvac_action` remains the source of truth for actual equipment activity.

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
  outdoorActivation?: {
    forecastLookaheadHours: number;
    minimumOpenMinutes: number;
    lower?: {
      openAtOrBelowCelsius: number;
      closeAtOrAboveCelsius: number;
    };
    upper?: {
      openAtOrAboveCelsius: number;
      closeAtOrBelowCelsius: number;
    };
  };
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

Both temperature bounds are required in every period, and the minimum must be lower than the maximum. A period describes a comfort range rather than a heating or cooling mode: its minimum is the exact automatic heating target and its maximum is the exact automatic cooling target. Aether does not calculate or substitute automatic target temperatures. Periods use inclusive start and exclusive end minutes in the installation's local day, cannot cross midnight, and cannot overlap. Adjacent periods are allowed. Temperatures are stored in the core's canonical Celsius unit.

Outdoor activation is optional per period and opt-in independently for the lower and upper sides. An omitted side retains normal comfort-band demand behaviour. A configured side adds an outdoor gate:

- An open lower gate requests suitable automatically owned controllers in `heat` mode at the period's exact minimum target, even while the room is currently above that minimum.
- An open upper gate requests suitable automatically owned controllers in `cool` mode at the period's exact maximum target, even while the room is currently below that maximum.
- Aether determines and commands each selected controller's `heat`, `cool`, or `off` mode. The controller does not choose between heating and cooling. Its thermostat may cycle the physical equipment to maintain Aether's exact target, and its reported `hvac_action` records whether that equipment is currently `heating`, `cooling`, or `idle`.
- Lower and upper gates may be open concurrently and are not a conflict by themselves. Heating and cooling controllers may therefore be prepared at opposite bounds of the same valid comfort range. Each controller may still receive only one representable mode, and normal controller capabilities and complete plant constraints—including multi-split mixed-mode restrictions—remain authoritative when forming the control plan.
- Closing a gate withdraws that side's readiness request. Reconciliation turns an automatically owned controller off only when no other active room demand or readiness request still needs it. Manual controllers are unaffected.

For example, with an 18–23 °C period and both gates open, Aether may command a boiler controller to `heat` at 18 °C and a separate AC controller to `cool` at 23 °C. At 17 °C the boiler may report `hvac_action: heating`; after reaching its lower target it may report `idle` while remaining in Aether's commanded `heat` mode. The AC remains in Aether's commanded `cool` mode and may report `hvac_action: cooling` only when cooling is physically active.

For each configured side, current-temperature hysteresis uses its separate open and close threshold. A lower close threshold must be above its open threshold; an upper close threshold must be below its open threshold. Opening or closing from current observations requires `outdoorActivationConfirmationSamples` qualifying consecutive, distinct, fresh observations. A fresh forecast crossing an open threshold within `forecastLookaheadHours` opens that gate immediately without current-sample confirmation. A gate may close only when no qualifying fresh forecast remains and the required current observations satisfy its close threshold.

Missing or stale forecast data is ignored when usable current outdoor data exists. If neither usable current outdoor data nor usable forecast data exists for a configured side, that gate fails open so the climate controller can enforce the schedule's temperature target locally. Returning outdoor data is then evaluated through the normal forecast and current-sample rules rather than causing an unconfirmed close.

`minimumOpenMinutes` is the minimum gate-open duration, not a claim that the equipment's `hvac_action` remained active. A gate may open only when at least that many minutes remain in the current period; adjacent periods are not combined. Once open, its timer is not extended by later qualifying observations. It may not close before that timer expires, except when the current period ends or a safety, manual-ownership, or loss-of-control interlock takes precedence. Period end always withdraws the period's requests. Plant-level minimum on/off constraints remain separate and continue to protect physical equipment.

Open-gate runtime state, including its side, opening reason, `openedAt`, and `minimumOpenUntil`, is persisted and reconciled after an engine restart. A restart must not shorten or restart the minimum-open duration, and stale persisted state from a period that has ended must not reactivate equipment.

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
→ evaluate schedule-period outdoor gates
→ find capable controllers
→ aggregate consequences of shared controllers
→ evaluate complete plant constraints
→ estimate plant cost/efficiency
→ select a control plan
→ executor interlock
→ climate.* commands
→ observe and reconcile
```

Selection must account for comfort, outdoor-gate readiness requests, controller scope, rooms affected, plant availability, existing reservations, efficiency, energy price, hysteresis, and minimum run/rest periods. Normal ungated demand may use room readings and prediction. For a configured open side, Aether determines and commands the HVAC mode from the outdoor-gate request, and the schedule supplies the exact target. Room temperature and prediction do not replace that target; the controller merely reports the resulting physical `hvac_action`. Marginal economic changes must not cause rapid source switching.

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

Indoor prediction remains an input to normal ungated demand and source planning. It does not manufacture a different schedule target and does not override the explicit readiness semantics of an open outdoor gate. Outdoor forecast evaluation for a schedule gate is deterministic policy and is separate from the room-temperature predictor.

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

Command execution is an engine-shell safety setting, distinct from controller Automatic/Manual ownership and Home Assistant HVAC mode:

```ts
type CommandExecutionMode = 'dry_run' | 'live';
```

The engine defaults to `dry_run`; only an explicit exact `live` setting may enable Home Assistant equipment commands. Home Assistant state reading and command execution use separate interfaces, and the live command executor is not instantiated in dry-run mode.

Dry-run mode reads and reconciles real Home Assistant state and runs the complete deterministic planning and safety pipeline. Aether configuration operations, including room schedule selection, still persist normally. Each proposed equipment command is stored as a structured audit record containing its decision/reason, target `climate.*` entity, intended service and payload, affected rooms and plant, and source-observation timestamps. Repeated equivalent intentions may be grouped or rate-limited for diagnostics.

Dry-run mode never sends a Home Assistant service call, creates a synthetic acknowledgement, assumes a proposed command changed equipment state, or presents it as executed. The UI must label these records as “would execute” and show dry-run status prominently.

- Validate every controllable entity ID as `climate.*`.
- Apply target-temperature bounds and reject unsupported modes.
- Enforce plant constraints both during planning and at the execution boundary.
- Use minimum on/off times, hysteresis, and command rate limits.
- Persist decisions, overrides, and command correlation data.
- Persist open outdoor-gate timing so restart reconciliation preserves each unexpired minimum-open duration.
- On startup or HA reconnection, acquire the single-engine lease, read actual states, reconcile manual/conflict status, and only then issue commands.
- Treat unavailable, stale, or inconsistent controller and plant state conservatively; outdoor-gate evidence follows its separately specified fail-open rule.
- Never queue UI control actions while offline or claim they succeeded.
- Manufacturer/native schedules should be disabled where they would fight automatic ownership, or their interference must be detected as external control.

## 9. Explainability and diagnostics

Every automatic decision records:

- room readings, comfort bands, predictions, and confidence;
- outdoor readings and freshness, forecast crossings, confirmation progress, gate state, opening reason, and minimum-open deadline;
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

`apps/web` is the Nuxt 4/Vue 3/TypeScript web shell. It owns configuration, dashboards, diagnostics, and user interaction. It may consume shared core types and explanations, but must not duplicate climate policy or communicate directly with Home Assistant to control equipment. Development retains a separate Nuxt server; production generates a client-side application that the engine serves as static same-origin assets.

```text
Browser
   ↓
generated apps/web assets served by apps/engine
   ↓ same-origin /api
apps/engine ⇄ SQLite / Home Assistant / clock / network
   ↓
packages/core
```

### 10.1 Authentication and transport security

The standalone Unraid deployment delegates user authentication to Home Assistant through its OAuth 2/IndieAuth flow and does not maintain local user passwords. A future Home Assistant add-on may instead use Supervisor Ingress authentication. These modes must remain explicit; standalone deployments must never trust ingress identity headers.

All authenticated Home Assistant users may view Aether, while Home Assistant administrator status is required for configuration or control. The engine keeps Home Assistant access and refresh tokens server-side and gives the browser only an opaque Aether session identifier in a host-only cookie with `HttpOnly`, `SameSite=Lax`, and `Path=/`. The cookie uses `Secure` whenever the public URL is HTTPS. Browser code must not receive or persist Home Assistant tokens. Unsafe API methods require origin validation and CSRF protection in addition to authentication.

Engine authorization and user authorization are separate grants. The engine grant maintains the background Home Assistant connection independently of browser sessions; each normal user grant proves that user's identity and current role. Logging out or revoking a user session must not disconnect the engine. During first-run setup, one verified Home Assistant administrator authorizes the engine grant and receives a local bootstrap session from the same verified identity, avoiding a second immediate login without making that session the owner of the engine credential. Later sign-ins and engine reconnection use distinct OAuth transactions.

OAuth transactions are single-use and expire ten minutes after creation. The resulting engine grant has no Aether-imposed expiry and remains usable while Home Assistant accepts its refresh token. Aether browser sessions expire after seven days without authenticated activity and always expire thirty days after creation. If authorization fails after a refresh token is issued, or a successful authorization replaces an existing grant, the engine immediately attempts to revoke the obsolete refresh token. Revocation is best-effort: failures produce a sanitized warning and must not expose credentials, discard a successfully stored replacement grant, or interrupt climate orchestration. The MVP does not persist revocation retries. A future hardening step may add an encrypted SQLite-backed revocation queue with delayed retries, startup recovery, and diagnostics after the engine background-task lifecycle exists.

The single Home Assistant instance origin is entered during onboarding and persisted in SQLite. Server-side token bundles are encrypted with versioned authenticated encryption using Node's built-in cryptography and a generated owner-readable key at `/config/aether-auth.key`. Raw session tokens, CSRF tokens, OAuth state, and OAuth browser-binding secrets are never persisted; only their cryptographic hashes are stored. The entire `/config` directory remains the required backup boundary.

`AETHER_PUBLIC_URL` is the canonical externally visible origin used for OAuth callbacks, redirects, cookie security, and origin validation. It must be an absolute HTTP(S) origin without a path, query, or fragment, for example `https://aether.example.com`. The engine must not derive this security-sensitive value from forwarded headers. A reverse proxy may terminate HTTPS and communicate with the container over its private HTTP port.

HTTPS is required by default. The exact opt-in `AETHER_ALLOW_INSECURE_HTTP=true` permits an `http://` public URL for local development or a trusted private network. In that mode the session cookie remains `HttpOnly` and `SameSite=Lax` but cannot use `Secure`, and the engine must emit a prominent warning. Insecure mode must never be silently enabled or presented as suitable for internet exposure. Missing, malformed, or insecure public URLs without the opt-in must fail fast once authentication is enabled.

Once authentication is implemented, only a dedicated health endpoint and the endpoints required to complete OAuth are unauthenticated. The installation and control APIs require an authenticated session. The Docker health check must use the dedicated health endpoint rather than an authenticated application endpoint.

The standalone HTTP authentication contract is:

- `GET /api/v1/health` is the unauthenticated Docker and Unraid health endpoint.
- `GET /api/v1/auth/status` is unauthenticated and reports only whether initial setup is required, the browser is unauthenticated, or the browser has an authenticated session with its display name and authorization flags.
- `POST /api/v1/auth/engine/setup` is available only before the Home Assistant engine connection is complete. It requires the current initial-setup code, Home Assistant origin, and a safe application-relative return path.
- `POST /api/v1/auth/login` starts a normal user authorization only after engine setup is complete.
- `POST /api/v1/auth/engine/reconnect` requires an authenticated Home Assistant administrator session.
- `GET /api/v1/auth/callback` completes the bound single-use OAuth transaction.
- `POST /api/v1/auth/logout` requires the current session and its CSRF token.

OAuth-start endpoints accept size-limited JSON and return an authorization URL for the generated web app to navigate to. Every unsafe HTTP method requires an `Origin` header that exactly matches `AETHER_PUBLIC_URL`; authenticated unsafe requests additionally require the readable CSRF cookie value in the request header. Successful callbacks redirect to the transaction's stored safe return path. Failed callbacks clear the browser-binding cookie and redirect to `/auth/error` with only a stable, non-sensitive error code. Authentication responses are not cacheable. Generated frontend assets remain public so the setup and login interface can load, while `GET /api/v1/installation/overview` and other application APIs require an authenticated session.

To prevent first-visitor takeover, an unconfigured engine generates a cryptographically random initial-setup code in process memory and writes it once to the container log. Starting engine setup requires that code, and comparisons must not disclose it through timing or diagnostics. If the process restarts while setup is still incomplete, the previous code becomes invalid and a new code is generated and logged. Once the persisted Home Assistant engine connection is complete, restarts must not generate or log a setup code, and the initial setup endpoint remains disabled. The code is never persisted and no setup code is needed for later engine reconnection.

SQLite with Drizzle stores configuration, schedules, learned data, runtime ownership, and audit history at `/config/aether.sqlite`. Only the engine opens the database. Schema migrations run before the engine begins serving requests, and the complete `/config` directory is the persistent backup boundary.

Initial persistence uses the explicitly approved Drizzle ORM release candidate with Node's built-in `node:sqlite` adapter. This avoids a third-party native addon and its cross-platform Docker compilation toolchain. Pin the exact approved release-candidate version, do not use commit-specific snapshots, and move to stable Drizzle and `node:sqlite` releases once both are available in the supported Node LTS and the persistence tests pass unchanged. The database remains standard SQLite, so this dependency upgrade must not require a new storage format.

Production is one non-privileged container, one engine process, one HTTP port, and one `/config` mount. A multi-stage build compiles the core and engine, generates the Nuxt client application, and copies only their production output into the final image. Server-side rendering is not part of the production deployment; this does not make application data static.

Unraid Community Applications is the primary distribution target. Aether publishes one container image and one template so it appears as one installable app and one Docker tile. The template exposes the web port and maps `/mnt/user/appdata/aether` to `/config`; Home Assistant remains external. Docker Compose may be used for local development or verification but is not required to run Aether.

The generated web app communicates with the engine through its same-origin HTTP API; polling is sufficient initially, with SSE/WebSockets optional later. Frontend routes fall back to the generated `index.html`, while `/api/*` is reserved exclusively for engine routes. Do not add Redis, RabbitMQ, MQTT, Nx, or Turborepo without a demonstrated requirement.

The initial read-only contract is `GET /api/v1/installation/overview`. It returns HTTP 200 with either `not_configured`, or `configured` plus installation identity, entity counts, and topology validity/error/warning counts. An invalid configured topology remains visible for diagnosis but cannot be used for control. This configuration overview has no timestamp; later live-state contracts expose explicit observation timestamps rather than implying freshness from response time.

A future Home Assistant simulator is development infrastructure outside the production engine. It runs as a separate process and mimics only the Home Assistant API surface Aether actually uses, allowing the normal state reader and live command executor to be tested against deterministic states, acknowledgements, delays, failures, and external changes. It is deferred until the real Home Assistant dry-run integration establishes that required API surface.

Delivery proceeds in this order:

1. record and verify the single-container build boundary;
2. add SQLite migrations and installation persistence;
3. add Home Assistant connection, OAuth-credential, user, session, and transaction persistence;
4. implement Home Assistant OAuth, engine authorization, user sessions, and API protection;
5. expose protected database-backed engine state in the generated web app;
6. persist the unified entity hierarchy, beginning with Energy Sources and Plants;
7. integrate read-only Home Assistant state, entity discovery, and configuration;
8. implement control planning in independently tested core slices;
9. add dry-run evaluation and command-intention audit records;
10. add the external Home Assistant simulator;
11. add live command execution only after separate approval; and
12. publish the image and submit the Community Applications template.

Tooling: Vite, ESLint, Prettier, Knip, Vitest, Playwright, and Zod 4. Unit tests must heavily cover demand, schedules, outdoor-gate opt-in and hysteresis, forecast and missing-data behaviour, concurrent lower/upper gates, restart persistence, schedule-boundary timing, many-to-many topology, shared-controller aggregation, plant constraints, manual reservations, interlocks, source switching, and DST behaviour. A small end-to-end suite covers setup and critical control journeys.

## 11. User interface conventions

The UI is room- and decision-first; equipment topology belongs in System/Settings. It is mobile-first, responsive, installable as a PWA, and supports light, dark, and system themes. First-party colour tokens use OKLCH.

Use Tailwind CSS and DaisyUI. Use TanStack Query for server state; do not duplicate it in Pinia. Use Google Material Symbols imported as SVG Vue components for first-party UI and a dedicated dynamic MDI renderer only for HA-supplied `mdi:*` icons.

Keep Vue components flat and descriptively named. Use `App*`, `Field*`, `Overlay*`, `View*`, `Layout*`, `Nav*`, `Chart*`, `Status*`, and `Form*` only where their roles apply. Components should encapsulate behaviour, domain meaning, validation, or substantial reusable UI—not merely wrap HTML or DaisyUI classes.

Offline screens may show clearly labelled cached data with a last-updated time. Mutating controls are disabled when the engine or HA cannot be reached.

## 12. Non-goals for the MVP

- Direct control of switches, valves, relays, TRVs, MQTT devices, or vendor-specific services.
- Independent per-room boiler emission control when only one shared thermostat exists.
- Exact physical building simulation or guaranteed COP estimates.
- Claiming or creating actual HVAC activity in comfortable rooms solely to optimise plant loading; schedule-period outdoor readiness may still cause Aether to command an automatic controller's mode and exact boundary target while the controller reports `hvac_action: idle`.
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

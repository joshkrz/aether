import { sql } from 'drizzle-orm';
import {
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const installationTable = sqliteTable('installation', {
  singletonKey: integer('singleton_key').primaryKey(),
  id: text('id').notNull().unique(),
  name: text('name').notNull(),
  timeZone: text('time_zone').notNull(),
  displayTemperatureUnit: text('display_temperature_unit', {
    enum: ['celsius', 'fahrenheit'],
  }).notNull(),
  revision: integer('revision').notNull().default(0),
  minimumTargetTemperatureCelsius: real('minimum_target_temperature_celsius').notNull(),
  maximumTargetTemperatureCelsius: real('maximum_target_temperature_celsius').notNull(),
  maximumTelemetryAgeSeconds: real('maximum_telemetry_age_seconds').notNull(),
  minimumCommandIntervalSeconds: real('minimum_command_interval_seconds').notNull(),
  commandAcknowledgementTimeoutSeconds: real('command_acknowledgement_timeout_seconds').notNull(),
});

export const installationEnergySourceTable = sqliteTable('installation_energy_source', {
  id: text('id').primaryKey(),
  installationSingletonKey: integer('installation_singleton_key')
    .notNull()
    .default(1)
    .references(() => installationTable.singletonKey, { onDelete: 'cascade' }),
  position: integer('position').notNull().unique(),
  name: text('name').notNull(),
  type: text('type', { enum: ['electricity', 'gas', 'other'] }).notNull(),
  tariffEntityId: text('tariff_entity_id'),
  emissionsEntityId: text('emissions_entity_id'),
  fixedUnitCost: real('fixed_unit_cost'),
});

export const installationPlantTable = sqliteTable('installation_plant', {
  id: text('id').primaryKey(),
  installationSingletonKey: integer('installation_singleton_key')
    .notNull()
    .default(1)
    .references(() => installationTable.singletonKey, { onDelete: 'cascade' }),
  position: integer('position').notNull().unique(),
  name: text('name').notNull(),
  type: text('type', { enum: ['boiler', 'heat_pump', 'hvac', 'other'] }).notNull(),
  energySourceId: text('energy_source_id'),
  constraintsJson: text('constraints_json'),
  efficiencyModelJson: text('efficiency_model_json'),
});

export const installationZoneTable = sqliteTable('installation_zone', {
  id: text('id').primaryKey(),
  installationSingletonKey: integer('installation_singleton_key')
    .notNull()
    .default(1)
    .references(() => installationTable.singletonKey, { onDelete: 'cascade' }),
  position: integer('position').notNull().unique(),
  name: text('name').notNull(),
});

export const installationRoomTable = sqliteTable('installation_room', {
  id: text('id').primaryKey(),
  installationSingletonKey: integer('installation_singleton_key')
    .notNull()
    .default(1)
    .references(() => installationTable.singletonKey, { onDelete: 'cascade' }),
  position: integer('position').notNull().unique(),
  name: text('name').notNull(),
  zoneId: text('zone_id'),
  temperatureEntityId: text('temperature_entity_id'),
  humidityEntityId: text('humidity_entity_id'),
  windowOrDoorEntityIdsJson: text('window_or_door_entity_ids_json'),
  windowsJson: text('windows_json'),
});

export const installationClimateControllerTable = sqliteTable('installation_climate_controller', {
  id: text('id').primaryKey(),
  installationSingletonKey: integer('installation_singleton_key')
    .notNull()
    .default(1)
    .references(() => installationTable.singletonKey, { onDelete: 'cascade' }),
  position: integer('position').notNull().unique(),
  name: text('name').notNull(),
  entityId: text('entity_id').notNull().unique(),
  locationType: text('location_type', { enum: ['room', 'zone'] }).notNull(),
  roomId: text('room_id'),
  zoneId: text('zone_id'),
  plantId: text('plant_id').notNull(),
  capabilitiesJson: text('capabilities_json').notNull(),
  controlProfileJson: text('control_profile_json').notNull(),
  manualOverridePolicyJson: text('manual_override_policy_json').notNull(),
});

export const installationScheduleTable = sqliteTable('installation_schedule', {
  id: text('id').primaryKey(),
  installationSingletonKey: integer('installation_singleton_key')
    .notNull()
    .default(1)
    .references(() => installationTable.singletonKey, { onDelete: 'cascade' }),
  position: integer('position').notNull().unique(),
  name: text('name').notNull(),
});

export const installationScheduleBlockTable = sqliteTable(
  'installation_schedule_block',
  {
    scheduleId: text('schedule_id')
      .notNull()
      .references(() => installationScheduleTable.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    day: text('day', {
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    }).notNull(),
    position: integer('position').notNull(),
    locationType: text('location_type', { enum: ['room', 'zone'] }).notNull(),
    roomId: text('room_id'),
    zoneId: text('zone_id'),
    controllerId: text('controller_id').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
    settingsJson: text('settings_json').notNull(),
  },
  (table) => [primaryKey({ columns: [table.scheduleId, table.id] })],
);

export const installationScheduleSelectionTable = sqliteTable('installation_schedule_selection', {
  singletonKey: integer('singleton_key')
    .primaryKey()
    .references(() => installationTable.singletonKey, { onDelete: 'cascade' }),
  mainScheduleId: text('main_schedule_id'),
  overrideScheduleId: text('override_schedule_id'),
});

export const homeAssistantConnectionTable = sqliteTable('home_assistant_connection', {
  singletonKey: integer('singleton_key').primaryKey(),
  origin: text('origin').notNull(),
  createdAtEpochSeconds: integer('created_at_epoch_seconds').notNull(),
  updatedAtEpochSeconds: integer('updated_at_epoch_seconds').notNull(),
  connectedAtEpochSeconds: integer('connected_at_epoch_seconds'),
});

export const homeAssistantUserTable = sqliteTable('home_assistant_user', {
  id: text('id').primaryKey(),
  connectionSingletonKey: integer('connection_singleton_key')
    .notNull()
    .references(() => homeAssistantConnectionTable.singletonKey, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
  displayName: text('display_name').notNull(),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull(),
  isOwner: integer('is_owner', { mode: 'boolean' }).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull(),
  verifiedAtEpochSeconds: integer('verified_at_epoch_seconds').notNull(),
});

export const homeAssistantOauthCredentialTable = sqliteTable(
  'home_assistant_oauth_credential',
  {
    id: text('id').primaryKey(),
    connectionSingletonKey: integer('connection_singleton_key')
      .notNull()
      .references(() => homeAssistantConnectionTable.singletonKey, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    homeAssistantUserId: text('home_assistant_user_id')
      .notNull()
      .references(() => homeAssistantUserTable.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    purpose: text('purpose', { enum: ['engine', 'user'] }).notNull(),
    tokenEncryptionVersion: integer('token_encryption_version').notNull(),
    encryptedTokenBundle: blob('encrypted_token_bundle', { mode: 'buffer' }).notNull(),
    accessTokenExpiresAtEpochSeconds: integer('access_token_expires_at_epoch_seconds').notNull(),
    createdAtEpochSeconds: integer('created_at_epoch_seconds').notNull(),
    updatedAtEpochSeconds: integer('updated_at_epoch_seconds').notNull(),
    revokedAtEpochSeconds: integer('revoked_at_epoch_seconds'),
  },
  (table) => [
    uniqueIndex('home_assistant_oauth_credential_active_engine_unique')
      .on(table.connectionSingletonKey)
      .where(sql`${table.purpose} = 'engine' AND ${table.revokedAtEpochSeconds} IS NULL`),
    uniqueIndex('home_assistant_oauth_credential_active_user_unique')
      .on(table.homeAssistantUserId)
      .where(sql`${table.purpose} = 'user' AND ${table.revokedAtEpochSeconds} IS NULL`),
  ],
);

export const authenticationSessionTable = sqliteTable(
  'authentication_session',
  {
    tokenHash: text('token_hash').primaryKey(),
    csrfTokenHash: text('csrf_token_hash').notNull(),
    homeAssistantUserId: text('home_assistant_user_id')
      .notNull()
      .references(() => homeAssistantUserTable.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    oauthCredentialId: text('oauth_credential_id').references(
      () => homeAssistantOauthCredentialTable.id,
      {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      },
    ),
    createdAtEpochSeconds: integer('created_at_epoch_seconds').notNull(),
    lastUsedAtEpochSeconds: integer('last_used_at_epoch_seconds').notNull(),
    expiresAtEpochSeconds: integer('expires_at_epoch_seconds').notNull(),
    revokedAtEpochSeconds: integer('revoked_at_epoch_seconds'),
  },
  (table) => [index('authentication_session_expires_at_index').on(table.expiresAtEpochSeconds)],
);

export const oauthTransactionTable = sqliteTable(
  'oauth_transaction',
  {
    stateHash: text('state_hash').primaryKey(),
    browserBindingHash: text('browser_binding_hash').notNull(),
    connectionSingletonKey: integer('connection_singleton_key')
      .notNull()
      .references(() => homeAssistantConnectionTable.singletonKey, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    purpose: text('purpose', {
      enum: ['engine_setup', 'engine_reconnect', 'user_login'],
    }).notNull(),
    returnPath: text('return_path').notNull(),
    createdAtEpochSeconds: integer('created_at_epoch_seconds').notNull(),
    expiresAtEpochSeconds: integer('expires_at_epoch_seconds').notNull(),
    consumedAtEpochSeconds: integer('consumed_at_epoch_seconds'),
  },
  (table) => [index('oauth_transaction_expires_at_index').on(table.expiresAtEpochSeconds)],
);

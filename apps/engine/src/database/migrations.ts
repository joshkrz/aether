export type DatabaseMigration = {
  id: string;
  sql: string;
};

export const databaseMigrations = [
  {
    id: '0001Installation',
    sql: `
      CREATE TABLE installation (
        singleton_key INTEGER PRIMARY KEY NOT NULL CHECK (singleton_key = 1),
        id TEXT NOT NULL UNIQUE CHECK (length(trim(id)) > 0),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        time_zone TEXT NOT NULL CHECK (length(trim(time_zone)) > 0),
        display_temperature_unit TEXT NOT NULL
          CHECK (display_temperature_unit IN ('celsius', 'fahrenheit')),
        minimum_target_temperature_celsius REAL NOT NULL,
        maximum_target_temperature_celsius REAL NOT NULL,
        maximum_telemetry_age_seconds REAL NOT NULL
          CHECK (maximum_telemetry_age_seconds > 0),
        minimum_command_interval_seconds REAL NOT NULL
          CHECK (minimum_command_interval_seconds > 0),
        command_acknowledgement_timeout_seconds REAL NOT NULL
          CHECK (command_acknowledgement_timeout_seconds > 0),
        CHECK (minimum_target_temperature_celsius < maximum_target_temperature_celsius)
      ) STRICT;
    `,
  },
  {
    id: '0002HomeAssistantAuthentication',
    sql: `
      CREATE TABLE home_assistant_connection (
        singleton_key INTEGER PRIMARY KEY NOT NULL CHECK (singleton_key = 1),
        origin TEXT NOT NULL CHECK (length(trim(origin)) > 0),
        created_at_epoch_seconds INTEGER NOT NULL CHECK (created_at_epoch_seconds >= 0),
        updated_at_epoch_seconds INTEGER NOT NULL
          CHECK (updated_at_epoch_seconds >= created_at_epoch_seconds),
        connected_at_epoch_seconds INTEGER
          CHECK (
            connected_at_epoch_seconds IS NULL
            OR connected_at_epoch_seconds >= created_at_epoch_seconds
          )
      ) STRICT;

      CREATE TABLE home_assistant_user (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
        connection_singleton_key INTEGER NOT NULL,
        display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
        is_admin INTEGER NOT NULL CHECK (is_admin IN (0, 1)),
        is_owner INTEGER NOT NULL CHECK (is_owner IN (0, 1)),
        is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
        verified_at_epoch_seconds INTEGER NOT NULL CHECK (verified_at_epoch_seconds >= 0),
        CHECK (is_owner = 0 OR is_admin = 1),
        FOREIGN KEY (connection_singleton_key)
          REFERENCES home_assistant_connection(singleton_key)
          ON UPDATE CASCADE
          ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE home_assistant_oauth_credential (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
        connection_singleton_key INTEGER NOT NULL,
        home_assistant_user_id TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose IN ('engine', 'user')),
        token_encryption_version INTEGER NOT NULL CHECK (token_encryption_version > 0),
        encrypted_token_bundle BLOB NOT NULL CHECK (length(encrypted_token_bundle) > 0),
        access_token_expires_at_epoch_seconds INTEGER NOT NULL,
        created_at_epoch_seconds INTEGER NOT NULL CHECK (created_at_epoch_seconds >= 0),
        updated_at_epoch_seconds INTEGER NOT NULL
          CHECK (updated_at_epoch_seconds >= created_at_epoch_seconds),
        revoked_at_epoch_seconds INTEGER
          CHECK (
            revoked_at_epoch_seconds IS NULL
            OR revoked_at_epoch_seconds >= created_at_epoch_seconds
          ),
        CHECK (access_token_expires_at_epoch_seconds > created_at_epoch_seconds),
        FOREIGN KEY (connection_singleton_key)
          REFERENCES home_assistant_connection(singleton_key)
          ON UPDATE CASCADE
          ON DELETE CASCADE,
        FOREIGN KEY (home_assistant_user_id)
          REFERENCES home_assistant_user(id)
          ON UPDATE CASCADE
          ON DELETE CASCADE
      ) STRICT;

      CREATE UNIQUE INDEX home_assistant_oauth_credential_active_engine_unique
        ON home_assistant_oauth_credential(connection_singleton_key)
        WHERE purpose = 'engine' AND revoked_at_epoch_seconds IS NULL;

      CREATE UNIQUE INDEX home_assistant_oauth_credential_active_user_unique
        ON home_assistant_oauth_credential(home_assistant_user_id)
        WHERE purpose = 'user' AND revoked_at_epoch_seconds IS NULL;

      CREATE TABLE authentication_session (
        token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64),
        csrf_token_hash TEXT NOT NULL CHECK (length(csrf_token_hash) = 64),
        home_assistant_user_id TEXT NOT NULL,
        oauth_credential_id TEXT,
        created_at_epoch_seconds INTEGER NOT NULL CHECK (created_at_epoch_seconds >= 0),
        last_used_at_epoch_seconds INTEGER NOT NULL,
        expires_at_epoch_seconds INTEGER NOT NULL,
        revoked_at_epoch_seconds INTEGER,
        CHECK (last_used_at_epoch_seconds >= created_at_epoch_seconds),
        CHECK (expires_at_epoch_seconds > created_at_epoch_seconds),
        CHECK (last_used_at_epoch_seconds <= expires_at_epoch_seconds),
        CHECK (
          revoked_at_epoch_seconds IS NULL
          OR revoked_at_epoch_seconds >= created_at_epoch_seconds
        ),
        FOREIGN KEY (home_assistant_user_id)
          REFERENCES home_assistant_user(id)
          ON UPDATE CASCADE
          ON DELETE CASCADE,
        FOREIGN KEY (oauth_credential_id)
          REFERENCES home_assistant_oauth_credential(id)
          ON UPDATE CASCADE
          ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX authentication_session_expires_at_index
        ON authentication_session(expires_at_epoch_seconds);

      CREATE TABLE oauth_transaction (
        state_hash TEXT PRIMARY KEY NOT NULL CHECK (length(state_hash) = 64),
        browser_binding_hash TEXT NOT NULL CHECK (length(browser_binding_hash) = 64),
        connection_singleton_key INTEGER NOT NULL,
        purpose TEXT NOT NULL
          CHECK (purpose IN ('engine_setup', 'engine_reconnect', 'user_login')),
        return_path TEXT NOT NULL
          CHECK (
            substr(return_path, 1, 1) = '/'
            AND substr(return_path, 1, 2) <> '//'
          ),
        created_at_epoch_seconds INTEGER NOT NULL CHECK (created_at_epoch_seconds >= 0),
        expires_at_epoch_seconds INTEGER NOT NULL,
        consumed_at_epoch_seconds INTEGER,
        CHECK (expires_at_epoch_seconds > created_at_epoch_seconds),
        CHECK (
          consumed_at_epoch_seconds IS NULL
          OR consumed_at_epoch_seconds >= created_at_epoch_seconds
        ),
        FOREIGN KEY (connection_singleton_key)
          REFERENCES home_assistant_connection(singleton_key)
          ON UPDATE CASCADE
          ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX oauth_transaction_expires_at_index
        ON oauth_transaction(expires_at_epoch_seconds);
    `,
  },
  {
    id: '0003InstallationConfiguration',
    sql: `
      CREATE TABLE installation_energy_source (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
        installation_singleton_key INTEGER NOT NULL DEFAULT 1 CHECK (installation_singleton_key = 1),
        position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        type TEXT NOT NULL CHECK (type IN ('electricity', 'gas', 'other')),
        tariff_entity_id TEXT,
        emissions_entity_id TEXT,
        fixed_unit_cost REAL CHECK (fixed_unit_cost IS NULL OR fixed_unit_cost >= 0),
        FOREIGN KEY (installation_singleton_key) REFERENCES installation(singleton_key) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE installation_plant (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
        installation_singleton_key INTEGER NOT NULL DEFAULT 1 CHECK (installation_singleton_key = 1),
        position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        type TEXT NOT NULL CHECK (type IN ('boiler', 'heat_pump', 'hvac', 'other')),
        energy_source_id TEXT,
        constraints_json TEXT CHECK (constraints_json IS NULL OR json_valid(constraints_json)),
        efficiency_model_json TEXT CHECK (efficiency_model_json IS NULL OR json_valid(efficiency_model_json)),
        FOREIGN KEY (installation_singleton_key) REFERENCES installation(singleton_key) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE installation_zone (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
        installation_singleton_key INTEGER NOT NULL DEFAULT 1 CHECK (installation_singleton_key = 1),
        position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        FOREIGN KEY (installation_singleton_key) REFERENCES installation(singleton_key) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE installation_room (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
        installation_singleton_key INTEGER NOT NULL DEFAULT 1 CHECK (installation_singleton_key = 1),
        position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        zone_id TEXT,
        temperature_entity_id TEXT,
        humidity_entity_id TEXT,
        window_or_door_entity_ids_json TEXT
          CHECK (window_or_door_entity_ids_json IS NULL OR json_valid(window_or_door_entity_ids_json)),
        windows_json TEXT CHECK (windows_json IS NULL OR json_valid(windows_json)),
        FOREIGN KEY (installation_singleton_key) REFERENCES installation(singleton_key) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE installation_climate_controller (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
        installation_singleton_key INTEGER NOT NULL DEFAULT 1 CHECK (installation_singleton_key = 1),
        position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        entity_id TEXT NOT NULL UNIQUE CHECK (substr(entity_id, 1, 8) = 'climate.'),
        location_type TEXT NOT NULL CHECK (location_type IN ('room', 'zone')),
        room_id TEXT,
        zone_id TEXT,
        plant_id TEXT NOT NULL CHECK (length(trim(plant_id)) > 0),
        capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
        control_profile_json TEXT NOT NULL CHECK (json_valid(control_profile_json)),
        manual_override_policy_json TEXT NOT NULL CHECK (json_valid(manual_override_policy_json)),
        CHECK (
          (location_type = 'room' AND room_id IS NOT NULL AND zone_id IS NULL)
          OR (location_type = 'zone' AND zone_id IS NOT NULL AND room_id IS NULL)
        ),
        FOREIGN KEY (installation_singleton_key) REFERENCES installation(singleton_key) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE installation_schedule (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
        installation_singleton_key INTEGER NOT NULL DEFAULT 1 CHECK (installation_singleton_key = 1),
        position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        FOREIGN KEY (installation_singleton_key) REFERENCES installation(singleton_key) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE installation_schedule_block (
        schedule_id TEXT NOT NULL,
        id TEXT NOT NULL CHECK (length(trim(id)) > 0),
        day TEXT NOT NULL CHECK (
          day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
        ),
        position INTEGER NOT NULL CHECK (position >= 0),
        location_type TEXT NOT NULL CHECK (location_type IN ('room', 'zone')),
        room_id TEXT,
        zone_id TEXT,
        controller_id TEXT NOT NULL CHECK (length(trim(controller_id)) > 0),
        start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
        end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
        settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
        PRIMARY KEY (schedule_id, id),
        UNIQUE (schedule_id, day, position),
        CHECK (start_minute < end_minute),
        CHECK (
          (location_type = 'room' AND room_id IS NOT NULL AND zone_id IS NULL)
          OR (location_type = 'zone' AND zone_id IS NOT NULL AND room_id IS NULL)
        ),
        FOREIGN KEY (schedule_id) REFERENCES installation_schedule(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE installation_schedule_selection (
        singleton_key INTEGER PRIMARY KEY NOT NULL CHECK (singleton_key = 1),
        main_schedule_id TEXT,
        override_schedule_id TEXT,
        FOREIGN KEY (singleton_key) REFERENCES installation(singleton_key) ON DELETE CASCADE
      ) STRICT;
    `,
  },
  {
    id: '0004InstallationRevision',
    sql: `
      ALTER TABLE installation
        ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
    `,
  },
] satisfies DatabaseMigration[];

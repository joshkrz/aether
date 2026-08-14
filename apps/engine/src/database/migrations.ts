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
] satisfies DatabaseMigration[];

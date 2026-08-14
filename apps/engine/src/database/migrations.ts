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
] satisfies DatabaseMigration[];

import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const installationTable = sqliteTable('installation', {
  singletonKey: integer('singleton_key').primaryKey(),
  id: text('id').notNull().unique(),
  name: text('name').notNull(),
  timeZone: text('time_zone').notNull(),
  displayTemperatureUnit: text('display_temperature_unit', {
    enum: ['celsius', 'fahrenheit'],
  }).notNull(),
  minimumTargetTemperatureCelsius: real('minimum_target_temperature_celsius').notNull(),
  maximumTargetTemperatureCelsius: real('maximum_target_temperature_celsius').notNull(),
  maximumTelemetryAgeSeconds: real('maximum_telemetry_age_seconds').notNull(),
  minimumCommandIntervalSeconds: real('minimum_command_interval_seconds').notNull(),
  commandAcknowledgementTimeoutSeconds: real('command_acknowledgement_timeout_seconds').notNull(),
});

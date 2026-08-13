import * as z from 'zod';

export const InstallationSafetySettingsSchema = z
  .strictObject({
    minimumTargetTemperatureCelsius: z.number(),
    maximumTargetTemperatureCelsius: z.number(),
    maximumTelemetryAgeSeconds: z.number().positive(),
    minimumCommandIntervalSeconds: z.number().positive(),
    commandAcknowledgementTimeoutSeconds: z.number().positive(),
  })
  .refine(
    ({ minimumTargetTemperatureCelsius, maximumTargetTemperatureCelsius }) =>
      minimumTargetTemperatureCelsius < maximumTargetTemperatureCelsius,
    {
      message: 'Maximum target temperature must be greater than minimum target temperature',
      path: ['maximumTargetTemperatureCelsius'],
    },
  );

export type InstallationSafetySettings = z.infer<typeof InstallationSafetySettingsSchema>;

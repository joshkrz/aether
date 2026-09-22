import type { Installation } from './Installation.js';

export type TopologyIssueSeverity = 'error' | 'warning';

export type TopologyIssueCode =
  | 'duplicate_entity_id'
  | 'duplicate_controller_entity_id'
  | 'missing_zone_reference'
  | 'missing_room_reference'
  | 'missing_controller_reference'
  | 'missing_plant_reference'
  | 'missing_energy_source_reference'
  | 'missing_schedule_reference'
  | 'duplicate_schedule_block_id'
  | 'schedule_block_location_mismatch'
  | 'unsupported_controller_mode'
  | 'redundant_schedule_override';

export type TopologyIssue = {
  severity: TopologyIssueSeverity;
  code: TopologyIssueCode;
  path: Array<string | number>;
  message: string;
};

export type TopologyValidationResult = {
  valid: boolean;
  issues: TopologyIssue[];
};

type CollectionName =
  'zones' | 'rooms' | 'climateControllers' | 'plants' | 'energySources' | 'schedules';

const addDuplicateIdIssues = (
  entries: ReadonlyArray<{ id: string }>,
  collectionName: CollectionName,
  issues: TopologyIssue[],
): void => {
  const seenIds = new Set<string>();

  entries.forEach((entry, index) => {
    if (seenIds.has(entry.id)) {
      issues.push({
        severity: 'error',
        code: 'duplicate_entity_id',
        path: [collectionName, index, 'id'],
        message: `Duplicate ${collectionName} ID: ${entry.id}`,
      });
    }

    seenIds.add(entry.id);
  });
};

export const validateInstallationTopology = (
  installation: Installation,
): TopologyValidationResult => {
  const issues: TopologyIssue[] = [];

  addDuplicateIdIssues(installation.zones, 'zones', issues);
  addDuplicateIdIssues(installation.rooms, 'rooms', issues);
  addDuplicateIdIssues(installation.climateControllers, 'climateControllers', issues);
  addDuplicateIdIssues(installation.plants, 'plants', issues);
  addDuplicateIdIssues(installation.energySources, 'energySources', issues);
  addDuplicateIdIssues(installation.schedules, 'schedules', issues);

  const zoneIds = new Set(installation.zones.map(({ id }) => id));
  const roomIds = new Set(installation.rooms.map(({ id }) => id));
  const controllerById = new Map(
    installation.climateControllers.map((controller) => [controller.id, controller]),
  );
  const plantById = new Map(installation.plants.map((plant) => [plant.id, plant]));
  const energySourceIds = new Set(installation.energySources.map(({ id }) => id));
  const scheduleIds = new Set(installation.schedules.map(({ id }) => id));

  const seenControllerEntityIds = new Set<string>();

  installation.rooms.forEach((room, index) => {
    if (room.zoneId !== undefined && !zoneIds.has(room.zoneId)) {
      issues.push({
        severity: 'error',
        code: 'missing_zone_reference',
        path: ['rooms', index, 'zoneId'],
        message: `Room references a missing zone: ${room.zoneId}`,
      });
    }
  });

  installation.climateControllers.forEach((controller, index) => {
    if (seenControllerEntityIds.has(controller.entityId)) {
      issues.push({
        severity: 'error',
        code: 'duplicate_controller_entity_id',
        path: ['climateControllers', index, 'entityId'],
        message: `Home Assistant climate entity is used by more than one controller: ${controller.entityId}`,
      });
    }

    seenControllerEntityIds.add(controller.entityId);

    if (controller.location.type === 'room' && !roomIds.has(controller.location.roomId)) {
      issues.push({
        severity: 'error',
        code: 'missing_room_reference',
        path: ['climateControllers', index, 'location', 'roomId'],
        message: `Controller references a missing room: ${controller.location.roomId}`,
      });
    }

    if (controller.location.type === 'zone' && !zoneIds.has(controller.location.zoneId)) {
      issues.push({
        severity: 'error',
        code: 'missing_zone_reference',
        path: ['climateControllers', index, 'location', 'zoneId'],
        message: `Controller references a missing zone: ${controller.location.zoneId}`,
      });
    }

    const plant = plantById.get(controller.plantId);

    if (plant === undefined) {
      issues.push({
        severity: 'error',
        code: 'missing_plant_reference',
        path: ['climateControllers', index, 'plantId'],
        message: `Controller references a missing plant: ${controller.plantId}`,
      });
    } else if (plant.constraints !== undefined) {
      if (controller.capabilities.heat && !plant.constraints.supportedModes.includes('heat')) {
        issues.push({
          severity: 'error',
          code: 'unsupported_controller_mode',
          path: ['climateControllers', index, 'capabilities', 'heat'],
          message: `Controller supports heating but plant ${plant.id} does not`,
        });
      }

      if (controller.capabilities.cool && !plant.constraints.supportedModes.includes('cool')) {
        issues.push({
          severity: 'error',
          code: 'unsupported_controller_mode',
          path: ['climateControllers', index, 'capabilities', 'cool'],
          message: `Controller supports cooling but plant ${plant.id} does not`,
        });
      }
    }
  });

  installation.plants.forEach((plant, index) => {
    if (plant.energySourceId !== undefined && !energySourceIds.has(plant.energySourceId)) {
      issues.push({
        severity: 'error',
        code: 'missing_energy_source_reference',
        path: ['plants', index, 'energySourceId'],
        message: `Plant references a missing energy source: ${plant.energySourceId}`,
      });
    }
  });

  installation.schedules.forEach((schedule, scheduleIndex) => {
    const seenBlockIds = new Set<string>();

    Object.entries(schedule.days).forEach(([day, blocks]) => {
      blocks.forEach((block, blockIndex) => {
        const path = ['schedules', scheduleIndex, 'days', day, blockIndex];

        if (seenBlockIds.has(block.id)) {
          issues.push({
            severity: 'error',
            code: 'duplicate_schedule_block_id',
            path: [...path, 'id'],
            message: `Schedule ${schedule.id} repeats block ID: ${block.id}`,
          });
        }
        seenBlockIds.add(block.id);

        if (block.location.type === 'room' && !roomIds.has(block.location.roomId)) {
          issues.push({
            severity: 'error',
            code: 'missing_room_reference',
            path: [...path, 'location', 'roomId'],
            message: `Schedule block references a missing room: ${block.location.roomId}`,
          });
        }

        if (block.location.type === 'zone' && !zoneIds.has(block.location.zoneId)) {
          issues.push({
            severity: 'error',
            code: 'missing_zone_reference',
            path: [...path, 'location', 'zoneId'],
            message: `Schedule block references a missing zone: ${block.location.zoneId}`,
          });
        }

        const controller = controllerById.get(block.controllerId);

        if (controller === undefined) {
          issues.push({
            severity: 'error',
            code: 'missing_controller_reference',
            path: [...path, 'controllerId'],
            message: `Schedule block references a missing controller: ${block.controllerId}`,
          });
          return;
        }

        const locationMatches =
          controller.location.type === 'room'
            ? block.location.type === 'room' && controller.location.roomId === block.location.roomId
            : block.location.type === 'zone' &&
              controller.location.zoneId === block.location.zoneId;

        if (!locationMatches) {
          issues.push({
            severity: 'error',
            code: 'schedule_block_location_mismatch',
            path: [...path, 'controllerId'],
            message: `Controller ${controller.id} is not attached to the block's room or zone`,
          });
        }
      });
    });
  });

  const selection = installation.scheduleSelection;

  for (const field of ['mainScheduleId', 'overrideScheduleId'] as const) {
    const scheduleId = selection[field];

    if (scheduleId !== undefined && !scheduleIds.has(scheduleId)) {
      issues.push({
        severity: 'error',
        code: 'missing_schedule_reference',
        path: ['scheduleSelection', field],
        message: `Schedule selection references a missing schedule: ${scheduleId}`,
      });
    }
  }

  if (
    selection.mainScheduleId !== undefined &&
    selection.mainScheduleId === selection.overrideScheduleId
  ) {
    issues.push({
      severity: 'warning',
      code: 'redundant_schedule_override',
      path: ['scheduleSelection', 'overrideScheduleId'],
      message: `Main and override schedules are identical: ${selection.mainScheduleId}`,
    });
  }

  return {
    valid: !issues.some(({ severity }) => severity === 'error'),
    issues,
  };
};

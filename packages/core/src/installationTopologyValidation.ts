import type { Installation } from './Installation.js';

export type TopologyIssueSeverity = 'error' | 'warning';

export type TopologyIssueCode =
  | 'duplicate_entity_id'
  | 'duplicate_controller_entity_id'
  | 'missing_room_reference'
  | 'missing_controller_reference'
  | 'missing_plant_reference'
  | 'missing_energy_source_reference'
  | 'missing_schedule_reference'
  | 'duplicate_room_controller_link'
  | 'duplicate_room_schedule_link'
  | 'duplicate_room_schedule_selection'
  | 'unassigned_selected_schedule'
  | 'unsupported_controller_mode'
  | 'unlinked_controller'
  | 'unused_plant'
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

type CollectionName = 'rooms' | 'climateControllers' | 'plants' | 'energySources' | 'schedules';

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

const addDuplicateKeyIssue = (
  key: string,
  seenKeys: Set<string>,
  issue: TopologyIssue,
  issues: TopologyIssue[],
): void => {
  if (seenKeys.has(key)) {
    issues.push(issue);
  }

  seenKeys.add(key);
};

export const validateInstallationTopology = (
  installation: Installation,
): TopologyValidationResult => {
  const issues: TopologyIssue[] = [];

  addDuplicateIdIssues(installation.rooms, 'rooms', issues);
  addDuplicateIdIssues(installation.climateControllers, 'climateControllers', issues);
  addDuplicateIdIssues(installation.plants, 'plants', issues);
  addDuplicateIdIssues(installation.energySources, 'energySources', issues);
  addDuplicateIdIssues(installation.schedules, 'schedules', issues);

  const roomIds = new Set(installation.rooms.map(({ id }) => id));
  const controllerIds = new Set(installation.climateControllers.map(({ id }) => id));
  const plantById = new Map(installation.plants.map((plant) => [plant.id, plant]));
  const energySourceIds = new Set(installation.energySources.map(({ id }) => id));
  const scheduleIds = new Set(installation.schedules.map(({ id }) => id));

  const seenControllerEntityIds = new Set<string>();
  const plantsWithControllers = new Set<string>();

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

    const plant = plantById.get(controller.plantId);

    if (plant === undefined) {
      issues.push({
        severity: 'error',
        code: 'missing_plant_reference',
        path: ['climateControllers', index, 'plantId'],
        message: `Controller references a missing plant: ${controller.plantId}`,
      });
      return;
    }

    plantsWithControllers.add(plant.id);

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
  });

  installation.plants.forEach((plant, index) => {
    if (!energySourceIds.has(plant.energySourceId)) {
      issues.push({
        severity: 'error',
        code: 'missing_energy_source_reference',
        path: ['plants', index, 'energySourceId'],
        message: `Plant references a missing energy source: ${plant.energySourceId}`,
      });
    }

    if (!plantsWithControllers.has(plant.id)) {
      issues.push({
        severity: 'warning',
        code: 'unused_plant',
        path: ['plants', index],
        message: `Plant is not referenced by any controller: ${plant.id}`,
      });
    }
  });

  const seenRoomControllerLinks = new Set<string>();
  const linkedControllerIds = new Set<string>();

  installation.roomControllerLinks.forEach((link, index) => {
    const roomExists = roomIds.has(link.roomId);
    const controllerExists = controllerIds.has(link.controllerId);

    if (!roomExists) {
      issues.push({
        severity: 'error',
        code: 'missing_room_reference',
        path: ['roomControllerLinks', index, 'roomId'],
        message: `Room-controller link references a missing room: ${link.roomId}`,
      });
    }

    if (!controllerExists) {
      issues.push({
        severity: 'error',
        code: 'missing_controller_reference',
        path: ['roomControllerLinks', index, 'controllerId'],
        message: `Room-controller link references a missing controller: ${link.controllerId}`,
      });
    }

    if (roomExists && controllerExists) {
      linkedControllerIds.add(link.controllerId);
    }

    addDuplicateKeyIssue(
      `${link.roomId}\u0000${link.controllerId}`,
      seenRoomControllerLinks,
      {
        severity: 'error',
        code: 'duplicate_room_controller_link',
        path: ['roomControllerLinks', index],
        message: `Duplicate room-controller link: ${link.roomId} → ${link.controllerId}`,
      },
      issues,
    );
  });

  installation.climateControllers.forEach((controller, index) => {
    if (!linkedControllerIds.has(controller.id)) {
      issues.push({
        severity: 'warning',
        code: 'unlinked_controller',
        path: ['climateControllers', index],
        message: `Controller is not linked to any existing room: ${controller.id}`,
      });
    }
  });

  const seenRoomScheduleLinks = new Set<string>();
  const roomScheduleLinkKeys = new Set<string>();

  installation.roomScheduleLinks.forEach((link, index) => {
    const roomExists = roomIds.has(link.roomId);
    const scheduleExists = scheduleIds.has(link.scheduleId);
    const linkKey = `${link.roomId}\u0000${link.scheduleId}`;

    if (!roomExists) {
      issues.push({
        severity: 'error',
        code: 'missing_room_reference',
        path: ['roomScheduleLinks', index, 'roomId'],
        message: `Room-schedule link references a missing room: ${link.roomId}`,
      });
    }

    if (!scheduleExists) {
      issues.push({
        severity: 'error',
        code: 'missing_schedule_reference',
        path: ['roomScheduleLinks', index, 'scheduleId'],
        message: `Room-schedule link references a missing schedule: ${link.scheduleId}`,
      });
    }

    if (roomExists && scheduleExists) {
      roomScheduleLinkKeys.add(linkKey);
    }

    addDuplicateKeyIssue(
      linkKey,
      seenRoomScheduleLinks,
      {
        severity: 'error',
        code: 'duplicate_room_schedule_link',
        path: ['roomScheduleLinks', index],
        message: `Duplicate room-schedule link: ${link.roomId} → ${link.scheduleId}`,
      },
      issues,
    );
  });

  const seenSelectionRoomIds = new Set<string>();

  installation.roomScheduleSelections.forEach((selection, index) => {
    if (!roomIds.has(selection.roomId)) {
      issues.push({
        severity: 'error',
        code: 'missing_room_reference',
        path: ['roomScheduleSelections', index, 'roomId'],
        message: `Room schedule selection references a missing room: ${selection.roomId}`,
      });
    }

    addDuplicateKeyIssue(
      selection.roomId,
      seenSelectionRoomIds,
      {
        severity: 'error',
        code: 'duplicate_room_schedule_selection',
        path: ['roomScheduleSelections', index],
        message: `Room has more than one schedule-selection record: ${selection.roomId}`,
      },
      issues,
    );

    const selectedSchedules = [
      ['baseScheduleId', selection.baseScheduleId],
      ['overrideScheduleId', selection.overrideScheduleId],
    ] as const;

    selectedSchedules.forEach(([field, scheduleId]) => {
      if (scheduleId === undefined) {
        return;
      }

      if (!scheduleIds.has(scheduleId)) {
        issues.push({
          severity: 'error',
          code: 'missing_schedule_reference',
          path: ['roomScheduleSelections', index, field],
          message: `Room schedule selection references a missing schedule: ${scheduleId}`,
        });
        return;
      }

      if (!roomScheduleLinkKeys.has(`${selection.roomId}\u0000${scheduleId}`)) {
        issues.push({
          severity: 'error',
          code: 'unassigned_selected_schedule',
          path: ['roomScheduleSelections', index, field],
          message: `Selected schedule ${scheduleId} is not assigned to room ${selection.roomId}`,
        });
      }
    });

    if (
      selection.baseScheduleId !== undefined &&
      selection.baseScheduleId === selection.overrideScheduleId
    ) {
      issues.push({
        severity: 'warning',
        code: 'redundant_schedule_override',
        path: ['roomScheduleSelections', index, 'overrideScheduleId'],
        message: `Base and override schedules are identical for room ${selection.roomId}`,
      });
    }
  });

  return {
    valid: !issues.some(({ severity }) => severity === 'error'),
    issues,
  };
};

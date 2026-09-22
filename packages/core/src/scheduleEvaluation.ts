import type { ClimateSettings, ScheduleBlock, ScheduleDays } from './Schedule.js';
import type { Installation } from './Installation.js';
import type { ClimateControllerId, RoomId } from './identifiers.js';
import {
  resolveSelectedSchedule,
  type ResolvedScheduleSelection,
} from './resolveSelectedSchedule.js';

export type ScheduleIntent =
  | {
      type: 'apply';
      controllerId: ClimateControllerId;
      blockId: ScheduleBlock['id'];
      settings: ClimateSettings;
    }
  | {
      type: 'off';
      controllerId: ClimateControllerId;
      reason: 'no_schedule' | 'no_block';
    }
  | {
      type: 'off';
      controllerId: ClimateControllerId;
      reason: 'room_block';
      blockingRoomIds: RoomId[];
    };

export type LocalScheduleTime = {
  day: keyof ScheduleDays;
  minuteOfDay: number;
};

export type ScheduleEvaluation = {
  status: 'active' | 'none_selected' | 'missing_selected_schedule';
  selection: ResolvedScheduleSelection;
  localTime: LocalScheduleTime;
  activeBlocks: ScheduleBlock[];
  intents: ScheduleIntent[];
};

const weekdayNames = {
  Sunday: 'sunday',
  Monday: 'monday',
  Tuesday: 'tuesday',
  Wednesday: 'wednesday',
  Thursday: 'thursday',
  Friday: 'friday',
  Saturday: 'saturday',
} as const;

const getLocalScheduleTime = (
  instantEpochMilliseconds: number,
  timeZone: Installation['timeZone'],
): LocalScheduleTime => {
  const instant = new Date(instantEpochMilliseconds);

  if (Number.isNaN(instant.getTime())) {
    throw new RangeError('Schedule evaluation requires a valid instant');
  }

  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const weekdayValue = parts.find(({ type }) => type === 'weekday')?.value;
  const hourValue = parts.find(({ type }) => type === 'hour')?.value;
  const minuteValue = parts.find(({ type }) => type === 'minute')?.value;
  const day = weekdayNames[weekdayValue as keyof typeof weekdayNames];

  if (day === undefined || hourValue === undefined || minuteValue === undefined) {
    throw new Error('Could not resolve the installation local time');
  }

  return { day, minuteOfDay: Number(hourValue) * 60 + Number(minuteValue) };
};

// Produces automatic intents only; live execution validates topology and overlays manual control.
export const evaluateSchedule = (
  installation: Installation,
  instantEpochMilliseconds: number,
): ScheduleEvaluation => {
  const localTime = getLocalScheduleTime(instantEpochMilliseconds, installation.timeZone);
  const selection = resolveSelectedSchedule(installation.scheduleSelection);
  const schedule =
    selection.source === 'none'
      ? undefined
      : installation.schedules.find(({ id }) => id === selection.scheduleId);
  const status =
    selection.source === 'none'
      ? 'none_selected'
      : schedule === undefined
        ? 'missing_selected_schedule'
        : 'active';
  const activeBlocks =
    schedule?.days[localTime.day].filter(
      ({ startMinute, endMinute }) =>
        startMinute <= localTime.minuteOfDay && localTime.minuteOfDay < endMinute,
    ) ?? [];

  const roomById = new Map(installation.rooms.map((room) => [room.id, room]));
  const blockingRoomIdsByZone = new Map<string, RoomId[]>();
  const activeBlockByControllerId = new Map(
    activeBlocks.map((block) => [block.controllerId, block]),
  );

  for (const block of activeBlocks) {
    if (block.location.type !== 'room') {
      continue;
    }

    const zoneId = roomById.get(block.location.roomId)?.zoneId;

    if (zoneId === undefined) {
      continue;
    }

    const blockingRoomIds = blockingRoomIdsByZone.get(zoneId) ?? [];
    blockingRoomIds.push(block.location.roomId);
    blockingRoomIdsByZone.set(zoneId, blockingRoomIds);
  }

  const intents: ScheduleIntent[] = installation.climateControllers.map((controller) => {
    if (controller.location.type === 'zone') {
      const blockingRoomIds = blockingRoomIdsByZone.get(controller.location.zoneId);

      if (blockingRoomIds !== undefined) {
        return {
          type: 'off',
          controllerId: controller.id,
          reason: 'room_block',
          blockingRoomIds: [...blockingRoomIds],
        };
      }
    }

    const block = activeBlockByControllerId.get(controller.id);

    if (block !== undefined) {
      return {
        type: 'apply',
        controllerId: controller.id,
        blockId: block.id,
        settings: block.settings,
      };
    }

    return {
      type: 'off',
      controllerId: controller.id,
      reason: schedule === undefined ? 'no_schedule' : 'no_block',
    };
  });

  return { status, selection, localTime, activeBlocks, intents };
};

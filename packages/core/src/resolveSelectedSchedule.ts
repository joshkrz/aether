import type { ScheduleId } from './identifiers.js';
import type { ScheduleSelection } from './ScheduleSelection.js';

export type ResolvedScheduleSelection =
  { source: 'main' | 'override'; scheduleId: ScheduleId } | { source: 'none' };

export const resolveSelectedSchedule = (
  selection: ScheduleSelection,
): ResolvedScheduleSelection => {
  if (selection.overrideScheduleId !== undefined) {
    return { source: 'override', scheduleId: selection.overrideScheduleId };
  }

  if (selection.mainScheduleId !== undefined) {
    return { source: 'main', scheduleId: selection.mainScheduleId };
  }

  return { source: 'none' };
};

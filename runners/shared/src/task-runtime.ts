export const TASK_CONTEXT_MODES = ['group', 'isolated'] as const;
export type TaskContextMode = (typeof TASK_CONTEXT_MODES)[number];

export const DEFAULT_TASK_CONTEXT_MODE: TaskContextMode = 'isolated';
export const DEFAULT_SCHEDULE_TASK_CONTEXT_MODE: TaskContextMode = 'group';
export const DEFAULT_WATCH_CI_CONTEXT_MODE: TaskContextMode = 'isolated';
export const WATCH_CI_PROMPT_PREFIX = '[BACKGROUND CI WATCH]';

export function isTaskContextMode(value: unknown): value is TaskContextMode {
  return value === 'group' || value === 'isolated';
}

export function normalizeTaskContextMode(
  value: unknown,
  fallback: TaskContextMode = DEFAULT_TASK_CONTEXT_MODE,
): TaskContextMode {
  return isTaskContextMode(value) ? value : fallback;
}

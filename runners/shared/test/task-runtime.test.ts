import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCHEDULE_TASK_CONTEXT_MODE,
  DEFAULT_TASK_CONTEXT_MODE,
  DEFAULT_WATCH_CI_CONTEXT_MODE,
  TASK_CONTEXT_MODES,
  WATCH_CI_PROMPT_PREFIX,
  isTaskContextMode,
  normalizeTaskContextMode,
} from '../src/task-runtime.js';

describe('task runtime constants', () => {
  it('defines the task context modes and default', () => {
    expect(TASK_CONTEXT_MODES).toEqual(['group', 'isolated']);
    expect(DEFAULT_TASK_CONTEXT_MODE).toBe('isolated');
    expect(DEFAULT_SCHEDULE_TASK_CONTEXT_MODE).toBe('group');
    expect(DEFAULT_WATCH_CI_CONTEXT_MODE).toBe('isolated');
  });

  it('normalizes task context modes consistently', () => {
    expect(isTaskContextMode('group')).toBe(true);
    expect(isTaskContextMode('isolated')).toBe(true);
    expect(isTaskContextMode('invalid')).toBe(false);
    expect(normalizeTaskContextMode('group')).toBe('group');
    expect(normalizeTaskContextMode('invalid')).toBe('isolated');
  });

  it('defines the watch CI prompt sentinel', () => {
    expect(WATCH_CI_PROMPT_PREFIX).toBe('[BACKGROUND CI WATCH]');
  });
});

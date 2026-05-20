import { describe, expect, it } from 'vitest';

import {
  buildRestartAnnouncement,
  getRecoverableInterruptedGroups,
  getInterruptedRecoveryCandidates,
  type RestartContext,
} from './restart-context.js';
import type { RegisteredGroup } from './types.js';

function makeGroup(folder: string): RegisteredGroup {
  return {
    name: folder,
    folder,
    trigger: '@Andy',
    added_at: new Date().toISOString(),
    requiresTrigger: false,
  };
}

describe('restart recovery context', () => {
  it('returns only registered processing groups and deduplicates by chatJid', () => {
    const roomBindings: Record<string, RegisteredGroup> = {
      'dc:1': makeGroup('group-one'),
      'dc:2': makeGroup('group-two'),
    };

    const context: RestartContext = {
      chatJid: 'dc:main',
      summary: 'restart',
      verify: [],
      writtenAt: new Date().toISOString(),
      interruptedGroups: [
        {
          chatJid: 'dc:1',
          groupName: 'one',
          status: 'processing',
          elapsedMs: 1000,
          pendingMessages: true,
          pendingTasks: 0,
        },
        {
          chatJid: 'dc:2',
          groupName: 'two-waiting',
          status: 'waiting',
          elapsedMs: null,
          pendingMessages: false,
          pendingTasks: 1,
        },
        {
          chatJid: 'dc:2',
          groupName: 'two-idle',
          status: 'idle',
          elapsedMs: null,
          pendingMessages: false,
          pendingTasks: 0,
        },
        {
          chatJid: 'dc:3',
          groupName: 'missing',
          status: 'processing',
          elapsedMs: 500,
          pendingMessages: true,
          pendingTasks: 0,
        },
        {
          chatJid: 'dc:1',
          groupName: 'one-duplicate',
          status: 'processing',
          elapsedMs: 2000,
          pendingMessages: false,
          pendingTasks: 1,
        },
      ],
    };

    expect(getInterruptedRecoveryCandidates(context, roomBindings)).toEqual([
      {
        chatJid: 'dc:1',
        groupFolder: 'group-one',
        status: 'processing',
        pendingMessages: true,
        pendingTasks: 0,
      },
    ]);
  });

  it('returns empty when there is no explicit restart context', () => {
    expect(getInterruptedRecoveryCandidates(null, {})).toEqual([]);
  });

  it('uses only processing groups for restart announcements', () => {
    const context: RestartContext = {
      chatJid: 'dc:main',
      summary: 'restart',
      verify: [],
      writtenAt: '2026-05-21T00:00:00.000Z',
      interruptedGroups: [
        {
          chatJid: 'dc:processing',
          groupName: 'processing',
          status: 'processing',
          elapsedMs: 1000,
          pendingMessages: false,
          pendingTasks: 0,
        },
        {
          chatJid: 'dc:waiting',
          groupName: 'waiting',
          status: 'waiting',
          elapsedMs: null,
          pendingMessages: true,
          pendingTasks: 1,
        },
      ],
    };

    expect(getRecoverableInterruptedGroups(context)).toHaveLength(1);
    expect(buildRestartAnnouncement(context)).toContain('중단 작업 감지: 1개');
  });
});

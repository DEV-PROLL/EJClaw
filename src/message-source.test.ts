import { describe, expect, it } from 'vitest';

import {
  inferMessageSourceKindFromBotFlag,
  normalizeMessageSourceKind,
  resolveInjectedMessageSourceKind,
} from './message-source.js';
import { DEFAULT_MESSAGE_SOURCE_KIND, MESSAGE_SOURCE_KINDS } from './types.js';

describe('message source kind helpers', () => {
  it('uses the canonical source kind list', () => {
    expect(MESSAGE_SOURCE_KINDS).toEqual([
      'human',
      'bot',
      'trusted_external_bot',
      'ipc_injected_human',
      'ipc_injected_bot',
    ]);
    expect(DEFAULT_MESSAGE_SOURCE_KIND).toBe('human');
  });

  it('normalizes unknown source kinds to the default', () => {
    expect(normalizeMessageSourceKind('trusted_external_bot')).toBe(
      'trusted_external_bot',
    );
    expect(normalizeMessageSourceKind('unknown')).toBe('human');
  });

  it('derives source kinds from legacy and injected inputs', () => {
    expect(inferMessageSourceKindFromBotFlag(true)).toBe('bot');
    expect(inferMessageSourceKindFromBotFlag(false)).toBe('human');
    expect(resolveInjectedMessageSourceKind({ treatAsHuman: true })).toBe(
      'trusted_external_bot',
    );
    expect(resolveInjectedMessageSourceKind({ treatAsHuman: false })).toBe(
      'ipc_injected_bot',
    );
  });
});

import {
  DEFAULT_MESSAGE_SOURCE_KIND,
  MESSAGE_SOURCE_KINDS,
  type MessageSourceKind,
} from './types.js';

const MESSAGE_SOURCE_KIND_SET = new Set<MessageSourceKind>(
  MESSAGE_SOURCE_KINDS,
);

export function normalizeMessageSourceKind(
  value: unknown,
  fallback: MessageSourceKind = DEFAULT_MESSAGE_SOURCE_KIND,
): MessageSourceKind {
  return typeof value === 'string' &&
    MESSAGE_SOURCE_KIND_SET.has(value as MessageSourceKind)
    ? (value as MessageSourceKind)
    : fallback;
}

export function isBotMessageSourceKind(kind: MessageSourceKind): boolean {
  return kind === 'bot' || kind === 'ipc_injected_bot';
}

export function inferMessageSourceKindFromBotFlag(
  isBotMessage: boolean | number | null | undefined,
): MessageSourceKind {
  return isBotMessage ? 'bot' : DEFAULT_MESSAGE_SOURCE_KIND;
}

export function resolveInjectedMessageSourceKind(args: {
  treatAsHuman: boolean;
  sourceKind?: unknown;
}): MessageSourceKind {
  return normalizeMessageSourceKind(
    args.sourceKind,
    args.treatAsHuman ? 'trusted_external_bot' : 'ipc_injected_bot',
  );
}

export const HUMAN_MESSAGE_DETECTED_CLOSE_REASON = 'human-message-detected';

export function isHumanMessageCloseReason(
  reason: string | null | undefined,
): boolean {
  return reason === HUMAN_MESSAGE_DETECTED_CLOSE_REASON;
}

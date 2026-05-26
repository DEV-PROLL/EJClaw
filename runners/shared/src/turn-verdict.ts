export type TurnVerdict =
  | 'continue'
  | 'step_done'
  | 'task_done'
  | 'done_with_concerns'
  | 'blocked'
  | 'needs_context';

export type LegacyTurnVerdict = TurnVerdict | 'done' | 'in_progress';
export type RunnerOutputVerdict = LegacyTurnVerdict | 'silent';

const VISIBLE_VERDICT_SCAN_LINE_LIMIT = 5;

function leadingVisibleLines(text: string, limit: number): string[] {
  const lines: string[] = [];
  let inFence = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.length === 0) {
      continue;
    }
    lines.push(line);
    if (lines.length >= limit) {
      break;
    }
  }

  return lines;
}

function parseVisibleTurnVerdictLine(line: string): TurnVerdict | null {
  if (/^\*{0,2}BLOCKED(?:\*{0,2})?\b/i.test(line)) return 'blocked';
  if (/^\*{0,2}NEEDS_CONTEXT(?:\*{0,2})?\b/i.test(line)) return 'needs_context';
  if (/^\*{0,2}STEP_DONE(?:\*{0,2})?\b/i.test(line)) return 'step_done';
  if (/^\*{0,2}TASK_DONE(?:\*{0,2})?\b/i.test(line)) return 'task_done';
  if (/^\*{0,2}DONE_WITH_CONCERNS(?:\*{0,2})?\b/i.test(line))
    return 'done_with_concerns';
  if (/^\*{0,2}DONE(?:\*{0,2})?\b/i.test(line)) return 'task_done';
  if (/^\*{0,2}Approved\.?(?:\*{0,2})?/i.test(line)) return 'task_done';
  if (/^\*{0,2}LGTM(?:\*{0,2})?/i.test(line)) return 'task_done';
  return null;
}

export function normalizeTurnVerdictValue(value: unknown): TurnVerdict | null {
  switch (value) {
    case 'continue':
    case 'step_done':
    case 'task_done':
    case 'done_with_concerns':
    case 'blocked':
    case 'needs_context':
      return value;
    case 'done':
      return 'task_done';
    case 'in_progress':
      return 'continue';
    default:
      return null;
  }
}

export function normalizeRunnerOutputVerdict(
  value: unknown,
): TurnVerdict | null {
  if (value === 'silent') return null;
  return normalizeTurnVerdictValue(value);
}

export function parseVisibleTurnVerdict(
  summary: string | null | undefined,
): TurnVerdict {
  if (!summary) return 'continue';
  const cleaned = summary.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
  if (!cleaned) return 'continue';
  for (const line of leadingVisibleLines(
    cleaned,
    VISIBLE_VERDICT_SCAN_LINE_LIMIT,
  )) {
    const verdict = parseVisibleTurnVerdictLine(line);
    if (verdict) return verdict;
  }
  return 'continue';
}

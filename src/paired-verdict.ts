import {
  normalizeTurnVerdictValue,
  parseVisibleTurnVerdict,
  type TurnVerdict,
} from 'ejclaw-runners-shared';

export type VisibleVerdict = TurnVerdict;
export type { TurnVerdict };
export { normalizeTurnVerdictValue };

export type ArbiterVerdictResult =
  | 'proceed'
  | 'revise'
  | 'reset'
  | 'escalate'
  | 'unknown';

export function parseVisibleVerdict(
  summary: string | null | undefined,
): VisibleVerdict {
  return parseVisibleTurnVerdict(summary);
}

export function classifyArbiterVerdict(
  summary: string | null | undefined,
): ArbiterVerdictResult {
  if (!summary) return 'unknown';
  const cleaned = summary.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
  if (!cleaned) return 'unknown';
  const firstLine = cleaned.split('\n')[0].trim();
  const verdictMatch = firstLine.match(
    /\*{0,2}(?:VERDICT\s*[:—-]\s*)?(PROCEED|REVISE|RESET|ESCALATE)\*{0,2}/i,
  );
  if (verdictMatch) {
    return verdictMatch[1].toLowerCase() as ArbiterVerdictResult;
  }
  return 'unknown';
}

export function resolveStoredVisibleVerdict(args: {
  verdict?: string | null;
  outputText?: string | null;
}): VisibleVerdict | null {
  const stored = normalizeTurnVerdictValue(args.verdict);
  if (stored) {
    return stored;
  }
  if (!args.outputText) {
    return null;
  }
  return parseVisibleVerdict(args.outputText);
}

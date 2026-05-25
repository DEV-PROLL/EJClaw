import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import type { AgentType } from './types.js';

const PROMPT_INGESTION_STATE_FILE = '.ejclaw-prompt-ingestion.json';

export interface PromptIngestionPlan {
  prompt: string;
  fingerprint?: string;
  statePath?: string;
}

function hashPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex');
}

function readStoredFingerprint(statePath: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as {
      fingerprint?: unknown;
    };
    return typeof parsed.fingerprint === 'string'
      ? parsed.fingerprint
      : undefined;
  } catch {
    return undefined;
  }
}

function stripTrailingMemoryBriefing(
  promptContext: string,
  memoryBriefing?: string,
): string {
  if (!memoryBriefing) {
    return promptContext;
  }
  const suffix = `\n\n---\n\n${memoryBriefing}`;
  return promptContext.endsWith(suffix)
    ? promptContext.slice(0, -suffix.length)
    : promptContext;
}

function resolvePromptContextPath(args: {
  agentType: AgentType;
  env: Record<string, string>;
}): string | undefined {
  if (args.agentType === 'codex' && args.env.CODEX_HOME) {
    return path.join(args.env.CODEX_HOME, 'AGENTS.md');
  }
  if (args.env.CLAUDE_CONFIG_DIR) {
    return path.join(args.env.CLAUDE_CONFIG_DIR, 'CLAUDE.md');
  }
  if (args.env.CODEX_HOME) {
    return path.join(args.env.CODEX_HOME, 'AGENTS.md');
  }
  return undefined;
}

function buildPromptBootstrap(promptContext: string, prompt: string): string {
  return `System bootstrap:
Load and follow the current EJClaw role prompt below. This bootstrap is injected only when a role session starts or when the prompt pack changes. Do not summarize it; apply it silently to the task that follows.

<ejclaw_role_prompt>
${promptContext}
</ejclaw_role_prompt>

Current task:
${prompt}`;
}

export function preparePromptIngestion(args: {
  agentType: AgentType;
  env: Record<string, string>;
  prompt: string;
  sessionId?: string;
  memoryBriefing?: string;
}): PromptIngestionPlan {
  if (args.prompt.trim() === '/compact') {
    return { prompt: args.prompt };
  }

  const promptContextPath = resolvePromptContextPath(args);
  if (!promptContextPath || !fs.existsSync(promptContextPath)) {
    return { prompt: args.prompt };
  }

  const promptContext = fs.readFileSync(promptContextPath, 'utf-8').trim();
  if (!promptContext) {
    return { prompt: args.prompt };
  }

  const fingerprintSource = stripTrailingMemoryBriefing(
    promptContext,
    args.memoryBriefing,
  ).trim();
  const fingerprint = hashPrompt(fingerprintSource || promptContext);
  const statePath = path.join(
    path.dirname(promptContextPath),
    PROMPT_INGESTION_STATE_FILE,
  );
  const storedFingerprint = readStoredFingerprint(statePath);

  if (args.sessionId && storedFingerprint === fingerprint) {
    return { prompt: args.prompt, fingerprint, statePath };
  }

  return {
    prompt: buildPromptBootstrap(promptContext, args.prompt),
    fingerprint,
    statePath,
  };
}

export function recordPromptIngestion(plan: PromptIngestionPlan): void {
  if (!plan.fingerprint || !plan.statePath) {
    return;
  }
  fs.mkdirSync(path.dirname(plan.statePath), { recursive: true });
  fs.writeFileSync(
    plan.statePath,
    JSON.stringify(
      {
        fingerprint: plan.fingerprint,
        ingested_at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
}

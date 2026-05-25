import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  preparePromptIngestion,
  recordPromptIngestion,
} from './agent-prompt-ingestion.js';

describe('agent prompt ingestion', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync('/tmp/ejclaw-prompt-ingestion-');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeClaudePrompt(text: string): string {
    const claudeDir = path.join(tempDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const promptPath = path.join(claudeDir, 'CLAUDE.md');
    fs.writeFileSync(promptPath, text);
    return claudeDir;
  }

  function writeCodexPrompt(text: string): string {
    const codexDir = path.join(tempDir, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    const promptPath = path.join(codexDir, 'AGENTS.md');
    fs.writeFileSync(promptPath, text);
    return codexDir;
  }

  it('injects the role prompt when starting a fresh Claude session', () => {
    const claudeDir = writeClaudePrompt('platform rules\n\npaired rules\n');

    const plan = preparePromptIngestion({
      agentType: 'claude-code',
      env: { CLAUDE_CONFIG_DIR: claudeDir },
      prompt: 'review current changes',
    });

    expect(plan.prompt).toContain('<ejclaw_role_prompt>');
    expect(plan.prompt).toContain('platform rules');
    expect(plan.prompt).toContain('paired rules');
    expect(plan.prompt).toContain('Current task:\nreview current changes');
  });

  it('does not reinject an unchanged prompt into an existing session', () => {
    const codexDir = writeCodexPrompt('codex platform rules\n');
    const first = preparePromptIngestion({
      agentType: 'codex',
      env: { CODEX_HOME: codexDir },
      prompt: 'first task',
    });
    recordPromptIngestion(first);

    const second = preparePromptIngestion({
      agentType: 'codex',
      env: { CODEX_HOME: codexDir },
      prompt: 'second task',
      sessionId: 'session-existing',
    });

    expect(second.prompt).toBe('second task');
  });

  it('reinjects when the prompt pack changes in an existing session', () => {
    const claudeDir = writeClaudePrompt('old rules\n');
    const first = preparePromptIngestion({
      agentType: 'claude-code',
      env: { CLAUDE_CONFIG_DIR: claudeDir },
      prompt: 'first task',
      sessionId: 'session-existing',
    });
    recordPromptIngestion(first);

    fs.writeFileSync(path.join(claudeDir, 'CLAUDE.md'), 'new rules\n');
    const second = preparePromptIngestion({
      agentType: 'claude-code',
      env: { CLAUDE_CONFIG_DIR: claudeDir },
      prompt: 'second task',
      sessionId: 'session-existing',
    });

    expect(second.prompt).toContain('new rules');
    expect(second.prompt).toContain('Current task:\nsecond task');
  });

  it('does not treat a one-time memory briefing as a prompt pack change', () => {
    const claudeDir = writeClaudePrompt(
      'stable rules\n\n---\n\n## Shared Room Memory\n- remembered',
    );
    const first = preparePromptIngestion({
      agentType: 'claude-code',
      env: { CLAUDE_CONFIG_DIR: claudeDir },
      prompt: 'first task',
      memoryBriefing: '## Shared Room Memory\n- remembered',
    });
    recordPromptIngestion(first);

    fs.writeFileSync(path.join(claudeDir, 'CLAUDE.md'), 'stable rules\n');
    const second = preparePromptIngestion({
      agentType: 'claude-code',
      env: { CLAUDE_CONFIG_DIR: claudeDir },
      prompt: 'second task',
      sessionId: 'session-existing',
    });

    expect(second.prompt).toBe('second task');
  });

  it('does not inject role prompts into compact commands', () => {
    const claudeDir = writeClaudePrompt('platform rules\n');

    const plan = preparePromptIngestion({
      agentType: 'claude-code',
      env: { CLAUDE_CONFIG_DIR: claudeDir },
      prompt: '/compact',
    });

    expect(plan.prompt).toBe('/compact');
  });
});

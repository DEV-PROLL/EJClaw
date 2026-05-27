import { getAgentOutputText } from './agent-output.js';
import {
  executeAttemptRetryAction,
  runClaudeAttemptWithRotation,
  runCodexAttemptWithRotation,
} from './agent-attempt-orchestration.js';
import { isRetryableClaudeSessionFailureAttempt } from './agent-attempt-retry.js';
import { getCodexAccountCount } from './codex-token-rotation.js';
import type {
  AgentTriggerReason,
  CodexRotationReason,
} from './agent-error-detection.js';
import type { PairedExecutionLifecycle } from './message-agent-executor-paired.js';
import type { MessageAgentAttempt } from './message-agent-executor-attempt-runner.js';
import {
  shouldResetCodexSessionOnAgentFailure,
  shouldResetSessionOnAgentFailure,
  shouldRetryFreshCodexSessionOnAgentFailure,
} from './session-recovery.js';
import { getErrorMessage } from './utils.js';

type AttemptResult = 'success' | 'error';
type AgentProvider = 'claude' | 'codex';
type LifecycleRecoveryResult = {
  attempt: MessageAgentAttempt;
  resolved: AttemptResult | null;
};

interface MessageAgentAttemptLifecycleArgs {
  provider: AgentProvider;
  runAttempt: (provider: AgentProvider) => Promise<MessageAgentAttempt>;
  isClaudeCodeAgent: boolean;
  canRetryClaudeCredentials: boolean;
  clearStoredSession: () => void;
  clearRoleSdkSessions: () => void;
  sessionFolder: string;
  maybeHandoffToCodex: (
    reason: AgentTriggerReason,
    sawVisibleOutput: boolean,
  ) => boolean;
  hasDirectTerminalDelivery: () => boolean;
  pairedExecutionLifecycle: Pick<
    PairedExecutionLifecycle,
    'markStatus' | 'markSawOutput' | 'updateSummary' | 'getSummary'
  >;
  shouldRetryFreshSessionOnAgentFailure: (args: {
    result: null;
    error: string;
  }) => boolean;
  rotationLogContext: {
    chatJid: string;
    group: string;
    groupFolder: string;
    runId: string;
  };
  log: {
    warn: (obj: Record<string, unknown> | string, msg?: string) => void;
    error: (obj: Record<string, unknown> | string, msg?: string) => void;
  };
}

function isRetryableCodexSessionFailureAttempt(args: {
  provider: 'claude' | 'codex';
  attempt: MessageAgentAttempt;
}): boolean {
  const { provider, attempt } = args;
  if (provider !== 'codex' || attempt.sawOutput) return false;
  if (attempt.retryableSessionFailureDetected === true) return true;
  if (attempt.output != null)
    return shouldRetryFreshCodexSessionOnAgentFailure(attempt.output);
  return attempt.error == null
    ? false
    : shouldRetryFreshCodexSessionOnAgentFailure({
        result: null,
        error: getErrorMessage(attempt.error),
      });
}

class MessageAgentAttemptLifecycleRunner {
  private resetSessionRequested = false;

  constructor(private readonly args: MessageAgentAttemptLifecycleArgs) {}

  async execute(): Promise<AttemptResult> {
    let primaryAttempt = await this.runTrackedAttempt(this.args.provider);
    const recoveredClaudeAttempt =
      await this.recoverRetryableClaudeSessionFailure(primaryAttempt);
    if (recoveredClaudeAttempt.resolved) {
      return recoveredClaudeAttempt.resolved;
    }
    primaryAttempt = recoveredClaudeAttempt.attempt;

    const recoveredCodexAttempt =
      await this.recoverRetryableCodexSessionFailure(primaryAttempt);
    if (recoveredCodexAttempt.resolved) {
      return recoveredCodexAttempt.resolved;
    }
    primaryAttempt = recoveredCodexAttempt.attempt;

    if (primaryAttempt.error) {
      return this.handlePrimaryAttemptFailure(
        primaryAttempt,
        getErrorMessage(primaryAttempt.error),
      );
    }

    return this.finalizePrimaryAttempt(primaryAttempt);
  }

  private rememberAttempt(attempt: MessageAgentAttempt): MessageAgentAttempt {
    if (attempt.resetSessionRequested) {
      this.resetSessionRequested = true;
    }
    return attempt;
  }

  private async runTrackedAttempt(
    provider: AgentProvider,
  ): Promise<MessageAgentAttempt> {
    return this.rememberAttempt(await this.args.runAttempt(provider));
  }

  private retryCodexWithRotation(
    initialTrigger: { reason: CodexRotationReason },
    rotationMessage?: string,
  ): Promise<AttemptResult> {
    return runCodexAttemptWithRotation({
      initialTrigger,
      runAttempt: () => this.runTrackedAttempt('codex'),
      logContext: this.args.rotationLogContext,
      rotationMessage,
    });
  }

  private retryClaudeWithRotation(
    initialTrigger: {
      reason: AgentTriggerReason;
      retryAfterMs?: number;
    },
    rotationMessage?: string,
  ): Promise<AttemptResult> {
    return runClaudeAttemptWithRotation({
      initialTrigger,
      runAttempt: () => this.runTrackedAttempt('claude'),
      logContext: this.args.rotationLogContext,
      rotationMessage,
      onSuccess: ({ sawOutput }) => {
        this.args.pairedExecutionLifecycle.markSawOutput(sawOutput);
      },
    });
  }

  private maybeHandoffAfterError(
    reason: AgentTriggerReason,
    attempt: MessageAgentAttempt,
  ): AttemptResult {
    if (this.args.maybeHandoffToCodex(reason, attempt.sawVisibleOutput)) {
      return 'success';
    }
    return 'error';
  }

  private async retryClaudeAttemptIfNeeded(
    attempt: MessageAgentAttempt,
    rotationMessage?: string | null,
  ): Promise<AttemptResult | null> {
    const retryAction = await executeAttemptRetryAction({
      provider: this.args.provider,
      canRetryClaudeCredentials: this.args.canRetryClaudeCredentials,
      canRetryCodex: false,
      attempt,
      rotationMessage,
      runClaude: (trigger, message) =>
        this.retryClaudeWithRotation(trigger, message),
      runCodex: (trigger, message) =>
        this.retryCodexWithRotation(trigger, message),
    });
    if (retryAction.kind !== 'claude') {
      return null;
    }

    if (retryAction.result === 'error') {
      return this.maybeHandoffAfterError(retryAction.trigger.reason, attempt);
    }

    this.args.pairedExecutionLifecycle.markStatus('succeeded');
    return retryAction.result;
  }

  private async retryCodexAttemptIfNeeded(
    attempt: MessageAgentAttempt,
    rotationMessage?: string | null,
  ): Promise<AttemptResult | null> {
    const retryAction = await executeAttemptRetryAction({
      provider: this.args.provider,
      canRetryClaudeCredentials: false,
      canRetryCodex: !this.args.isClaudeCodeAgent && getCodexAccountCount() > 1,
      attempt,
      rotationMessage,
      runClaude: (trigger, message) =>
        this.retryClaudeWithRotation(trigger, message),
      runCodex: (trigger, message) =>
        this.retryCodexWithRotation(trigger, message),
    });
    if (retryAction.kind !== 'codex') {
      return null;
    }

    if (retryAction.result === 'success') {
      this.args.pairedExecutionLifecycle.markStatus('succeeded');
    }
    return retryAction.result;
  }

  private isRetryableClaudeSessionFailure(
    attempt: MessageAgentAttempt,
  ): boolean {
    return isRetryableClaudeSessionFailureAttempt({
      attempt,
      isClaudeCodeAgent: this.args.isClaudeCodeAgent,
      provider: this.args.provider,
      shouldRetryFreshSessionOnAgentFailure:
        this.args.shouldRetryFreshSessionOnAgentFailure,
    });
  }

  private async recoverRetryableClaudeSessionFailure(
    attempt: MessageAgentAttempt,
  ): Promise<LifecycleRecoveryResult> {
    if (!this.isRetryableClaudeSessionFailure(attempt)) {
      return { attempt, resolved: null };
    }

    this.args.clearStoredSession();
    this.args.clearRoleSdkSessions();
    this.args.log.warn(
      'Cleared poisoned Claude session before visible output, retrying fresh session',
    );

    const freshAttempt = await this.runTrackedAttempt('claude');
    if (!this.isRetryableClaudeSessionFailure(freshAttempt)) {
      return { attempt: freshAttempt, resolved: null };
    }

    this.args.clearStoredSession();
    this.args.log.warn(
      'Fresh Claude retry also hit a retryable session failure',
    );
    this.args.log.error(
      'Retryable Claude session failure persisted after fresh retry',
    );
    return {
      attempt: freshAttempt,
      resolved: this.maybeHandoffAfterError('session-failure', freshAttempt),
    };
  }

  private async recoverRetryableCodexSessionFailure(
    attempt: MessageAgentAttempt,
  ): Promise<LifecycleRecoveryResult> {
    if (
      !isRetryableCodexSessionFailureAttempt({
        provider: this.args.provider,
        attempt,
      })
    ) {
      return { attempt, resolved: null };
    }

    this.args.clearStoredSession();
    this.args.clearRoleSdkSessions();
    this.args.log.warn(
      'Cleared poisoned Codex session before visible output, retrying fresh session',
    );

    const freshAttempt = await this.runTrackedAttempt('codex');
    if (
      !isRetryableCodexSessionFailureAttempt({
        provider: this.args.provider,
        attempt: freshAttempt,
      })
    ) {
      return { attempt: freshAttempt, resolved: null };
    }

    this.args.clearStoredSession();
    this.args.log.warn(
      'Fresh Codex retry also hit a retryable session failure',
    );
    this.args.log.error(
      'Retryable Codex session failure persisted after fresh retry',
    );
    return {
      attempt: freshAttempt,
      resolved: 'error',
    };
  }

  private async handlePrimaryAttemptFailure(
    attempt: MessageAgentAttempt,
    rotationMessage: string,
  ): Promise<AttemptResult> {
    const claudeRetryResult = await this.retryClaudeAttemptIfNeeded(
      attempt,
      rotationMessage,
    );
    if (claudeRetryResult) {
      return claudeRetryResult;
    }

    const codexRetryResult = await this.retryCodexAttemptIfNeeded(
      attempt,
      rotationMessage,
    );
    if (codexRetryResult) {
      return codexRetryResult;
    }

    if (attempt.error) {
      this.args.log.error(
        {
          provider: this.args.provider,
          err: attempt.error,
        },
        'Agent error',
      );
      return 'error';
    }

    this.args.log.error(
      {
        provider: this.args.provider,
        error: attempt.output?.error,
      },
      'Agent process error',
    );
    return 'error';
  }

  private updateSummaryIfMissing(attempt: MessageAgentAttempt): void {
    const output = attempt.output;
    if (!output || this.args.pairedExecutionLifecycle.getSummary()) {
      return;
    }
    const finalOutputText = getAgentOutputText(output);
    this.args.pairedExecutionLifecycle.updateSummary({
      outputText:
        typeof finalOutputText === 'string' && finalOutputText.length > 0
          ? finalOutputText
          : null,
      errorText:
        typeof output.error === 'string' && output.error.length > 0
          ? output.error
          : null,
    });
  }

  private clearPoisonedSessionAfterFailureIfNeeded(
    attempt: MessageAgentAttempt,
  ): void {
    const output = attempt.output;
    if (!output) return;

    if (
      this.args.isClaudeCodeAgent &&
      (this.resetSessionRequested || shouldResetSessionOnAgentFailure(output))
    ) {
      this.args.clearStoredSession();
      this.args.log.warn(
        { sessionFolder: this.args.sessionFolder },
        'Cleared poisoned agent session after unrecoverable error',
      );
    }

    if (
      !this.args.isClaudeCodeAgent &&
      this.args.provider === 'codex' &&
      (this.resetSessionRequested ||
        shouldResetCodexSessionOnAgentFailure(output))
    ) {
      this.args.clearStoredSession();
      this.args.clearRoleSdkSessions();
      this.args.log.warn(
        { sessionFolder: this.args.sessionFolder },
        'Cleared poisoned Codex session after unrecoverable error',
      );
    }
  }

  private resolveStreamedTriggerOutcome(
    attempt: MessageAgentAttempt,
  ): AttemptResult | null {
    if (!attempt.streamedTriggerReason) {
      return null;
    }
    if (
      this.args.isClaudeCodeAgent &&
      this.args.maybeHandoffToCodex(
        attempt.streamedTriggerReason.reason,
        attempt.sawVisibleOutput,
      )
    ) {
      return 'success';
    }
    this.args.log.error(
      {
        reason: attempt.streamedTriggerReason.reason,
      },
      'Agent trigger detected but could not be resolved',
    );
    return 'error';
  }

  private async finalizePrimaryAttempt(
    attempt: MessageAgentAttempt,
  ): Promise<AttemptResult> {
    const output = attempt.output;
    if (!output) {
      this.args.log.error(
        { provider: this.args.provider },
        'Agent produced no output object',
      );
      return 'error';
    }

    this.updateSummaryIfMissing(attempt);

    if (
      !attempt.sawOutput &&
      !this.args.hasDirectTerminalDelivery() &&
      output.status !== 'error'
    ) {
      const claudeRetryResult = await this.retryClaudeAttemptIfNeeded(attempt);
      if (claudeRetryResult) {
        return claudeRetryResult;
      }
    }

    this.clearPoisonedSessionAfterFailureIfNeeded(attempt);

    if (output.status === 'error') {
      return this.handlePrimaryAttemptFailure(
        attempt,
        output.error ?? 'Agent process error',
      );
    }

    const codexRetryResult = await this.retryCodexAttemptIfNeeded(
      attempt,
      output.error ?? output.result,
    );
    if (codexRetryResult) {
      return codexRetryResult;
    }

    const streamedTriggerOutcome = this.resolveStreamedTriggerOutcome(attempt);
    if (streamedTriggerOutcome) {
      return streamedTriggerOutcome;
    }

    if (
      attempt.sawSuccessNullResultWithoutOutput &&
      !attempt.sawOutput &&
      !this.args.hasDirectTerminalDelivery()
    ) {
      this.args.log.error(
        'Agent returned success with null result and no visible output',
      );
      return 'error';
    }

    this.args.pairedExecutionLifecycle.markStatus('succeeded');
    this.args.pairedExecutionLifecycle.markSawOutput(
      attempt.sawOutput || this.args.hasDirectTerminalDelivery(),
    );
    return 'success';
  }
}

export function executeMessageAgentAttemptLifecycle(
  args: MessageAgentAttemptLifecycleArgs,
): Promise<AttemptResult> {
  return new MessageAgentAttemptLifecycleRunner(args).execute();
}

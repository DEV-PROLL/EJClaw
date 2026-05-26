import type { AgentOutput } from './agent-runner.js';
import {
  completePairedTurn,
  failPairedTurn,
  getLastHumanMessageSender,
  getLatestTurnNumber,
  getPairedTaskById,
  insertPairedTurnOutput,
  refreshPairedTaskExecutionLease,
  releasePairedTaskExecutionLease,
} from './db.js';
import { logger } from './logger.js';
import {
  completePairedExecutionContext,
  type PreparedPairedExecutionContext,
} from './paired-execution-context.js';
import { parseVisibleVerdict, type TurnVerdict } from './paired-verdict.js';
import { resolvePairedFollowUpQueueAction } from './message-agent-executor-rules.js';
import { enqueuePairedFollowUpAfterEvent } from './message-runtime-follow-up.js';
import type { PairedTurnIdentity } from './paired-turn-identity.js';
import { resolvePairedTurnRunOwnership } from './paired-turn-run-ownership.js';
import { isHumanMessageCloseReason } from './message-close-reasons.js';
import type { PairedRoomRole } from './types.js';

type ExecutorLog = Pick<typeof logger, 'info' | 'warn'>;

const PAIRED_TASK_EXECUTION_LEASE_HEARTBEAT_MS = 30_000;
const MISSING_VISIBLE_VERDICT_SUMMARY =
  'Execution completed without a visible terminal verdict.';

type PairedTaskRecord = NonNullable<ReturnType<typeof getPairedTaskById>>;

function releaseInterruptedPairedExecution(
  taskId: string,
  runId: string,
  log: ExecutorLog,
): void {
  log.info(
    { pairedTaskId: taskId, runId },
    'Released paired execution lease without counting a failure because a human message interrupted the turn',
  );
  try {
    releasePairedTaskExecutionLease({ taskId, runId });
  } catch (err) {
    log.warn(
      { pairedTaskId: taskId, runId, err },
      'Failed to release paired execution lease after human interruption',
    );
  }
}

function releaseDelegatedPairedExecution(
  context: PreparedPairedExecutionContext,
  runId: string,
  log: ExecutorLog,
): void {
  try {
    releasePairedTaskExecutionLease({ taskId: context.task.id, runId });
  } catch (err) {
    log.warn(
      { pairedTaskId: context.task.id, runId, err },
      'Failed to release paired execution lease for delegated fallback handoff',
    );
  }
}

function completeStoredExecution(
  taskId: string,
  role: PairedRoomRole,
  status: 'succeeded' | 'failed',
  runId: string,
  summary: string | null,
  verdict?: TurnVerdict | null,
): void {
  completePairedExecutionContext({
    taskId,
    role,
    status,
    runId,
    summary,
    ...(verdict ? { verdict } : {}),
  });
}

function insertTurnOutputWithVerdict(args: {
  taskId: string;
  turnNumber: number;
  role: PairedRoomRole;
  outputText: string;
  verdict?: TurnVerdict | null;
}): void {
  if (args.verdict) {
    insertPairedTurnOutput(
      args.taskId,
      args.turnNumber,
      args.role,
      args.outputText,
      undefined,
      args.verdict,
    );
    return;
  }

  insertPairedTurnOutput(
    args.taskId,
    args.turnNumber,
    args.role,
    args.outputText,
  );
}

function resolveFallbackTurnVerdict(
  sawOutput: boolean,
  verdict: TurnVerdict | null,
  summary: string | null,
): TurnVerdict | null {
  if (!sawOutput || (!verdict && !summary)) return null;
  return verdict ?? parseVisibleVerdict(summary);
}

async function notifyPairedCompletionIfNeeded(args: {
  task: PairedTaskRecord | null | undefined;
  chatJid: string;
  onOutput?: (output: AgentOutput) => Promise<void>;
}): Promise<void> {
  if (args.task?.status !== 'completed' || !args.task.completion_reason) return;
  const sender = getLastHumanMessageSender(args.chatJid);
  const mention = sender ? `<@${sender}>` : '';
  const notifications: Record<string, string> = {
    escalated: `${mention} ⚠️ 자동 해결 불가 — 확인이 필요합니다.`,
  };
  const message = notifications[args.task.completion_reason];
  if (!message) return;
  await args.onOutput?.({
    status: 'success',
    result: message,
    output: { visibility: 'public', text: message },
    phase: 'final',
  });
}

export interface PairedExecutionLifecycle {
  updateSummary(args: {
    outputText?: string | null;
    errorText?: string | null;
  }): void;
  recordFinalOutputBeforeDelivery(
    outputText: string,
    verdict?: TurnVerdict | null,
  ): boolean;
  completeImmediately(args: { status: 'succeeded' | 'failed' }): void;
  markDelegated(): void;
  markStatus(status: 'succeeded' | 'failed'): void;
  markSawOutput(sawOutput: boolean): void;
  getSummary(): string | null;
  asyncFinalize(): Promise<void>;
}

interface CreatePairedExecutionLifecycleArgs {
  pairedExecutionContext?: PreparedPairedExecutionContext;
  pairedTurnIdentity?: PairedTurnIdentity;
  completedRole: PairedRoomRole;
  chatJid: string;
  runId: string;
  enqueueMessageCheck: () => void;
  getDirectTerminalDeliveryText?: () => string | null;
  getCloseReason?: () => string | null;
  onOutput?: (output: AgentOutput) => Promise<void>;
  log: ExecutorLog;
}

export function createPairedExecutionLifecycle(
  args: CreatePairedExecutionLifecycleArgs,
): PairedExecutionLifecycle {
  const {
    pairedExecutionContext,
    pairedTurnIdentity,
    completedRole,
    chatJid,
    runId,
    enqueueMessageCheck,
    getDirectTerminalDeliveryText,
    getCloseReason,
    onOutput,
    log,
  } = args;

  let pairedExecutionStatus: 'succeeded' | 'failed' = 'failed';
  let pairedExecutionSummary: string | null = null;
  let pairedFinalOutput: string | null = null;
  let pairedFinalVerdict: TurnVerdict | null = null;
  let pairedSummaryLocked = false;
  let pairedExecutionCompleted = false;
  let pairedExecutionDelegated = false;
  let pairedSawOutput = false;
  let pairedTurnOutputPersisted = false;
  let pairedTurnStateFinalized = false;
  let leaseHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const requiresVisibleVerdict =
    pairedExecutionContext?.requiresVisibleVerdict === true;
  const wasInterruptedByHumanMessage = (): boolean =>
    isHumanMessageCloseReason(getCloseReason?.() ?? null);

  const currentRunOwnsActiveAttempt = (reason: string): boolean => {
    if (!pairedTurnIdentity) {
      return true;
    }
    const ownership = resolvePairedTurnRunOwnership({
      turnId: pairedTurnIdentity.turnId,
      runId,
    });
    if (ownership.state === 'active') {
      return true;
    }
    if (ownership.state === 'missing') {
      log.warn(
        {
          pairedTaskId: pairedExecutionContext?.task.id ?? null,
          turnId: pairedTurnIdentity.turnId,
          runId,
          reason,
        },
        'Could not verify paired turn attempt ownership before final side effects; keeping legacy behavior',
      );
      return true;
    }
    log.warn(
      {
        pairedTaskId: pairedExecutionContext?.task.id ?? null,
        turnId: pairedTurnIdentity.turnId,
        runId,
        reason,
        currentAttemptNo: ownership.currentAttemptNo,
        currentAttemptState: ownership.currentAttemptState,
        currentAttemptRunId: ownership.currentAttemptRunId,
      },
      'Skipping paired final side effects because this run no longer owns the active attempt',
    );
    return false;
  };

  const finalizePairedTurnState = (
    status: 'succeeded' | 'failed',
    errorText?: string | null,
  ) => {
    if (!pairedTurnIdentity || pairedTurnStateFinalized) {
      return;
    }
    if (status === 'succeeded') {
      completePairedTurn(pairedTurnIdentity);
    } else {
      failPairedTurn({
        turnIdentity: pairedTurnIdentity,
        error: errorText ?? pairedExecutionSummary,
      });
    }
    pairedTurnStateFinalized = true;
  };

  const clearLeaseHeartbeat = () => {
    if (!leaseHeartbeatTimer) {
      return;
    }
    clearInterval(leaseHeartbeatTimer);
    leaseHeartbeatTimer = null;
  };
  const heartbeatLeaseIfNeeded = () => {
    if (!pairedExecutionContext) {
      return;
    }
    try {
      const refreshed = refreshPairedTaskExecutionLease({
        taskId: pairedExecutionContext.task.id,
        runId,
      });
      if (!refreshed) {
        log.warn(
          {
            pairedTaskId: pairedExecutionContext.task.id,
            runId,
          },
          'Skipped paired execution lease heartbeat because this run no longer owns the lease',
        );
      }
    } catch (err) {
      log.warn(
        {
          pairedTaskId: pairedExecutionContext.task.id,
          runId,
          err,
        },
        'Failed to refresh paired execution lease heartbeat',
      );
    }
  };

  if (pairedExecutionContext) {
    leaseHeartbeatTimer = setInterval(
      heartbeatLeaseIfNeeded,
      PAIRED_TASK_EXECUTION_LEASE_HEARTBEAT_MS,
    );
    leaseHeartbeatTimer.unref?.();
  }

  const persistPairedTurnOutputIfNeeded = () => {
    if (
      !pairedExecutionContext ||
      pairedTurnOutputPersisted ||
      !pairedFinalOutput ||
      pairedFinalOutput.length === 0
    ) {
      return;
    }

    const turnNumber = getLatestTurnNumber(pairedExecutionContext.task.id) + 1;
    insertTurnOutputWithVerdict({
      taskId: pairedExecutionContext.task.id,
      turnNumber,
      role: completedRole,
      outputText: pairedFinalOutput,
      verdict: pairedFinalVerdict,
    });
    pairedTurnOutputPersisted = true;
  };

  const completeSuccessfulOwnerTurnBeforeDeliveryIfNeeded = () => {
    if (
      completedRole !== 'owner' ||
      !pairedExecutionContext ||
      pairedExecutionCompleted ||
      !pairedFinalOutput ||
      pairedFinalOutput.length === 0
    ) {
      return;
    }

    pairedExecutionStatus = 'succeeded';
    pairedSawOutput = true;
    persistPairedTurnOutputIfNeeded();
    clearLeaseHeartbeat();
    completePairedExecutionContext({
      taskId: pairedExecutionContext.task.id,
      role: completedRole,
      status: 'succeeded',
      runId,
      summary: pairedExecutionSummary,
      ...(pairedFinalVerdict ? { verdict: pairedFinalVerdict } : {}),
    });
    pairedExecutionCompleted = true;
  };

  const lockVisibleVerdict = (
    outputText: string,
    verdict?: TurnVerdict | null,
  ) => {
    if (outputText.length === 0) {
      return;
    }
    if (verdict) {
      pairedFinalVerdict = verdict;
    }
    if (!pairedFinalOutput || pairedFinalOutput.length === 0) {
      pairedFinalOutput = outputText;
    }
    if (!pairedSummaryLocked) {
      pairedExecutionSummary = outputText.slice(0, 500);
      pairedSummaryLocked = true;
    }
    pairedSawOutput = true;
  };

  const adoptDirectTerminalDeliveryIfNeeded = () => {
    const outputText = getDirectTerminalDeliveryText?.();
    if (!outputText || outputText.length === 0) {
      return null;
    }
    if (!pairedFinalOutput || pairedFinalOutput.length === 0) {
      lockVisibleVerdict(outputText);
      log.info(
        {
          pairedTaskId: pairedExecutionContext?.task.id ?? null,
          role: completedRole,
          runId,
        },
        'Adopted direct terminal delivery as paired final output',
      );
    } else if (!pairedSummaryLocked) {
      pairedExecutionSummary = pairedFinalOutput.slice(0, 500);
      pairedSummaryLocked = true;
    }
    return outputText;
  };

  return {
    updateSummary({ outputText, errorText }) {
      if (pairedSummaryLocked) {
        return;
      }

      if (outputText && outputText.length > 0) {
        pairedExecutionSummary = outputText.slice(0, 500);
        return;
      }

      if (errorText && errorText.length > 0) {
        pairedExecutionSummary = errorText.slice(0, 500);
      }
    },

    recordFinalOutputBeforeDelivery(outputText, verdict) {
      if (wasInterruptedByHumanMessage()) return false;
      if (!currentRunOwnsActiveAttempt('streamed-final-output')) {
        return false;
      }
      lockVisibleVerdict(outputText, verdict);
      completeSuccessfulOwnerTurnBeforeDeliveryIfNeeded();
      persistPairedTurnOutputIfNeeded();
      return true;
    },

    completeImmediately({ status }) {
      if (!pairedExecutionContext || pairedExecutionCompleted) {
        return;
      }

      pairedExecutionStatus = status;
      if (status === 'succeeded') {
        persistPairedTurnOutputIfNeeded();
      }

      clearLeaseHeartbeat();
      completePairedExecutionContext({
        taskId: pairedExecutionContext.task.id,
        role: completedRole,
        status,
        runId,
        summary: pairedExecutionSummary,
        ...(pairedFinalVerdict ? { verdict: pairedFinalVerdict } : {}),
      });
      pairedExecutionCompleted = true;
    },

    markDelegated() {
      pairedExecutionDelegated = true;
    },

    markStatus(status) {
      pairedExecutionStatus = status;
    },

    markSawOutput(sawOutput) {
      pairedSawOutput = sawOutput;
    },

    getSummary() {
      return pairedExecutionSummary;
    },

    async asyncFinalize() {
      clearLeaseHeartbeat();

      if (!currentRunOwnsActiveAttempt('async-finalize')) {
        return;
      }

      if (pairedExecutionContext && pairedExecutionDelegated) {
        releaseDelegatedPairedExecution(pairedExecutionContext, runId, log);
        pairedExecutionCompleted = true;
        return;
      }

      const directTerminalOutput = adoptDirectTerminalDeliveryIfNeeded();

      const missingVisibleVerdict =
        requiresVisibleVerdict &&
        (!pairedFinalOutput || pairedFinalOutput.length === 0);
      if (missingVisibleVerdict) {
        pairedExecutionSummary = MISSING_VISIBLE_VERDICT_SUMMARY;
        log.warn(
          {
            pairedTaskId: pairedExecutionContext?.task.id ?? null,
            role: completedRole,
            runId,
          },
          'Treating paired execution as failed because it ended without a visible terminal verdict',
        );
      }
      const effectiveStatus =
        completedRole === 'owner' &&
        pairedExecutionStatus === 'succeeded' &&
        !pairedSawOutput
          ? 'failed'
          : missingVisibleVerdict && pairedExecutionStatus === 'succeeded'
            ? 'failed'
            : pairedExecutionStatus;
      const sawOutputForFollowUp = missingVisibleVerdict
        ? false
        : pairedSawOutput;
      const interruptedByHumanMessage = wasInterruptedByHumanMessage();

      if (pairedExecutionContext && !pairedExecutionCompleted) {
        if (interruptedByHumanMessage) {
          releaseInterruptedPairedExecution(
            pairedExecutionContext.task.id,
            runId,
            log,
          );
        } else {
          if (effectiveStatus === 'succeeded') {
            try {
              persistPairedTurnOutputIfNeeded();
            } catch (err) {
              log.warn(
                { pairedTaskId: pairedExecutionContext.task.id, err },
                'Failed to store paired turn output',
              );
            }
          }
          completeStoredExecution(
            pairedExecutionContext.task.id,
            completedRole,
            effectiveStatus,
            runId,
            pairedExecutionSummary,
            pairedFinalVerdict,
          );
        }
        pairedExecutionCompleted = true;
      }

      finalizePairedTurnState(
        effectiveStatus,
        effectiveStatus === 'failed' ? pairedExecutionSummary : null,
      );

      if (!pairedExecutionContext) {
        return;
      }
      if (interruptedByHumanMessage) {
        return;
      }
      const finishedTask = getPairedTaskById(pairedExecutionContext.task.id);
      await notifyPairedCompletionIfNeeded({
        task: finishedTask,
        chatJid,
        onOutput,
      });

      const queueAction =
        directTerminalOutput &&
        (completedRole === 'reviewer' || completedRole === 'arbiter')
          ? 'none'
          : resolvePairedFollowUpQueueAction({
              completedRole,
              executionStatus: effectiveStatus,
              sawOutput: sawOutputForFollowUp,
              taskStatus: finishedTask?.status ?? null,
              outputSummary: pairedExecutionSummary,
              outputVerdict: pairedFinalVerdict,
            });
      if (queueAction !== 'pending' || !finishedTask) {
        return;
      }

      const followUpResult = enqueuePairedFollowUpAfterEvent({
        chatJid,
        runId,
        task: finishedTask,
        source: 'executor-recovery',
        completedRole,
        executionStatus: effectiveStatus,
        sawOutput: sawOutputForFollowUp,
        fallbackLastTurnOutputRole: sawOutputForFollowUp ? completedRole : null,
        fallbackLastTurnOutputVerdict: resolveFallbackTurnVerdict(
          sawOutputForFollowUp,
          pairedFinalVerdict,
          pairedExecutionSummary,
        ),
        enqueueMessageCheck,
      });
      if (followUpResult.kind !== 'paired-follow-up') {
        return;
      }
      log.info(
        {
          taskId: pairedExecutionContext.task.id,
          role: completedRole,
          pairedExecutionStatus: effectiveStatus,
          taskStatus: finishedTask.status,
          intentKind: followUpResult.intentKind,
          scheduled: followUpResult.scheduled,
        },
        followUpResult.scheduled
          ? 'Queued paired follow-up after failed reviewer/arbiter execution left a pending task state'
          : 'Skipped duplicate paired follow-up after failed reviewer/arbiter execution while task state was unchanged',
      );
    },
  };
}

/**
 * Audit Service — records the full audit trail for a processed event,
 * updates entity workflow state via the state machine, and maintains
 * per-cause attempt/cooldown/last-contact state (EntityCauseState).
 *
 * Implements a tamper-evident cryptographic hash chain across all AuditEntry records.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { logError } from "../config/logger";
import { getRuleForCause } from "../domain/policy";
import { isTerminal, nextState, WorkflowState } from "../domain/stateMachine";
import {
  computeEntryHash,
  GENESIS_HASH,
  HashableEntry,
} from "../domain/hashChain";
import {
  ActionResult,
  DecisionResult,
  DiagnosisResult,
  EnrichedRevenueEvent,
} from "../domain/types";
import { writeLedgerEntry } from "./ledgerService";

/**
 * Derive outcome from the action result for audit purposes.
 * recovered | pending | escalated | skipped | failed | written_off
 */
function deriveOutcome(action: ActionResult): string {
  if (action.result === "skipped") return "skipped";
  if (action.result === "failed") return "failed";
  if (action.actionType === "escalate_to_human") return "escalated";
  // Terminal write-off actions close the arc — they are not merely "pending".
  if (
    action.actionType === "hard_decline" ||
    action.actionType === "auto_cancel"
  ) {
    return "written_off";
  }
  // Email sent, payment link sent, retry initiated — not yet confirmed recovered
  return "pending";
}

/**
 * Map (actionType, result) to the state machine's action outcome string.
 * Returns null if no state transition should occur (e.g. failed action).
 */
function toStateMachineOutcome(action: ActionResult): string | null {
  if (action.result === "failed") return null;

  // Skipped with actionType 'none' means DNC or policy-blocked
  if (action.result === "skipped" && action.actionType === "none") {
    return "dnc_skip";
  }

  // Successful actions
  switch (action.actionType) {
    case "retry_payment":
    case "retry_payment_immediate":
    case "retry_payment_delayed":
      return "retry_initiated";
    case "send_reminder_email":
    case "send_soft_chase_email":
    case "send_dunning_email_1":
    case "send_dunning_email_2":
    case "send_dunning_email_3":
    case "send_reminder":
      return "email_sent";
    case "send_payment_link":
      return "payment_link_sent";
    case "escalate_to_human":
      return "escalation_triggered";
    // Terminal write-off actions — the state machine maps these to WRITTEN_OFF
    case "hard_decline":
      return "hard_decline";
    case "auto_cancel":
      return "auto_cancel";
    // Subscription lifecycle actions
    case "pause_subscription":
      return "subscription_paused";
    case "send_winback_offer":
      return "winback_sent";
    case "start_promise_to_pay_tracking":
      return "reminder_sent";
    default:
      return null;
  }
}

/**
 * Compute cooldown TTL in seconds from the policy rule's stopping config.
 * Falls back to 1 hour if no window is configured.
 */
function cooldownTtlSeconds(causeLabel: string): number {
  const rule = getRuleForCause(causeLabel);
  if (!rule) return 3600; // 1h default

  const stopping = rule.stopping;
  if (stopping.windowHours !== undefined) {
    return stopping.windowHours * 3600;
  }
  if (stopping.windowDays !== undefined) {
    return stopping.windowDays * 86400;
  }
  return 3600; // 1h default
}

export interface CreateChainedAuditEntryParams {
  eventId: string;
  entityId: string;
  actor: string;
  inputSnapshot: unknown;
  diagnosisSnapshot?: unknown;
  decisionSnapshot?: unknown;
  actionSnapshot?: unknown;
  outcome: string;
  timestamp?: Date;
}

/**
 * Writes an AuditEntry within an interactive Prisma transaction, chaining its
 * hash to the previous head and updating AuditChainHead with serializing row-lock.
 */
export async function writeChainedAuditEntry(
  tx: Prisma.TransactionClient,
  params: CreateChainedAuditEntryParams,
) {
  const now = params.timestamp ?? new Date();

  // Serialized row lock on AuditChainHead
  let head = await tx.$queryRaw<{ hash: string }[]>`
    SELECT hash FROM "AuditChainHead" WHERE id = 1 FOR UPDATE
  `;
  if (!head || head.length === 0) {
    await tx.auditChainHead.upsert({
      where: { id: 1 },
      create: { id: 1, hash: GENESIS_HASH },
      update: {},
    });
    head = [{ hash: GENESIS_HASH }];
  }
  const prevHash = head[0].hash;

  const hashableEntry: HashableEntry = {
    eventId: params.eventId,
    entityId: params.entityId,
    actor: params.actor,
    inputSnapshot: params.inputSnapshot,
    diagnosisSnapshot: params.diagnosisSnapshot,
    decisionSnapshot: params.decisionSnapshot,
    actionSnapshot: params.actionSnapshot,
    outcome: params.outcome,
    timestamp: now.toISOString(),
  };

  const hash = computeEntryHash(prevHash, hashableEntry);

  const row = await tx.auditEntry.create({
    data: {
      eventId: params.eventId,
      entityId: params.entityId,
      actor: params.actor,
      inputSnapshot: params.inputSnapshot as Prisma.InputJsonValue,
      diagnosisSnapshot: (params.diagnosisSnapshot ?? null) as Prisma.InputJsonValue,
      decisionSnapshot: (params.decisionSnapshot ?? null) as Prisma.InputJsonValue,
      actionSnapshot: (params.actionSnapshot ?? null) as Prisma.InputJsonValue,
      outcome: params.outcome,
      timestamp: now,
      prevHash,
      hash,
    },
  });

  await tx.auditChainHead.update({
    where: { id: 1 },
    data: { hash },
  });

  return row;
}

/**
 * Records the full audit entry for a processed event.
 *
 * Atomically creates the hash-chained AuditEntry, transitions EntityWorkflowState,
 * and updates per-cause attempt/cooldown/last-contact state in EntityCauseState.
 */
export async function recordAuditEntry(params: {
  event: EnrichedRevenueEvent;
  diagnosis: DiagnosisResult;
  decision: DecisionResult;
  action: ActionResult;
}): Promise<void> {
  const { event, diagnosis, decision, action } = params;
  const outcome = deriveOutcome(action);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // 1. Write chained AuditEntry row
    await writeChainedAuditEntry(tx, {
      eventId: event.id,
      entityId: event.entityId,
      actor: "system",
      inputSnapshot: event,
      diagnosisSnapshot: diagnosis,
      decisionSnapshot: decision,
      actionSnapshot: action,
      outcome,
      timestamp: now,
    });

    // 2. Update EntityWorkflowState via state machine
    const smOutcome = toStateMachineOutcome(action);
    let newState: WorkflowState | null = null;

    if (smOutcome) {
      const existing = await tx.entityWorkflowState.findUnique({
        where: { entityId: event.entityId },
      });

      const currentState = (existing?.state ?? "DETECTED") as WorkflowState;
      const effectiveCurrent = isTerminal(currentState) ? "DETECTED" : currentState;
      newState = nextState(effectiveCurrent, smOutcome);

      await tx.entityWorkflowState.upsert({
        where: { entityId: event.entityId },
        create: {
          entityId: event.entityId,
          customerId: event.customerId,
          state: newState,
        },
        update: {
          state: newState,
        },
      });

      // Closing the arc for this entity wipes ALL of its per-cause
      // attempt/cooldown history
      if (isTerminal(newState)) {
        await tx.entityCauseState.deleteMany({
          where: { entityId: event.entityId },
        });

        if (newState === "RECOVERED") {
          await writeLedgerEntry(tx, {
            entityId: event.entityId,
            eventId: event.id,
            type: "RECOVERED",
            amount: event.amount,
            currency: event.currency,
            referenceId: action.razorpayPaymentLinkId ?? action.paymentId,
          });
        } else if (newState === "WRITTEN_OFF") {
          await writeLedgerEntry(tx, {
            entityId: event.entityId,
            eventId: event.id,
            type: "WRITTEN_OFF",
            amount: event.amount,
            currency: event.currency,
          });
        }
      }
    }

    // 3. Per-cause attempt/cooldown tracking (only while arc is open)
    if (smOutcome && !isTerminal(newState ?? "DETECTED")) {
      const countsAsAttempt = action.result === "success";
      const startsCooldown = countsAsAttempt || action.result === "scheduled";
      const cooldownUntil = startsCooldown
        ? new Date(now.getTime() + cooldownTtlSeconds(diagnosis.causeLabel) * 1000)
        : undefined;
      const touchesCustomer = countsAsAttempt;

      await tx.entityCauseState.upsert({
        where: {
          entityId_causeLabel: {
            entityId: event.entityId,
            causeLabel: diagnosis.causeLabel,
          },
        },
        create: {
          entityId: event.entityId,
          causeLabel: diagnosis.causeLabel,
          attemptCount: countsAsAttempt ? 1 : 0,
          ...(touchesCustomer ? { lastContactedAt: now } : {}),
          cooldownUntil,
        },
        update: {
          ...(countsAsAttempt ? { attemptCount: { increment: 1 } } : {}),
          ...(touchesCustomer ? { lastContactedAt: now } : {}),
          ...(cooldownUntil ? { cooldownUntil } : {}),
        },
      });
    }
  });
}

/**
 * Fallback to record a failed-state audit entry securely into the hash chain.
 */
export async function recordFailureAuditEntry(
  event: { id: string; entityId: string },
  snapshots?: {
    inputSnapshot?: unknown;
    diagnosisSnapshot?: unknown;
    decisionSnapshot?: unknown;
    actionSnapshot?: unknown;
  },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await writeChainedAuditEntry(tx, {
      eventId: event.id,
      entityId: event.entityId,
      actor: "system",
      inputSnapshot: snapshots?.inputSnapshot ?? event,
      diagnosisSnapshot: snapshots?.diagnosisSnapshot,
      decisionSnapshot: snapshots?.decisionSnapshot,
      actionSnapshot: snapshots?.actionSnapshot,
      outcome: "failed",
      timestamp: new Date(),
    });
  });

  // Ensure the UI updates live to show the pipeline failure
  const { emitLiveUpdate } = require("../api/websocket");
  await emitLiveUpdate(event.id);
}

export interface VerifyChainResult {
  valid: boolean;
  entriesChecked: number;
  brokenAtEntryId?: string;
  brokenAtSequence?: number;
}

/**
 * Verifies cryptographic integrity of the audit trail between fromSequence and toSequence.
 */
export async function verifyChain(
  fromSequence = 1,
  toSequence?: number,
  batchSize = 500,
): Promise<VerifyChainResult> {
  let cursor = fromSequence;
  let expectedPrevHash: string | null = null;
  let checked = 0;

  // If starting mid-chain (fromSequence > 1), fetch row immediately before range
  if (fromSequence > 1) {
    const priorRow = await prisma.auditEntry.findFirst({
      where: { sequenceNumber: { lt: fromSequence } },
      orderBy: { sequenceNumber: "desc" },
    });
    expectedPrevHash = priorRow?.hash ?? GENESIS_HASH;
  } else {
    expectedPrevHash = GENESIS_HASH;
  }

  while (true) {
    const rows = await prisma.auditEntry.findMany({
      where: {
        sequenceNumber: {
          gte: cursor,
          ...(toSequence ? { lte: toSequence } : {}),
        },
      },
      orderBy: { sequenceNumber: "asc" },
      take: batchSize,
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.prevHash !== expectedPrevHash) {
        return {
          valid: false,
          entriesChecked: checked,
          brokenAtEntryId: row.id,
          brokenAtSequence: row.sequenceNumber,
        };
      }
      const hashable: HashableEntry = {
        eventId: row.eventId,
        entityId: row.entityId,
        actor: row.actor,
        inputSnapshot: row.inputSnapshot,
        diagnosisSnapshot: row.diagnosisSnapshot,
        decisionSnapshot: row.decisionSnapshot,
        actionSnapshot: row.actionSnapshot,
        outcome: row.outcome,
        timestamp:
          row.timestamp instanceof Date
            ? row.timestamp.toISOString()
            : new Date(row.timestamp).toISOString(),
      };
      const recomputed = computeEntryHash(row.prevHash, hashable);
      if (recomputed !== row.hash) {
        return {
          valid: false,
          entriesChecked: checked,
          brokenAtEntryId: row.id,
          brokenAtSequence: row.sequenceNumber,
        };
      }
      expectedPrevHash = row.hash;
      checked++;
    }
    cursor = rows[rows.length - 1].sequenceNumber + 1;
  }

  return { valid: true, entriesChecked: checked };
}

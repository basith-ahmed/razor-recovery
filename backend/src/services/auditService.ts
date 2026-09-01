import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { redis } from "../config/redis";
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

function deriveOutcome(action: ActionResult): string {
  if (action.result === "skipped") return "skipped";
  if (action.result === "failed") return "failed";
  if (action.actionType === "escalate_to_human") return "escalated";
  if (
    action.actionType === "hard_decline" ||
    action.actionType === "auto_cancel"
  ) {
    return "written_off";
  }
  return "pending";
}

function toStateMachineOutcome(
  action: ActionResult,
  decision?: DecisionResult,
  diagnosis?: DiagnosisResult,
): string | null {
  if (action.result === "failed") return null;

  if (action.result === "skipped" && action.actionType === "none") {
    if (decision?.reasoning?.includes("DNC") || diagnosis?.causeLabel === "dnc") {
      return "dnc_skip";
    }
    if (decision?.reasoning?.includes("cooldown")) {
      return "cooldown_started";
    }
    return null;
  }

  switch (action.actionType) {
    case "send_reminder_email":
    case "send_soft_chase_email":
    case "send_dunning_email_1":
    case "send_dunning_email_2":
    case "send_dunning_email_3":
      return "email_sent";
    case "escalate_to_human":
      return "escalation_triggered";
    case "hard_decline":
      return "hard_decline";
    case "auto_cancel":
      return "auto_cancel";
    case "pause_subscription":
      return "subscription_paused";
    case "send_winback_offer":
      return "winback_sent";
    case "start_promise_to_pay_tracking":
      return "promise_tracked";
    default:
      return null;
  }
}

function cooldownTtlSeconds(causeLabel: string): number {
  const rule = getRuleForCause(causeLabel);
  if (!rule) return 3600;

  const stopping = rule.stopping;
  if (stopping.windowHours !== undefined) {
    return stopping.windowHours * 3600;
  }
  if (stopping.windowDays !== undefined) {
    return stopping.windowDays * 86400;
  }
  return 3600;
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

export async function writeChainedAuditEntry(
  tx: Prisma.TransactionClient,
  params: CreateChainedAuditEntryParams,
) {
  const now = params.timestamp ?? new Date();

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

export async function recordAuditEntry(params: {
  event: EnrichedRevenueEvent;
  diagnosis: DiagnosisResult;
  decision: DecisionResult;
  action: ActionResult;
}) {
  const { event, diagnosis, decision, action } = params;
  const outcome = deriveOutcome(action);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const auditEntry = await writeChainedAuditEntry(tx, {
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

    const smOutcome = toStateMachineOutcome(action, decision, diagnosis);
    let newState: WorkflowState | null = null;

    if (smOutcome) {
      const existing = await tx.entityWorkflowState.findUnique({
        where: { entityId: event.entityId },
      });

      const currentState = (existing?.state ?? "DETECTED") as WorkflowState;
      const effectiveCurrent = isTerminal(currentState) ? "DETECTED" : currentState;
      newState = nextState(effectiveCurrent, smOutcome);

      const isTerm = isTerminal(newState);
      const countsAsAttempt = !isTerm && action.result === "success";
      const startsCooldown = !isTerm && (countsAsAttempt || action.result === "scheduled");
      const cooldownUntil = startsCooldown
        ? new Date(now.getTime() + cooldownTtlSeconds(diagnosis.causeLabel) * 1000)
        : isTerm ? null : undefined;
      const touchesCustomer = !isTerm && countsAsAttempt;

      await tx.entityWorkflowState.upsert({
        where: { entityId: event.entityId },
        create: {
          entityId: event.entityId,
          customerId: event.customerId,
          state: newState,
          attemptCount: countsAsAttempt ? 1 : 0,
          lastContactedAt: touchesCustomer ? now : null,
          cooldownUntil: cooldownUntil ?? null,
        },
        update: {
          state: newState,
          ...(isTerm
            ? {
                attemptCount: 0,
                lastContactedAt: null,
                cooldownUntil: null,
              }
            : {
                ...(countsAsAttempt ? { attemptCount: { increment: 1 } } : {}),
                ...(touchesCustomer ? { lastContactedAt: now } : {}),
                ...(cooldownUntil ? { cooldownUntil } : {}),
              }),
        },
      });

      if (isTerm) {
        await tx.entityCauseState.deleteMany({
          where: { entityId: event.entityId },
        });

        if (newState === "RECOVERED") {
          await redis.set(`razorrecovery:recovered:${event.entityId}`, "true", "EX", 86400 * 30);
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
      } else {
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
    }

    return auditEntry;
  });
}

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

  const { emitLiveUpdate } = require("../api/websocket");
  await emitLiveUpdate(event.id);
}

export interface VerifyChainResult {
  valid: boolean;
  entriesChecked: number;
  totalEntries: number;
  brokenAtEntryId?: string;
  brokenAtEntityId?: string;
  brokenAtSequence?: number;
  brokenReason?: "prev_hash_mismatch" | "content_hash_mismatch";
  verifiedAt: string;
}

export async function verifyChain(
  fromSequence?: number,
  toSequence?: number,
  batchSize = 500,
): Promise<VerifyChainResult> {
  const totalEntries = await prisma.auditEntry.count();
  const nowIso = new Date().toISOString();

  if (totalEntries === 0) {
    return {
      valid: true,
      entriesChecked: 0,
      totalEntries: 0,
      verifiedAt: nowIso,
    };
  }

  // Find the lowest sequence number in the database
  const firstAvailableRow = await prisma.auditEntry.findFirst({
    orderBy: { sequenceNumber: "asc" },
  });

  const startSeq = fromSequence ?? firstAvailableRow?.sequenceNumber ?? 1;
  let cursor = startSeq;
  let expectedPrevHash: string | null = null;
  let checked = 0;

  if (startSeq > (firstAvailableRow?.sequenceNumber ?? 1)) {
    const priorRow = await prisma.auditEntry.findFirst({
      where: { sequenceNumber: { lt: startSeq } },
      orderBy: { sequenceNumber: "desc" },
    });
    expectedPrevHash = priorRow?.hash ?? firstAvailableRow?.prevHash ?? GENESIS_HASH;
  } else {
    // Starting from the beginning of available rows
    expectedPrevHash = firstAvailableRow?.prevHash ?? GENESIS_HASH;
  }

  let isFirstRow = true;

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
      // If sequenceNumber === 1, prevHash MUST be GENESIS_HASH
      if (row.sequenceNumber === 1 && row.prevHash !== GENESIS_HASH) {
        return {
          valid: false,
          entriesChecked: checked,
          totalEntries,
          brokenAtEntryId: row.id,
          brokenAtEntityId: row.entityId,
          brokenAtSequence: row.sequenceNumber,
          brokenReason: "prev_hash_mismatch",
          verifiedAt: nowIso,
        };
      }

      // Check prevHash continuity
      if (!isFirstRow && row.prevHash !== expectedPrevHash) {
        return {
          valid: false,
          entriesChecked: checked,
          totalEntries,
          brokenAtEntryId: row.id,
          brokenAtEntityId: row.entityId,
          brokenAtSequence: row.sequenceNumber,
          brokenReason: "prev_hash_mismatch",
          verifiedAt: nowIso,
        };
      }

      isFirstRow = false;

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
          totalEntries,
          brokenAtEntryId: row.id,
          brokenAtEntityId: row.entityId,
          brokenAtSequence: row.sequenceNumber,
          brokenReason: "content_hash_mismatch",
          verifiedAt: nowIso,
        };
      }

      expectedPrevHash = row.hash;
      checked++;
    }
    cursor = rows[rows.length - 1].sequenceNumber + 1;
  }

  return {
    valid: true,
    entriesChecked: checked,
    totalEntries,
    verifiedAt: nowIso,
  };
}

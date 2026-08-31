import { prisma } from "../config/prisma";
import { EntityType, EventType } from "@prisma/client";
import { escalateToHuman } from "../integrations/ticketMock";
import { recordAuditEntry } from "../services/auditService";
import { EnrichedRevenueEvent } from "../domain/types";
import crypto from "crypto";

async function main() {
  console.log("==================================================");
  console.log("   Selecting and Escalating Active Entity");
  console.log("==================================================\n");

  // Find all workflow states
  const workflowStates = await prisma.entityWorkflowState.findMany();
  const stateByEntity = new Map(workflowStates.map((s) => [s.entityId, s.state]));

  // Find existing revenue events
  const events = await prisma.revenueEvent.findMany({
    orderBy: { occurredAt: "desc" },
    include: {
      customer: true,
      diagnosis: true,
      decision: true,
      action: true,
    },
    take: 30,
  });

  // Pick an existing entity that is in DETECTED / CONTACTED / RETRYING / COOLING_DOWN
  let candidate = events.find((e) => {
    const currentState = stateByEntity.get(e.entityId) || "DETECTED";
    return (
      e.customer &&
      !e.customer.dncFlag &&
      ["DETECTED", "CONTACTED", "RETRYING", "COOLING_DOWN"].includes(currentState)
    );
  });

  let entityId: string;
  let customer: any;
  let amount: number;
  let entityType: EntityType = "INVOICE";
  let eventType: EventType = "INVOICE_OVERDUE";
  let priorCause: string;

  if (candidate && candidate.customer) {
    entityId = candidate.entityId;
    customer = candidate.customer;
    amount = candidate.amount;
    entityType = candidate.entityType;
    eventType = candidate.eventType;
    priorCause = candidate.diagnosis?.causeLabel || candidate.errorReason || "insufficient_funds";
    console.log(`Found Active Entity in DB:`);
  } else {
    console.log(`No non-escalated entity found in recent events. Creating a fresh active entity...`);
    let cust = await prisma.customer.findFirst({ where: { dncFlag: false } });
    if (!cust) {
      cust = await prisma.customer.create({
        data: {
          name: "Arjun Verma",
          email: "arjun.verma@example.test",
          phone: "+919876543210",
          riskTier: "medium",
          lifetimeValue: 62000,
        },
      });
    }
    entityId = `inv_demo_${crypto.randomUUID().slice(0, 8)}`;
    customer = cust;
    amount = 24500;
    entityType = "INVOICE";
    eventType = "INVOICE_OVERDUE";
    priorCause = "insufficient_funds";

    await prisma.invoice.create({
      data: {
        id: entityId,
        customerId: cust.id,
        amount,
        dueDate: new Date(Date.now() - 7 * 86400000),
        status: "open",
      },
    });

    await prisma.revenueEvent.create({
      data: {
        entityType,
        entityId,
        customerId: cust.id,
        eventType,
        amount,
        currency: "INR",
        occurredAt: new Date(Date.now() - 5 * 86400000),
        errorReason: priorCause,
        rawPayload: { attempt: 1 },
      },
    });
  }

  console.log(`- Entity ID:   ${entityId} (${entityType})`);
  console.log(`- Customer:    ${customer.name} (${customer.email})`);
  console.log(`- Amount:      ₹${amount.toLocaleString("en-IN")}`);
  console.log(`- Prior Cause: ${priorCause}\n`);

  // Step 1: Simulate prior automated dunning attempts reaching limit (attemptCount: 3)
  console.log("1. Simulating prior automated dunning exhaustion (3 failed attempts)...");
  const now = new Date();

  await prisma.entityCauseState.upsert({
    where: {
      entityId_causeLabel: {
        entityId,
        causeLabel: priorCause,
      },
    },
    create: {
      entityId,
      causeLabel: priorCause,
      attemptCount: 3,
      lastContactedAt: now,
      cooldownUntil: new Date(now.getTime() + 7 * 86400000),
    },
    update: {
      attemptCount: 3,
      lastContactedAt: now,
    },
  });

  // Step 2: Create the escalation event representing policy budget exhaustion
  const escalationReason = `Automated dunning limit exceeded (3/3 attempts failed for cause '${priorCause}') — manual agent outreach required.`;

  const escalationEvent = await prisma.revenueEvent.create({
    data: {
      id: crypto.randomUUID(),
      entityType,
      entityId,
      customerId: customer.id,
      eventType,
      amount,
      currency: "INR",
      occurredAt: now,
      errorCode: "BAD_REQUEST_ERROR",
      errorReason: priorCause,
      rawPayload: {
        escalated: true,
        attemptCount: 3,
        maxAttemptsReached: true,
        escalationReason,
      },
      riskScore: 0.88,
      urgency: 0.9,
      diagnosis: {
        create: {
          causeLabel: priorCause,
          confidence: 1.0,
          method: "RULE",
          reasoning: `Policy stopping rule triggered onMaxAction: escalate_to_human after 3 exhausted automated retries.`,
        },
      },
      decision: {
        create: {
          legalActions: ["escalate_to_human"],
          chosenAction: "escalate_to_human",
          reasoning: `Stopping condition maxAttempts (3) reached for ${priorCause}. Policy mandates immediate human escalation.`,
          policyVersion: "1.0.0",
        },
      },
    },
    include: {
      diagnosis: true,
      decision: true,
    },
  });

  console.log(`2. Escalation Event Persisted: ID ${escalationEvent.id}`);

  // Step 3: Execute escalate_to_human action -> creates Ticket & initial note
  console.log("3. Executing escalate_to_human action...");
  const actionResult = await escalateToHuman(entityId, escalationReason);
  console.log(`   - Action: ${actionResult.actionType} (${actionResult.result})`);
  console.log(`   - Ticket Created: ${actionResult.detail}`);

  // Persist Action record
  await prisma.action.create({
    data: {
      eventId: escalationEvent.id,
      actionType: "escalate_to_human",
      result: "success",
      integration: "MOCK",
    },
  });

  // Step 4: Record Audit Entry and transition Workflow State to ESCALATED
  console.log("4. Recording Hash-Chained Audit Entry and updating EntityWorkflowState to ESCALATED...");
  const enrichedEvent: EnrichedRevenueEvent = {
    id: escalationEvent.id,
    entityType: escalationEvent.entityType,
    entityId: escalationEvent.entityId,
    customerId: escalationEvent.customerId,
    eventType: escalationEvent.eventType,
    amount: escalationEvent.amount,
    currency: escalationEvent.currency,
    occurredAt: escalationEvent.occurredAt.toISOString(),
    razorpayPaymentId: escalationEvent.razorpayPaymentId ?? undefined,
    razorpayOrderId: escalationEvent.razorpayOrderId ?? undefined,
    errorCode: escalationEvent.errorCode ?? undefined,
    errorReason: escalationEvent.errorReason ?? undefined,
    rawPayload: escalationEvent.rawPayload as Record<string, unknown>,
    riskScore: 0.88,
    urgency: 0.9,
  };

  const auditEntry = await recordAuditEntry({
    event: enrichedEvent,
    diagnosis: {
      causeLabel: escalationEvent.diagnosis!.causeLabel,
      confidence: escalationEvent.diagnosis!.confidence,
      method: escalationEvent.diagnosis!.method,
      reasoning: escalationEvent.diagnosis!.reasoning ?? undefined,
    },
    decision: {
      legalActions: ["escalate_to_human"],
      chosenAction: "escalate_to_human",
      reasoning: escalationEvent.decision!.reasoning,
      policyVersion: "1.0.0",
    },
    action: actionResult,
  });

  const ticket = await prisma.ticket.findUnique({
    where: { id: actionResult.detail },
    include: { notes: true },
  });

  console.log("\n==================================================");
  console.log("   Entity Escalation Successfully Completed!");
  console.log("==================================================");
  console.log(`Entity ID:      ${entityId}`);
  console.log(`Customer:       ${customer.name} (${customer.email}, ${customer.phone || "No phone"})`);
  console.log(`Amount:         ₹${amount.toLocaleString("en-IN")}`);
  console.log(`Workflow State: ESCALATED`);
  console.log(`Ticket ID:      ${ticket?.id}`);
  console.log(`Ticket Status:  ${ticket?.status.toUpperCase()}`);
  console.log(`Audit Entry:    #${auditEntry.sequenceNumber} (Hash: ${auditEntry.hash.slice(0, 16)}...)`);
  console.log(`Notes Count:    ${ticket?.notes.length}`);
  console.log("==================================================");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Escalation failed:", err);
  process.exit(1);
});

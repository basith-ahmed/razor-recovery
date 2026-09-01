/**
 * Script: runDemo.ts
 *
 * Linear, Enter-driven demo driver for the revenue-leakage engine. Every
 * event is pushed through the REAL production ingestion path —
 * POST /api/v1/events with the partner API key — exactly like a connected
 * cart / invoice / subscription service would. Manual escalation and
 * payments also go over the wire (entities API / signed Razorpay webhook).
 *
 * Press Enter to fire the next step; Ctrl+C to quit at any point.
 *
 * Prerequisites:
 *   1. Infra up (docker compose) + backend running:   npm run dev
 *   2. Demo customers seeded:                         npm run reset
 *
 * Usage:  npx tsx src/scripts/runDemo.ts   (or: npm run demo)
 */

import crypto from "crypto";
import readline from "readline";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { redis } from "../config/redis";
import { REDIS_PREFIX } from "../utils/redisUtils";
import {
  buildCartEnvelope,
  buildInvoiceEnvelope,
  buildSubscriptionEnvelope,
} from "../simulator/partnerEvents";
import { EventEnvelope } from "../domain/eventEnvelope";
import { IngestResult } from "../services/ingestService";
import { simulatePaymentForEntity } from "./simulateWebhookPayment";
import type { Customer } from "@prisma/client";

const API_BASE = `http://localhost:${env.PORT}`;

interface StepResult {
  line: string;
}

const summary: string[] = [];

// Fresh ref namespace per run: each run tells its own story on clean entities,
// while repeats WITHIN a run still target the same entity.
const RUN = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
const REFS = {
  ladder: `demo_inv_ladder_${RUN}`,
  cartLow: `demo_cart_low_${RUN}`,
  cartHigh: `demo_cart_high_${RUN}`,
  dnc: `demo_inv_dnc_${RUN}`,
  subLow: `demo_sub_low_${RUN}`,
  subHigh: `demo_sub_high_${RUN}`,
};

function header(title: string): void {
  console.log(`\n━━━ ${title} ━━━`);
}

async function pickCustomer(requireDnc: boolean): Promise<Customer> {
  // Only seeded demo customers (@example.test domain) — keeps out any
  // hand-created or test-fixture customers that may sit in the dev database.
  const customers = await prisma.customer.findMany({
    where: { email: { endsWith: "@example.test" } },
    orderBy: { createdAt: "asc" },
  });
  const match = customers.find((c) => c.dncFlag === requireDnc);
  if (!match) {
    throw new Error(
      requireDnc
        ? "No DNC customer found — run `npm run reset` to seed demo customers first."
        : "No customers found — run `npm run reset` first."
    );
  }
  return match;
}

async function ingestOverHttp(envelope: EventEnvelope): Promise<IngestResult> {
  const res = await fetch(`${API_BASE}/api/v1/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.PARTNER_API_KEY,
    },
    body: JSON.stringify(envelope),
  });
  const body = await res.json();
  if (res.status !== 200) {
    throw new Error(`Ingest failed (HTTP ${res.status}): ${JSON.stringify(body)}`);
  }
  return body as IngestResult;
}

async function escalateOverHttp(
  entityId: string,
  reason: string
): Promise<{ ticketId: string | null }> {
  const res = await fetch(`${API_BASE}/api/v1/entities/${entityId}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason, agentName: "Demo Operator" }),
  });
  const body = (await res.json()) as { ticketId?: string };
  if (res.status !== 200) {
    throw new Error(`Escalation failed (HTTP ${res.status}): ${JSON.stringify(body)}`);
  }
  return { ticketId: body.ticketId ?? null };
}

/** Waits until the executor has persisted an action row for the event. */
async function waitForPipeline(eventId: string, timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const action = await prisma.action.findUnique({ where: { eventId } });
    if (action) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

interface EventOutcomeView {
  causeLabel: string | null;
  actionType: string | null;
  result: string | null;
  reasoning: string | null;
  outcome: string | null;
  state: string | null;
}

async function readOutcome(eventId: string, entityId: string): Promise<EventOutcomeView> {
  const event = await prisma.revenueEvent.findUnique({
    where: { id: eventId },
    include: { diagnosis: true, decision: true, action: true },
  });
  const audit = await prisma.auditEntry.findFirst({
    where: { eventId },
    orderBy: { sequenceNumber: "desc" },
  });
  const workflow = await prisma.entityWorkflowState.findUnique({ where: { entityId } });
  return {
    causeLabel: event?.diagnosis?.causeLabel ?? null,
    actionType: event?.action?.actionType ?? null,
    result: event?.action?.result ?? null,
    reasoning: event?.decision?.reasoning ?? null,
    outcome: audit?.outcome ?? null,
    state: workflow?.state ?? null,
  };
}

async function runEventStep(
  title: string,
  build: (customer: Customer) => EventEnvelope,
  requireDncCustomer = false
): Promise<StepResult> {
  header(title);
  const customer = await pickCustomer(requireDncCustomer);
  const envelope = build(customer);
  const result = await ingestOverHttp(envelope);
  const settled = await waitForPipeline(result.eventId);
  if (!settled) {
    console.log("⚠️  Pipeline did not settle within 30s — check consumers are running.");
    return { line: "⚠️ pipeline timeout" };
  }
  const view = await readOutcome(result.eventId, result.entityId);
  const block = envelope as unknown as Record<string, { ref?: string; amount?: number } | undefined>;
  const ref = block.cart?.ref ?? block.invoice?.ref ?? block.subscription?.ref ?? result.entityId;
  const amount = block.cart?.amount ?? block.invoice?.amount ?? block.subscription?.amount ?? 0;
  console.log(`  entity ${ref} | ₹${amount} | customer ${customer.dncFlag ? "DNC ⛔" : customer.name}`);
  console.log(`  → cause: ${view.causeLabel} | action: ${view.actionType} (${view.result})`);
  console.log(`  → outcome: ${view.outcome} | workflow state: ${view.state}`);
  if (view.reasoning) console.log(`  → decision: ${view.reasoning}`);
  return {
    line: `${ref} ₹${amount} → ${view.causeLabel} → ${view.actionType} → ${view.outcome} (${view.state})`,
  };
}

/**
 * Simulates the production clock: expires the entity's contact cooldown
 * (Redis lock + persisted cooldown timestamps) the same way 7 real days
 * would, so the next report lands outside the window and the dunning
 * ladder advances to its next rung.
 */
async function advanceCooldown(entityId: string): Promise<void> {
  await redis.del(`${REDIS_PREFIX}:cooldown:${entityId}`);
  const past = new Date(Date.now() - 1000);
  await prisma.entityWorkflowState.updateMany({
    where: { entityId },
    data: { cooldownUntil: past },
  });
  await prisma.entityCauseState.updateMany({
    where: { entityId },
    data: { cooldownUntil: past },
  });
}

function nextHint(text: string): void {
  console.log(`\n⏭  next: ${text}`);
}

async function awaitEnter(): Promise<void> {
  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("", () => {
      rl.close();
      resolve();
    });
  });
}

// ── Steps ────────────────────────────────────────────────────────────────────

const steps: Array<{ title: string; run: () => Promise<StepResult | void> }> = [
  {
    title: "Step 1 — Invoice overdue, first report (₹32,000, 9 days late)",
    run: async () => {
      const r = await runEventStep(
        "Step 1 — Invoice overdue, first report",
        (c) => buildInvoiceEnvelope(c, { ref: REFS.ladder, amount: 32000, age: 9 })
      );
      summary.push(`1    ${r.line}`);
      nextHint("re-report the same invoice → expect a cooldown skip");
    },
  },
  {
    title: "Step 2 — Same invoice re-reported (new occurrence, same leak)",
    run: async () => {
      const r = await runEventStep(
        "Step 2 — Same invoice re-reported (new occurrence, same leak)",
        (c) => buildInvoiceEnvelope(c, { ref: REFS.ladder, amount: 32000, age: 10 })
      );
      summary.push(`2    ${r.line}`);
      nextHint("simulate 7 days passing, then re-report → dunning rung 2 (soft chase)");
    },
  },
  {
    title: "Step 3 — ⏩ Time-travel: cooldown lapses, invoice re-reported (attempt 2)",
    run: async () => {
      header("Step 3 — ⏩ Time-travel: cooldown lapses, invoice re-reported");
      await advanceCooldown(REFS.ladder);
      console.log("  cooldown expired (Redis lock cleared, persisted timestamps backdated)");
      const r = await runEventStep(
        "Step 3b — Invoice re-reported after the cooldown window",
        (c) => buildInvoiceEnvelope(c, { ref: REFS.ladder, amount: 32000, age: 16 })
      );
      summary.push(`3    ${r.line}`);
      nextHint("push a low-value abandoned cart (₹1,899)");
    },
  },
  {
    title: "Step 4 — Low-value abandoned cart (₹1,899)",
    run: async () => {
      const r = await runEventStep(
        "Step 4 — Low-value abandoned cart",
        (c) => buildCartEnvelope(c, { ref: REFS.cartLow, amount: 1899, age: 5 })
      );
      summary.push(`4    ${r.line}`);
      nextHint("push a high-value abandoned cart (₹18,400 ≥ ₹10,000) → expect escalation");
    },
  },
  {
    title: "Step 5 — High-value abandoned cart (₹18,400 ≥ ₹10,000 policy threshold)",
    run: async () => {
      const r = await runEventStep(
        "Step 5 — High-value abandoned cart",
        (c) => buildCartEnvelope(c, { ref: REFS.cartHigh, amount: 18400, age: 6 })
      );
      summary.push(`5    ${r.line}`);
      nextHint("push an overdue invoice for the DNC customer → expect a compliance skip");
    },
  },
  {
    title: "Step 6 — DNC customer invoice (₹32,000) → compliance skip",
    run: async () => {
      const r = await runEventStep(
        "Step 6 — DNC customer invoice (compliance skip)",
        (c) => buildInvoiceEnvelope(c, { ref: REFS.dnc, amount: 32000, age: 12 }),
        true
      );
      summary.push(`6    ${r.line}`);
      nextHint("operator manually escalates the DNC entity through the API");
    },
  },
  {
    title: "Step 7 — Operator manually escalates the DNC entity (API call)",
    run: async () => {
      header("Step 7 — Operator manually escalates the DNC entity");
      const escalation = await escalateOverHttp(
        REFS.dnc,
        "Compliance-approved manual outreach: agent will make a supervised recovery call."
      );
      console.log(`  → ticket ${escalation.ticketId} | workflow state: ESCALATED`);
      console.log("  → chained audit entry written with cause dnc_manual_override");
      summary.push(`7    ${REFS.dnc} manually escalated → ESCALATED (ticket ${escalation.ticketId})`);
      nextHint("partner re-reports the same DNC invoice → expect skip, entity stays ESCALATED");
    },
  },
  {
    title: "Step 8 — Partner re-reports the escalated DNC invoice (ignored)",
    run: async () => {
      const r = await runEventStep(
        "Step 8 — Partner re-reports the escalated DNC invoice",
        (c) => buildInvoiceEnvelope(c, { ref: REFS.dnc, amount: 32000, age: 13 }),
        true
      );
      summary.push(`8    ${r.line}`);
      nextHint("push a low-value subscription mandate cancellation (₹1,499/mo)");
    },
  },
  {
    title: "Step 9 — Subscription mandate cancelled (₹1,499/mo plan)",
    run: async () => {
      const r = await runEventStep(
        "Step 9 — Subscription mandate cancelled (low value)",
        (c) =>
          buildSubscriptionEnvelope(c, { ref: REFS.subLow, amount: 1499, mandateStatus: "cancelled" })
      );
      summary.push(`9    ${r.line}`);
      nextHint("push a high-value mandate cancellation (₹14,999) → LLM weighs LTV: winback offer (20% off) or escalate");
    },
  },
  {
    title: "Step 10 — High-value mandate cancelled (LLM weighs LTV → winback/escalate)",
    run: async () => {
      const r = await runEventStep(
        "Step 10 — High-value mandate cancelled",
        (c) =>
          buildSubscriptionEnvelope(c, { ref: REFS.subHigh, amount: 14999, mandateStatus: "cancelled" })
      );
      summary.push(`10   ${r.line}`);
      nextHint("customer pays the low-value cart (signed Razorpay webhook)");
    },
  },
  {
    title: "Step 11 — 💳 Customer pays the low-value cart (signed webhook)",
    run: async () => {
      header("Step 11 — 💳 Customer pays the low-value cart");
      const payment = await simulatePaymentForEntity(REFS.cartLow);
      console.log(`  → ${payment.eventName} (HTTP ${payment.httpStatus})`);
      console.log(`  → state: ${payment.stateBefore} → ${payment.stateAfter} | audit outcome: ${payment.latestAuditOutcome}`);
      if (payment.ok) console.log(`  → ledger RECOVERED entry logged (ref: ${payment.ledgerReferenceId})`);
      else console.log("  ⚠️ payment did not land as RECOVERED — check backend logs.");
      summary.push(`11   ${REFS.cartLow} paid via webhook → ${payment.stateAfter}`);
      nextHint("partner re-reports the paid cart → expect everything ignored, state stays RECOVERED");
    },
  },
  {
    title: "Step 12 — Duplicate event on the paid cart (everything ignored)",
    run: async () => {
      const r = await runEventStep(
        "Step 12 — Duplicate event on the paid cart",
        (c) => buildCartEnvelope(c, { ref: REFS.cartLow, amount: 1899, age: 6 })
      );
      summary.push(`12   ${r.line}`);
    },
  },
];

async function printSummary(): Promise<void> {
  console.log("\n━━━ Demo summary ━━━");
  for (const line of summary) console.log(`  ${line}`);
  console.log("\nEscalated tickets → resolve from the dashboard (recover / write-off):");
  console.log("  frontend: http://localhost:3000   |   mail preview: http://localhost:8025 (MailHog)");
}

async function preflight(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   RazorRecovery — Revenue Leakage Demo Driver    ║");
  console.log("╚══════════════════════════════════════════════════╝");

  if (!(await preflight())) {
    console.error(`\n❌ Backend not reachable at ${API_BASE}.`);
    console.error("   Start it with `npm run dev` in backend/ (consumers boot with it).");
    process.exit(1);
  }
  console.log(`✅ Backend reachable at ${API_BASE} — every step below uses the real ingest API.`);
  console.log(`   Run namespace: ${RUN} (fresh entities; repeats within this run hit the same one).`);

  nextHint("send the first event: an invoice overdue report");

  for (const step of steps) {
    await awaitEnter();
    try {
      await step.run();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ Step failed: ${msg}`);
    }
  }

  await awaitEnter();
  await printSummary();
  await prisma.$disconnect();
  await redis.disconnect();
}

main().catch((err: unknown) => {
  console.error("Demo driver crashed:", err);
  process.exit(1);
});

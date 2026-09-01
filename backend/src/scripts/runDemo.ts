/**
 * Script: runDemo.ts
 *
 * Interactive, beat-by-beat demo driver for the revenue-leakage engine.
 * Every event is pushed through the REAL production ingestion path —
 * POST /api/v1/events with the partner API key — exactly like a connected
 * cart / invoice / subscription service would. Manual escalation and
 * payments also go over the wire (entities API / signed Razorpay webhook).
 *
 * Prerequisites:
 *   1. Infra up (docker compose) + backend running:   npm run dev
 *   2. Pipeline consumers running:                    npm run start-consumers
 *   3. Demo customers seeded:                         npm run reset
 *
 * Usage:  npx tsx src/scripts/runDemo.ts
 */

import crypto from "crypto";
import readline from "readline";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import {
  buildCartEnvelope,
  buildInvoiceEnvelope,
  buildSubscriptionEnvelope,
  SimulationOverrides,
} from "../simulator/partnerEvents";
import { EventEnvelope } from "../domain/eventEnvelope";
import { IngestResult } from "../services/ingestService";
import { simulatePaymentForEntity } from "./simulateWebhookPayment";
import type { Customer } from "@prisma/client";

const API_BASE = `http://localhost:${env.PORT}`;

interface BeatSummary {
  beat: string;
  line: string;
}

const summaries: BeatSummary[] = [];

function header(title: string): void {
  console.log(`\n━━━ ${title} ━━━`);
}

/** Picks a seeded customer: non-DNC by default, DNC one for the DNC beat. */
async function pickCustomer(requireDnc: boolean): Promise<Customer> {
  const customers = await prisma.customer.findMany({ orderBy: { createdAt: "asc" } });
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
async function waitForPipeline(eventId: string, timeoutMs = 20000): Promise<boolean> {
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

async function runBeat(
  label: string,
  build: (customer: Customer) => EventEnvelope,
  requireDncCustomer = false
): Promise<IngestResult> {
  header(label);
  const customer = await pickCustomer(requireDncCustomer);
  const envelope = build(customer);
  const result = await ingestOverHttp(envelope);
  const settled = await waitForPipeline(result.eventId);
  if (!settled) {
    console.log(`⚠️  Pipeline did not settle within 20s for event ${result.eventId}.`);
    summaries.push({ beat: label, line: "⚠️ pipeline timeout" });
    return result;
  }
  const view = await readOutcome(result.eventId, result.entityId);
  const envelopeBlock = envelope as unknown as Record<string, { ref?: string; amount?: number } | undefined>;
  const ref = (envelopeBlock.cart?.ref ?? envelopeBlock.invoice?.ref ?? envelopeBlock.subscription?.ref) ?? result.entityId;
  const amount = envelopeBlock.cart?.amount ?? envelopeBlock.invoice?.amount ?? envelopeBlock.subscription?.amount ?? 0;
  console.log(`  entity ${ref} | ₹${amount} | customer ${customer.dncFlag ? "DNC ⛔" : customer.name}`);
  console.log(`  → cause: ${view.causeLabel} | action: ${view.actionType} (${view.result})`);
  console.log(`  → outcome: ${view.outcome} | workflow state: ${view.state}`);
  if (view.reasoning) console.log(`  → decision: ${view.reasoning}`);
  summaries.push({
    beat: label,
    line: `${ref} ₹${amount} → ${view.causeLabel} → ${view.actionType} → ${view.outcome} (${view.state})`,
  });
  return result;
}

async function awaitEnter(): Promise<void> {
  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("\n↵ press Enter to continue...", () => {
      rl.close();
      resolve();
    });
  });
}

// ── Beats ────────────────────────────────────────────────────────────────────

// Fresh ref namespace per run: each run tells its own story on clean entities,
// while repeats WITHIN a run (1a→1b, 4a→4c, 7b) still target the same entity.
const RUN = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
const REFS = {
  ladder: `demo_inv_ladder_${RUN}`,
  cartLow: `demo_cart_low_${RUN}`,
  cartHigh: `demo_cart_high_${RUN}`,
  dnc: `demo_inv_dnc_${RUN}`,
  subLow: `demo_sub_low_${RUN}`,
  subHigh: `demo_sub_high_${RUN}`,
};

/** Beat 1: invoice overdue reported twice — contact, then cooldown skip. */
async function beatInvoiceLadder(): Promise<void> {
  await runBeat(
    "Beat 1a — Invoice overdue, first report (₹32,000, 9 days late)",
    (c) => buildInvoiceEnvelope(c, { ref: REFS.ladder, amount: 32000, age: 9 })
  );
  await runBeat(
    "Beat 1b — Same invoice re-reported (new occurrence, same leak)",
    (c) => buildInvoiceEnvelope(c, { ref: REFS.ladder, amount: 32000, age: 10 })
  );
}

async function beatCartLow(): Promise<IngestResult> {
  return runBeat(
    "Beat 2 — Low-value abandoned cart (₹1,899)",
    (c) => buildCartEnvelope(c, { ref: REFS.cartLow, amount: 1899, age: 5 })
  );
}

async function beatCartHigh(): Promise<IngestResult> {
  return runBeat(
    "Beat 3 — High-value abandoned cart (₹18,400 ≥ ₹10,000 policy threshold)",
    (c) => buildCartEnvelope(c, { ref: REFS.cartHigh, amount: 18400, age: 6 })
  );
}

/** Beat 4: DNC skip → manual operator escalation → duplicate ignored. */
async function beatDncLifecycle(): Promise<void> {
  await runBeat(
    "Beat 4a — Invoice overdue for DNC customer (₹32,000)",
    (c) => buildInvoiceEnvelope(c, { ref: REFS.dnc, amount: 32000, age: 12 }),
    true
  );
  const entity = await prisma.revenueEvent.findFirst({
    where: { entityId: REFS.dnc },
    orderBy: { occurredAt: "desc" },
  });
  if (!entity) return;
  header("Beat 4b — Operator manually escalates the DNC entity via the API");
  const escalation = await escalateOverHttp(
    REFS.dnc,
    "Compliance-approved manual outreach: agent will make a supervised recovery call."
  );
  console.log(`  → ticket ${escalation.ticketId} | workflow state: ESCALATED (dnc_manual_override audit entry)`);
  summaries.push({ beat: "Beat 4b", line: `${REFS.dnc} manually escalated → ESCALATED` });
  await runBeat(
    "Beat 4c — Partner re-reports the same DNC invoice (already escalated)",
    (c) => buildInvoiceEnvelope(c, { ref: REFS.dnc, amount: 32000, age: 13 }),
    true
  );
}

async function beatSubLow(): Promise<IngestResult> {
  return runBeat(
    "Beat 5 — Subscription mandate cancelled (₹1,499/mo plan)",
    (c) => buildSubscriptionEnvelope(c, { ref: REFS.subLow, amount: 1499, mandateStatus: "cancelled" })
  );
}

async function beatSubHigh(): Promise<IngestResult> {
  return runBeat(
    "Beat 6 — High-value mandate cancelled (₹14,999 ≥ ₹10,000 → negotiate)",
    (c) => buildSubscriptionEnvelope(c, { ref: REFS.subHigh, amount: 14999, mandateStatus: "cancelled" })
  );
}

/** Beat 7: operator pays the low-value cart, then a duplicate event is ignored. */
async function beatPaymentAndDuplicate(): Promise<void> {
  header("Beat 7a — Customer pays the abandoned cart (signed Razorpay webhook)");
  const payment = await simulatePaymentForEntity(REFS.cartLow);
  console.log(`  → ${payment.eventName} (HTTP ${payment.httpStatus})`);
  console.log(`  → state: ${payment.stateBefore} → ${payment.stateAfter} | audit outcome: ${payment.latestAuditOutcome}`);
  if (payment.ok) {
    console.log(`  → ledger RECOVERED entry logged (ref: ${payment.ledgerReferenceId})`);
  } else {
    console.log("  ⚠️ payment did not land as RECOVERED — check backend logs.");
  }
  summaries.push({
    beat: "Beat 7a",
    line: `${REFS.cartLow} paid via webhook → ${payment.stateAfter}`,
  });
  await runBeat(
    "Beat 7b — Duplicate event on the paid entity (everything ignored)",
    (c) => buildCartEnvelope(c, { ref: REFS.cartLow, amount: 1899, age: 6 })
  );
}

async function runAll(): Promise<void> {
  await beatInvoiceLadder();
  await awaitEnter();
  await beatCartLow();
  await beatCartHigh();
  await awaitEnter();
  await beatDncLifecycle();
  await awaitEnter();
  await beatSubLow();
  await beatSubHigh();
  await awaitEnter();
  await beatPaymentAndDuplicate();
}

function printSummary(): void {
  header("Demo summary");
  for (const s of summaries) {
    console.log(`  ${s.beat}: ${s.line}`);
  }
  console.log("\nEscalated tickets (resolve them from the dashboard: recover / write-off):");
  console.log("  → http://localhost:3000 (frontend) | mail preview: http://localhost:8025 (MailHog)");
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
    console.error("   Start: backend → `npm run dev`  |  consumers → `npm run start-consumers`");
    process.exit(1);
  }
  console.log(`✅ Backend reachable at ${API_BASE} — every push below uses the real ingest API.\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

  for (;;) {
    console.log("\nBeats:");
    console.log("  1) Invoice overdue ladder  → reminder, then cooldown skip");
    console.log("  2) Low-value cart          → reminder / payment-link email");
    console.log("  3) High-value cart         → deterministic escalation (₹ ≥ 10,000)");
    console.log("  4) DNC invoice             → skip → manual escalate → duplicate ignored");
    console.log("  5) Low-value mandate       → win-back reminder");
    console.log("  6) High-value mandate      → deterministic escalation (negotiate)");
    console.log("  7) Payment + duplicate     → webhook pay cart, duplicate ignored");
    console.log("  a) Run ALL beats in sequence");
    console.log("  q) Quit");
    const choice = (await ask("select> ")).trim();

    try {
      if (choice === "1") await beatInvoiceLadder();
      else if (choice === "2") await beatCartLow();
      else if (choice === "3") await beatCartHigh();
      else if (choice === "4") await beatDncLifecycle();
      else if (choice === "5") await beatSubLow();
      else if (choice === "6") await beatSubHigh();
      else if (choice === "7") await beatPaymentAndDuplicate();
      else if (choice === "a") await runAll();
      else if (choice === "q") break;
      else continue;

      printSummary();
      if (choice !== "a") await awaitEnter();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n❌ Beat failed: ${msg}`);
    }
  }

  rl.close();
  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error("Demo driver crashed:", err);
  process.exit(1);
});

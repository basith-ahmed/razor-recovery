/**
 * Script: runDemo.ts
 *
 * Enter-driven demo driver: injects events into the pipeline through the
 * real production ingest API (POST /api/v1/events with the partner API key),
 * one step per Enter press. No narration — each step's title says what it
 * pushes; watch the frontend / mail / logs for the outcomes.
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

// Fresh ref namespace per run: each run gets clean entities, while repeats
// WITHIN a run target the same one.
const RUN = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
const REFS = {
  ladder: `demo_inv_ladder_${RUN}`,
  cartLow: `demo_cart_low_${RUN}`,
  cartHigh: `demo_cart_high_${RUN}`,
  dnc: `demo_inv_dnc_${RUN}`,
  subLow: `demo_sub_low_${RUN}`,
  subHigh: `demo_sub_high_${RUN}`,
};

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

/** Injects one event into the pipeline — fire and forget. */
async function pushEvent(
  build: (customer: Customer) => EventEnvelope,
  requireDncCustomer = false
): Promise<void> {
  const customer = await pickCustomer(requireDncCustomer);
  await ingestOverHttp(build(customer));
}

/**
 * Simulates the production clock: expires the entity's contact cooldown
 * (Redis lock + persisted cooldown timestamps) the same way real days
 * would, so the next report lands outside the window.
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

async function awaitEnter(): Promise<void> {
  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("", () => {
      rl.close();
      resolve();
    });
  });
}

async function preflight(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Steps ────────────────────────────────────────────────────────────────────

const steps: Array<{ title: string; run: () => Promise<void> }> = [
  {
    title: `Step 1 — Invoice overdue ₹32,000 (${REFS.ladder})`,
    run: () => pushEvent((c) => buildInvoiceEnvelope(c, { ref: REFS.ladder, amount: 32000, age: 9 })),
  },
  {
    title: `Step 2 — Same invoice re-reported (${REFS.ladder})`,
    run: () => pushEvent((c) => buildInvoiceEnvelope(c, { ref: REFS.ladder, amount: 32000, age: 10 })),
  },
  {
    title: `Step 3 — Cooldown lapses, same invoice re-reported (${REFS.ladder})`,
    run: async () => {
      await advanceCooldown(REFS.ladder);
      await pushEvent((c) => buildInvoiceEnvelope(c, { ref: REFS.ladder, amount: 32000, age: 16 }));
    },
  },
  {
    title: `Step 4 — Same invoice re-reported after payment (${REFS.ladder})`,
    run: () => pushEvent((c) => buildInvoiceEnvelope(c, { ref: REFS.ladder, amount: 32000, age: 17 })),
  },
  {
    title: `Step 5 — Low-value cart abandoned ₹1,899 (${REFS.cartLow})`,
    run: () => pushEvent((c) => buildCartEnvelope(c, { ref: REFS.cartLow, amount: 1899, age: 5 })),
  },
  {
    title: `Step 6 — High-value cart abandoned ₹18,400 (${REFS.cartHigh})`,
    run: () => pushEvent((c) => buildCartEnvelope(c, { ref: REFS.cartHigh, amount: 18400, age: 6 })),
  },
  {
    title: `Step 7 — DNC customer invoice ₹32,000 (${REFS.dnc})`,
    run: () => pushEvent((c) => buildInvoiceEnvelope(c, { ref: REFS.dnc, amount: 32000, age: 12 }), true),
  },
  {
    title: `Step 8 — Same DNC invoice again (${REFS.dnc})`,
    run: () => pushEvent((c) => buildInvoiceEnvelope(c, { ref: REFS.dnc, amount: 32000, age: 13 }), true),
  },
  {
    title: `Step 9 — Low-value subscription mandate cancelled ₹1,499 (${REFS.subLow})`,
    run: () =>
      pushEvent((c) =>
        buildSubscriptionEnvelope(c, { ref: REFS.subLow, amount: 1499, mandateStatus: "cancelled" })
      ),
  },
  {
    title: `Step 10 — High-value subscription mandate cancelled ₹14,999 (${REFS.subHigh})`,
    run: () =>
      pushEvent((c) =>
        buildSubscriptionEnvelope(c, { ref: REFS.subHigh, amount: 14999, mandateStatus: "cancelled" })
      ),
  },
];

async function main(): Promise<void> {
  if (!(await preflight())) {
    console.error(`Backend not reachable at ${API_BASE} — start it with \`npm run dev\`.`);
    process.exit(1);
  }

  for (const step of steps) {
    await awaitEnter();
    console.log(`\n${step.title}`);
    try {
      await step.run();
    } catch (err: unknown) {
      console.error(`Step failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await prisma.$disconnect();
  await redis.disconnect();
}

main().catch((err: unknown) => {
  console.error("Demo driver crashed:", err);
  process.exit(1);
});

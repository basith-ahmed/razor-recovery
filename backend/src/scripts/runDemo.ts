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
 *   2. Clean starting state (recommended):            npm run reset
 *      (the demo upserts its own named customer fixtures on demand)
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

/**
 * The demo owns its customer fixtures: deterministic names and lifetime values
 * so every scenario demonstrates the exact LTV contrast it is meant to show
 * (low-LTV customers ride the automated ladder; high-LTV customers give the
 * decision LLM room to justify deviations). Upsert-by-email keeps runs
 * idempotent, and ingest's customer upsert only touches name/phone on update,
 * so the lifetimeValue set here survives ingestion.
 */
interface DemoProfile {
  name: string;
  email: string;
  lifetimeValue: number;
  dncFlag?: boolean;
}

type DemoProfileKey = "ladder" | "cartLow" | "cartHigh" | "dnc" | "subLow" | "subHigh";

const DEMO_PROFILES: Record<DemoProfileKey, DemoProfile> = {
  ladder: { name: "Vikram Malhotra", email: "demo.ladder@example.test", lifetimeValue: 85000 },
  cartLow: { name: "Sneha Kulkarni", email: "demo.cart.low@example.test", lifetimeValue: 4800 },
  cartHigh: { name: "Rajesh Iyer", email: "demo.cart.high@example.test", lifetimeValue: 940000 },
  dnc: { name: "Pooja Desai", email: "demo.dnc@example.test", lifetimeValue: 110000, dncFlag: true },
  subLow: { name: "Karthik Menon", email: "demo.sub.low@example.test", lifetimeValue: 3900 },
  subHigh: { name: "Ananya Rao", email: "demo.sub.high@example.test", lifetimeValue: 870000 },
};

const customerCache = new Map<DemoProfileKey, Customer>();

async function demoCustomer(key: DemoProfileKey): Promise<Customer> {
  const cached = customerCache.get(key);
  if (cached) return cached;
  const profile = DEMO_PROFILES[key];
  const customer = await prisma.customer.upsert({
    where: { email: profile.email },
    update: {
      name: profile.name,
      dncFlag: profile.dncFlag ?? false,
      lifetimeValue: profile.lifetimeValue,
    },
    create: {
      name: profile.name,
      email: profile.email,
      phone: `+91${Math.floor(6000000000 + Math.random() * 3999999999)}`,
      dncFlag: profile.dncFlag ?? false,
      riskTier: "standard",
      lifetimeValue: profile.lifetimeValue,
    },
  });
  customerCache.set(key, customer);
  return customer;
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
  profileKey: DemoProfileKey,
  build: (customer: Customer) => EventEnvelope
): Promise<void> {
  const customer = await demoCustomer(profileKey);
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
    title: `Step 1 — Invoice overdue ₹32,000 — Vikram Malhotra (${REFS.ladder})`,
    run: () =>
      pushEvent("ladder", (c) =>
        buildInvoiceEnvelope(c, { ref: REFS.ladder, amount: 32000, age: 9, disputeFlag: false })
      ),
  },
  {
    title: `Step 2 — Same invoice re-reported (${REFS.ladder})`,
    run: () =>
      pushEvent("ladder", (c) =>
        buildInvoiceEnvelope(c, { ref: REFS.ladder, amount: 32000, age: 10, disputeFlag: false })
      ),
  },
  {
    title: `Step 3 — Cooldown lapses; scheduler re-injects the invoice within 30s (${REFS.ladder})`,
    run: async () => {
      await advanceCooldown(REFS.ladder);
    },
  },
  {
    title: `Step 4 — Same invoice re-reported after payment (${REFS.ladder})`,
    run: () =>
      pushEvent("ladder", (c) =>
        buildInvoiceEnvelope(c, { ref: REFS.ladder, amount: 32000, age: 17, disputeFlag: false })
      ),
  },
  {
    title: `Step 5 — Low-value cart ₹1,899 — Sneha Kulkarni, low LTV (${REFS.cartLow})`,
    run: () =>
      pushEvent("cartLow", (c) => buildCartEnvelope(c, { ref: REFS.cartLow, amount: 1899, age: 5 })),
  },
  {
    title: `Step 6 — High-value cart ₹18,400 — Rajesh Iyer, high LTV (${REFS.cartHigh})`,
    run: () =>
      pushEvent("cartHigh", (c) => buildCartEnvelope(c, { ref: REFS.cartHigh, amount: 18400, age: 6 })),
  },
  {
    title: `Step 7 — DNC customer invoice ₹32,000 — Pooja Desai (${REFS.dnc})`,
    run: () =>
      pushEvent("dnc", (c) =>
        buildInvoiceEnvelope(c, { ref: REFS.dnc, amount: 32000, age: 12, disputeFlag: false })
      ),
  },
  {
    title: `Step 8 — Same DNC invoice again (${REFS.dnc})`,
    run: () =>
      pushEvent("dnc", (c) =>
        buildInvoiceEnvelope(c, { ref: REFS.dnc, amount: 32000, age: 13, disputeFlag: false })
      ),
  },
  {
    title: `Step 9 — Low-value subscription mandate cancelled ₹1,499 — Karthik Menon, low LTV (${REFS.subLow})`,
    run: () =>
      pushEvent("subLow", (c) =>
        buildSubscriptionEnvelope(c, { ref: REFS.subLow, amount: 1499, mandateStatus: "cancelled" })
      ),
  },
  {
    title: `Step 10 — High-value subscription mandate cancelled ₹14,999 — Ananya Rao, high LTV (${REFS.subHigh})`,
    run: () =>
      pushEvent("subHigh", (c) =>
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

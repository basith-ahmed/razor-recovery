/**
 * Healthcheck script — verifies connectivity to all four infrastructure services:
 *   1. Postgres (via Prisma)
 *   2. Redis (via ioredis)
 *   3. Kafka / Redpanda (via kafkajs producer)
 *   4. Mailhog (via nodemailer SMTP)
 *
 * Usage: npx ts-node src/scripts/healthcheck.ts
 */

import { prisma } from "../config/prisma";
import { redis } from "../config/redis";
import { kafka } from "../config/kafka";
import { mailer } from "../config/mailer";
import { env } from "../config/env";

async function checkPostgres(): Promise<void> {
  const result = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW() as now`;
  console.log(`[OK] Postgres  — connected (server time: ${result[0].now})`);
}

async function checkRedis(): Promise<void> {
  const pong = await redis.ping();
  if (pong !== "PONG") {
    throw new Error(`Expected PONG, got: ${pong}`);
  }
  console.log("[OK] Redis     — connected (PONG received)");
}

async function checkKafka(): Promise<void> {
  const producer = kafka.producer();
  await producer.connect();
  await producer.send({
    topic: "healthcheck",
    messages: [
      {
        key: "healthcheck",
        value: JSON.stringify({
          service: "razorrecovery-backend",
          timestamp: new Date().toISOString(),
        }),
      },
    ],
  });
  await producer.disconnect();
  console.log(
    '[OK] Kafka     — connected (message sent to "healthcheck" topic)'
  );
}

async function checkMailhog(): Promise<void> {
  const info = await mailer.sendMail({
    from: env.SMTP_FROM,
    to: "test@example.com",
    subject: "RazorRecovery Healthcheck",
    text: `Healthcheck email sent at ${new Date().toISOString()}`,
  });
  console.log(`[OK] Mailhog   — connected (message id: ${info.messageId})`);
}

async function main(): Promise<void> {
  console.log("\nRazorRecovery Infrastructure Healthcheck\n");

  const checks = [
    { name: "Postgres", fn: checkPostgres },
    { name: "Redis", fn: checkRedis },
    { name: "Kafka", fn: checkKafka },
    { name: "Mailhog", fn: checkMailhog },
  ];

  let allOk = true;

  for (const check of checks) {
    try {
      await check.fn();
    } catch (error) {
      allOk = false;
      console.error(
        `[FAIL] ${check.name.padEnd(9)} — FAILED: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  console.log("");

  if (allOk) {
    console.log("All infrastructure services are healthy!\n");
  } else {
    console.error("Some services failed. Check the errors above.\n");
    process.exitCode = 1;
  }

  // Clean up connections
  await prisma.$disconnect();
  redis.disconnect();
}

main().catch((err) => {
  console.error("Fatal error during healthcheck:", err);
  process.exit(1);
});

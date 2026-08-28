/**
 * Consumer startup script — starts the five pipeline consumers plus the
 * independent audit-embedding consumer in a
 * single process for hackathon simplicity. Each still has its own
 * consumer group for independent scaling.
 *
 * Usage: npm run start-consumers
 */

import { connectProducer, disconnectProducer } from "../kafka/producer";
import { startDetectionConsumer, stopDetectionConsumer } from "../kafka/consumers/detectionConsumer";
import { startDiagnosisConsumer, stopDiagnosisConsumer } from "../kafka/consumers/diagnosisConsumer";
import { startDecisionConsumer, stopDecisionConsumer } from "../kafka/consumers/decisionConsumer";
import { startExecutorConsumer, stopExecutorConsumer } from "../kafka/consumers/executorConsumer";
import { startAuditConsumer, stopAuditConsumer } from "../kafka/consumers/auditConsumer";
import { startEmbeddingConsumer, stopEmbeddingConsumer } from "../kafka/consumers/embeddingConsumer";

async function start(): Promise<void> {
  console.log("Starting RazorRecovery Kafka consumers...\n");

  // Connect the shared producer first (consumers publish downstream)
  await connectProducer();

  // Start all consumers concurrently
  await Promise.all([
    startDetectionConsumer(),
    startDiagnosisConsumer(),
    startDecisionConsumer(),
    startExecutorConsumer(),
    startAuditConsumer(),
    startEmbeddingConsumer(),
  ]);

  console.log("\nAll 6 consumers are running. Press Ctrl+C to stop.\n");
}

async function shutdown(): Promise<void> {
  console.log("\nShutting down consumers...");
  await Promise.allSettled([
    stopDetectionConsumer(),
    stopDiagnosisConsumer(),
    stopDecisionConsumer(),
    stopExecutorConsumer(),
    stopAuditConsumer(),
    stopEmbeddingConsumer(),
  ]);
  await disconnectProducer();
  console.log("All consumers stopped. Goodbye.");
  process.exit(0);
}

// Graceful shutdown on SIGINT/SIGTERM
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((err) => {
  console.error("Fatal: failed to start consumers:", err);
  process.exit(1);
});

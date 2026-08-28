import { env } from "./config/env";
import { server } from "./api/server";
import { redis } from "./config/redis";
import { connectProducer, disconnectProducer } from "./kafka/producer";
import {
  startDetectionConsumer,
  stopDetectionConsumer,
} from "./kafka/consumers/detectionConsumer";
import {
  startDiagnosisConsumer,
  stopDiagnosisConsumer,
} from "./kafka/consumers/diagnosisConsumer";
import {
  startDecisionConsumer,
  stopDecisionConsumer,
} from "./kafka/consumers/decisionConsumer";
import {
  startExecutorConsumer,
  stopExecutorConsumer,
} from "./kafka/consumers/executorConsumer";
import {
  startAuditConsumer,
  stopAuditConsumer,
} from "./kafka/consumers/auditConsumer";
import {
  startEmbeddingConsumer,
  stopEmbeddingConsumer,
} from "./kafka/consumers/embeddingConsumer";
import {
  startFollowUpScheduler,
  stopFollowUpScheduler,
} from "./scheduler/followUpScheduler";

let shuttingDown = false;

/**
 * Graceful shutdown: the pipeline holds long-lived Kafka consumer/producer
 * connections, a Redis client, and an HTTP/WebSocket server — without this
 * handler, Ctrl+C can't drain the event loop and tsx has to force-kill.
 */
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down pipeline gracefully...`);

  // Hard exit failsafe in case a connection hangs during teardown
  const forceExitTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out; forcing exit.");
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  try {
    await Promise.allSettled([
      stopDetectionConsumer(),
      stopDiagnosisConsumer(),
      stopDecisionConsumer(),
      stopExecutorConsumer(),
      stopAuditConsumer(),
      stopEmbeddingConsumer(),
      stopFollowUpScheduler(),
      disconnectProducer(),
      new Promise<void>((resolve) => server.close(() => resolve())),
    ]);
    redis.disconnect();
    console.log("Pipeline stopped. Goodbye.");
    process.exit(0);
  } catch (err) {
    console.error("Error during shutdown:", err);
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function main() {
  // Shared producer: connected once at process startup, reused everywhere
  await connectProducer();

  // Start all five pipeline consumers once, at process boot, and run them
  // for the lifetime of the process — completely decoupled from whether any
  // stream injection is in flight. This is what makes it a real continuous
  // pipeline rather than a batch job with steps.
  await Promise.all([
    startDetectionConsumer(),
    startDiagnosisConsumer(),
    startDecisionConsumer(),
    startExecutorConsumer(),
    startAuditConsumer(),
    startEmbeddingConsumer(),
  ]);

  // Clock-driven follow-ups: re-inject synthesized events onto EVENTS_RAW
  // when cooldowns lapse or no-response windows elapse on open arcs.
  await startFollowUpScheduler();

  server.listen(env.PORT, () => {
    console.log(
      `RazorRecovery backend server running on http://localhost:${env.PORT} (CORS_ORIGIN=${env.CORS_ORIGIN})`,
    );
    console.log(
      "Pipeline is live: all five Kafka consumers are connected and waiting on their topics.",
    );
  });
}

main().catch((err) => {
  console.error("Fatal error during backend startup:", err);
  process.exit(1);
});

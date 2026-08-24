import { env } from "./config/env";
import { server } from "./api/server";
import { connectProducer } from "./kafka/producer";
import { startDetectionConsumer } from "./kafka/consumers/detectionConsumer";
import { startDiagnosisConsumer } from "./kafka/consumers/diagnosisConsumer";
import { startDecisionConsumer } from "./kafka/consumers/decisionConsumer";
import { startExecutorConsumer } from "./kafka/consumers/executorConsumer";
import { startAuditConsumer } from "./kafka/consumers/auditConsumer";

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
  ]);

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

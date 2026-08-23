/**
 * One-time topic creation script.
 * Uses the KafkaJS admin client to create all six pipeline topics
 * on the Redpanda broker. Single partition, replication factor 1
 * (sufficient for a hackathon).
 *
 * Usage: npm run create-topics
 */

import { kafka } from "../config/kafka";
import { TOPICS } from "../kafka/topics";

async function createTopics(): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  console.log("Connected to Kafka admin client.");

  const topicNames = Object.values(TOPICS);
  const existingTopics = await admin.listTopics();
  const toCreate = topicNames.filter((t) => !existingTopics.includes(t));

  if (toCreate.length === 0) {
    console.log("All topics already exist:");
    topicNames.forEach((t) => console.log(`  - ${t}`));
    await admin.disconnect();
    return;
  }

  const created = await admin.createTopics({
    topics: toCreate.map((topic) => ({
      topic,
      numPartitions: 1,
      replicationFactor: 1,
    })),
  });

  if (created) {
    console.log("Created topics:");
    toCreate.forEach((t) => console.log(`  - ${t}`));
  } else {
    console.log("Topics already exist (no-op).");
  }

  // List all to confirm
  const allTopics = await admin.listTopics();
  const pipelineTopics = allTopics.filter((t) =>
    topicNames.includes(t as (typeof topicNames)[number]),
  );
  console.log(`\nVerified ${pipelineTopics.length}/${topicNames.length} pipeline topics on broker.`);

  await admin.disconnect();
  console.log("Admin client disconnected.");
}

createTopics().catch((err) => {
  console.error("Failed to create topics:", err);
  process.exit(1);
});

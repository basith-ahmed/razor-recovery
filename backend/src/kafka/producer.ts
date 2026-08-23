/**
 * Shared Kafka producer — connected once at process startup and reused
 * everywhere a message needs to be published. Never create a new producer
 * per publish call.
 */

import { kafka } from "../config/kafka";
import { TopicName } from "./topics";

const producer = kafka.producer();

let connected = false;

/**
 * Connect the shared producer. Safe to call multiple times — only the
 * first call actually connects.
 */
export async function connectProducer(): Promise<void> {
  if (connected) return;
  await producer.connect();
  connected = true;
  console.log("Kafka producer connected.");
}

/**
 * Publish a JSON-serialised message to the given topic.
 *
 * @param topic  One of the registered topic names
 * @param key    Message key (typically the event ID for partition locality)
 * @param message  Any JSON-serialisable payload
 */
export async function publish(
  topic: TopicName,
  key: string,
  message: unknown,
): Promise<void> {
  if (!connected) {
    throw new Error(
      "Kafka producer is not connected. Call connectProducer() at startup.",
    );
  }
  await producer.send({
    topic,
    messages: [
      {
        key,
        value: JSON.stringify(message),
      },
    ],
  });
}

/**
 * Gracefully disconnect the producer (for clean shutdown).
 */
export async function disconnectProducer(): Promise<void> {
  if (!connected) return;
  await producer.disconnect();
  connected = false;
  console.log("Kafka producer disconnected.");
}

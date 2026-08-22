import { Kafka } from "kafkajs";
import { env } from "./env";

const kafka = new Kafka({
  clientId: env.KAFKA_CLIENT_ID,
  brokers: env.KAFKA_BROKERS.split(","),
});

export { kafka };

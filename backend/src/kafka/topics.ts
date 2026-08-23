/**
 * Kafka topic registry — single source of truth for all topic names.
 * Six topics, one per pipeline stage.
 */

export const TOPICS = {
  EVENTS_RAW: "revenue.events.raw",
  EVENTS_ENRICHED: "revenue.events.enriched",
  DIAGNOSES: "revenue.diagnoses",
  DECISIONS: "revenue.decisions",
  ACTIONS: "revenue.actions",
  AUDIT: "revenue.audit",
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

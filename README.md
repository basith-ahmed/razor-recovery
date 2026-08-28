# razorrecovery

Autonomous revenue-recovery platform: ingests revenue-risk events (failed payments, abandoned checkouts, overdue invoices, failed subscriptions) through a continuous Kafka event pipeline, diagnoses the root cause (rule-based, with LLM fallback), decides a bounded, policy-compliant recovery action, executes it against real Razorpay Test Mode / email, and maintains a full audit trail with live windowed metrics. Terminal audit cases are embedded with Voyage AI and retrieved as non-authoritative historical context for LLM diagnosis and decisions.

## Architecture

Once started, the backend is a **continuously running pipeline** — not a batch job. Five pipeline consumers and an independent audit-embedding consumer start at process boot and run for the lifetime of the process. Events can arrive at any time, from any source:

```
upstream systems ──► revenue.events.raw ──► detection ──► revenue.events.enriched
 (gateway/checkout/                       ──► diagnosis ──► revenue.diagnoses
  invoicing)                              ──► decision  ──► revenue.decisions
                                          ──► executor  ──► revenue.actions
                                          ──► audit     ──► revenue.audit
```

There is no "run" concept anywhere in the core domain. Metrics are computed over rolling time windows (`1h | 24h | 7d | all`), never per batch or run.

**Ingestion contract:** producers publish complete, webhook-shaped `RawRevenueEvent` payloads onto `revenue.events.raw` — nothing else. The detection consumer persists the event (upsert by event id) and enriches it. There are no demo tags or special fields: simulated traffic and real gateway traffic are indistinguishable to the pipeline.

## Setup

```bash
cp .env.example .env          # fill in Razorpay test keys, LLM key, and VOYAGE_API_KEY
docker compose up -d postgres redis redpanda mailhog

cd backend
npm install
npx prisma migrate dev
npm run create-topics
npm run seed                  # customers/invoices/carts/subscriptions incl. DNC + dispute fixtures
npm run dev                   # starts the live pipeline; it runs continuously

npm run seedDemoStream        # optional: publish the curated demo narrative as plain events

cd ../frontend
npm install
npm run dev
```

Note: the backend is a live long-running pipeline once started — `seedDemoStream` just publishes demo traffic onto `revenue.events.raw`, the same way a real payment gateway would feed it production traffic.

> **Warning:** do NOT run `npm run test:pipeline` while the backend (`npm run dev`) is already running. Both start consumers in the same Kafka consumer groups, so partitions get split between them, offsets churn through rebalances, and messages may be processed unpredictably. Stop the backend first.

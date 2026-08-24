# razorrecovery

Autonomous revenue-recovery platform: ingests revenue-risk events (failed payments, abandoned checkouts, overdue invoices, failed subscriptions) through a continuous Kafka event pipeline, diagnoses the root cause (rule-based, with LLM fallback), decides a bounded, policy-compliant recovery action, executes it against real Razorpay Test Mode / email, and maintains a full audit trail with live windowed metrics.

## Architecture

Once started, the backend is a **continuously running pipeline** — not a batch job. All five Kafka consumers start at process boot and run for the lifetime of the process. Events can arrive at any time, from any source:

```
upstream systems ──► revenue.events.raw ──► detection ──► revenue.events.enriched
 (gateway/checkout/                       ──► diagnosis ──► revenue.diagnoses
  invoicing)                              ──► decision  ──► revenue.decisions
                                          ──► executor  ──► revenue.actions
                                          ──► audit     ──► revenue.audit
```

There is no "run" concept anywhere in the core domain. Metrics are computed over rolling time windows (`1h | 24h | 7d | all`), not per run. The stream injector (Overview page panel or `npm run seedDemoStream`) just feeds demo traffic into the same topic a real payment gateway would publish to.

## Setup

```bash
cp .env.example .env          # fill in Razorpay test keys + Anthropic API key
docker compose up -d postgres redis redpanda mailhog

cd backend
npm install
npx prisma migrate dev
npm run create-topics
npm run seed                  # customers/invoices/carts/subscriptions incl. DNC + dispute fixtures
npm run dev                   # starts the live pipeline; it runs continuously

npm run seedDemoStream        # optional: inject the curated demo narrative

cd ../frontend
npm install
npm run dev
```

Note: the backend is a live long-running pipeline once started — `seedDemoStream` (or the Overview page's injector panel) just feeds it demo traffic, the same way a real payment gateway would feed it production traffic.

# RazorRecovery — Complete System Reconstruction Specification & Technical Blueprint

---

## 1. Executive System Definition

### 1.1 What the System Is
**RazorRecovery** is an autonomous, event-driven revenue-recovery and dunning orchestration platform designed to sit between upstream transaction systems (payment gateways like Razorpay, e-commerce checkouts, billing/invoicing systems, subscription managers) and downstream recovery execution channels (gateway retries, smart payment links, customer dunning emails, human escalation ticketing).

The system operates as a **continuous, real-time event pipeline** (not a batch job). It intercepts revenue failure events, logs append-only financial ledger movements, calculates multi-dimensional risk scores, diagnoses the root cause using a hybrid two-tier engine (deterministic rule-based classification + Large Language Model fallback), evaluates deterministic policy boundaries, enriches decision-making with historical case retrieval (RAG via Voyage AI & pgvector), selects optimal actions via LLM constrained reasoning, executes operations across integrated channels (Razorpay Test Mode, SMTP/Mailhog, Mock Helpdesk), maintains an immutable cryptographic SHA-256 hash-chained audit trail, indexes terminal recovery cases for semantic similarity search, and provides a citation-grounded natural-language audit assistant.

```
                      ┌──────────────────────────────────────────────────────────────────────────────────┐
                      │                              RazorRecovery Platform                              │
 ┌─────────────────┐  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌───────────┐         │  ┌─────────────────┐
 │ Upstream Events │──┼─►│   Ingest &   │──►│ 2-Tier Root  │──►│ Policy Guard │──►│ Action    │─────────┼─►│ Integrated      │
 │ (Failed payment,│  │  │ Risk Scoring │   │  Diagnosis   │   │  & RAG-Guided│   │ Execution │         │  │ Channels        │
 │ Abandoned cart, │  │  │ (AT_RISK Leg)│   │              │   │  Decision    │   │           │         │  │ (Razorpay, SMTP,│
 │ Overdue invoice)│  │  └──────────────┘   └──────────────┘   └──────────────┘   └───────────┘         │  │ Ticket Mock)    │
 └─────────────────┘  │                            │                  │                 │               │  └─────────────────┘
                      │                            ▼                  ▼                 ▼               │
                      │                  ┌──────────────────────────────────────────────────────────┐   │
                      │                  │  Cryptographic Hash Chain Audit & Append-Only Ledger     │   │
                      │                  └────────────────────────────┬─────────────────────────────┘   │
                      │                                               ▼                                 │
                      │                  ┌──────────────────────────────────────────────────────────┐   │
                      │                  │  Voyage-3 + pgvector Embedding Indexer & Audit Assistant │   │
                      │                  └──────────────────────────────────────────────────────────┘   │
                      └──────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Problem Statement & Core Value
When digital businesses experience transaction failures, recovery mechanisms are typically crude: either uncoordinated, aggressive retries that trigger banking risk filters, or passive generic email blasts that result in high churn, customer dissatisfaction, and regulatory non-compliance (e.g., contacting customers on Do-Not-Contact lists or exceeding cooldown limits). 

RazorRecovery solves this by:
1. **Differentiating Failure Causes**: Distinguishes between card expiration, temporary gateway outages, insufficient funds, disputed invoices, and price friction.
2. **Enforcing Hard Policy Guardrails**: Strictly bounds AI autonomy so agents can never invent actions, violate customer contact cooldowns, or harass customers.
3. **Multi-Channel Orchestration**: Executes appropriate recovery channels tailored to the root cause (e.g., instant retry for gateway timeouts, payment links for card renewals, personalized tone-aware dunning emails for overdue invoices).
4. **Append-Only Financial Accounting**: Enforces an immutable `LedgerEntry` record for every financial state change (`AT_RISK`, `RECOVERED`, `WRITTEN_OFF`, `REVERSED`) with database-level update/delete prevention.
5. **RAG-Informed Decisions & Semantic Audit Q&A**: Uses Voyage AI (`voyage-3`) embeddings stored in PostgreSQL `vector(1024)` to retrieve historical case outcomes during decision arbitration and power a citation-grounded natural-language audit trail assistant.
6. **Providing 100% Explainability & Mathematical Tamper Proof**: Every diagnostic and decision step generates an immutable snapshot with explicit reasoning recorded in PostgreSQL, chained via SHA-256 hash proofs, and streamed to a live dashboard via WebSockets.

### 1.3 Target Personas
- **Finance & Revenue Operations (RevOps)**: Monitors recovered revenue (₹), loss velocity, recovery conversion rates, ledger balance movements, and channel ROI.
- **Compliance & Risk Officers**: Inspects policy stopping rules, DNC compliance logs, cooldown adherence, dispute freezes, and verifies cryptographic audit trail integrity.
- **Customer Support & Billing Teams**: Investigates per-customer audit timelines, asks natural-language questions to the grounded AI assistant, reviews automated recovery links, and resolves escalated tickets.

### 1.4 System Boundaries
- **Inside System**: Event ingestion pipeline, financial ledger service, risk scoring engine, hybrid diagnostic classifier, policy evaluation engine, RAG retrieval service, bounded decision service, execution orchestration, audit logger with cryptographic hash chaining, embedding indexing worker, follow-up scheduler, metrics aggregator, natural-language query assistant, WebSocket broadcaster, and Next.js operations console.
- **Outside System**: Upstream payment gateway webhook emitters (Razorpay), SMTP mail transfer agent (Mailhog / production SMTP), LLM API provider (OpenAI-compatible Chat Completions endpoint, such as OpenRouter / Gemini API), Voyage AI embeddings API (`voyage-3`), and PostgreSQL (pgvector)/Redis/Kafka (Redpanda) infrastructure.

---

## 2. Complete System Architecture

### 2.1 Architectural Style
RazorRecovery implements a **Choreographed & Orchestrated Event-Driven Micro-Pipeline** using Kafka (Redpanda) as the durable backbone, PostgreSQL (with `pgvector` extension) as the relational and vector source of truth, Redis for deduplication and rolling window caching, and Next.js / React 19 for the real-time presentation layer.

```mermaid
flowchart TD
    subgraph Ingestion
        GW[Payment Gateway / Webhook / Simulator] -->|Raw Event Payload| API_WH[Express Webhook Endpoint / Script]
        API_WH -->|Publish| T_RAW[(Topic: revenue.events.raw)]
    end

    subgraph Kafka_Pipeline [Continuous Kafka Event Pipeline]
        T_RAW --> C_DET[Detection Consumer]
        C_DET -->|Enriched Event| T_ENR[(Topic: revenue.events.enriched)]
        
        T_ENR --> C_DIAG[Diagnosis Consumer]
        C_DIAG -->|Diagnosis Result| T_DIAG[(Topic: revenue.diagnoses)]
        
        T_DIAG --> C_DEC[Decision Consumer]
        C_DEC -->|Decision Result| T_DEC[(Topic: revenue.decisions)]
        
        T_DEC --> C_EXE[Executor Consumer]
        C_EXE -->|Action Result| T_ACT[(Topic: revenue.actions)]
        
        T_ACT --> C_AUD[Audit Consumer]
        C_AUD -->|Audit Record| T_AUD[(Topic: revenue.audit)]

        T_AUD --> C_EMB[Embedding Consumer]
    end

    subgraph External_Integrations [Execution & AI Integrations]
        C_EXE -->|API Call| RZP[Razorpay Test Mode API]
        C_EXE -->|SMTP| MAIL[Mailhog / SMTP Server]
        C_EXE -->|DB Insert| TKT[Mock Ticket Table]
        C_DEC -->|Case RAG| VOYAGE[Voyage AI voyage-3]
        C_EMB -->|Embed Case| VOYAGE
        Q_SERV[Audit Query Service] -->|Embed Query + Q&A| VOYAGE & LLM[LLM API / Gemini]
    end

    subgraph Autonomous_Scheduler [Clock-Driven Orchestration]
        SCHED[Follow-Up Scheduler] -->|Scan Due Follow-Ups / Retries| DB[(PostgreSQL + pgvector)]
        SCHED -->|Re-inject Synthesized Event| T_RAW
    end

    subgraph Storage_and_State [Storage & State Management]
        C_DET & C_DIAG & C_DEC & C_EXE & C_AUD & C_EMB --> DB
        C_DET & C_DIAG & C_DEC & C_EXE & C_AUD --> REDIS[(Redis Cache / Dedup)]
    end

    subgraph Presentation_Layer [Real-Time Presentation]
        C_AUD -->|emitLiveUpdate| WS[Socket.IO Server]
        C_DET -->|emitIncomingEvent| WS
        WS -->|activity:new / metrics:update / event:incoming| UI[Next.js Dashboard]
        UI -->|REST API Requests / Natural-Language Query| API_ROUTES[Express REST API]
        API_ROUTES --> DB & REDIS & Q_SERV
    end
```

---

### 2.2 Component Architecture & Interaction

```mermaid
graph TD
    subgraph Backend_Process [Backend Node.js Process]
        direction TB
        Server[Express HTTP + Socket.IO Server]
        Producer[Singleton Kafka Producer]
        
        subgraph Consumers [Long-Running Kafka Consumers]
            DetC[Detection Consumer]
            DiagC[Diagnosis Consumer]
            DecC[Decision Consumer]
            ExeC[Executor Consumer]
            AudC[Audit Consumer]
            EmbC[Embedding Consumer]
        end

        subgraph Core_Services [Domain & Integration Services]
            RiskEngine[Risk Scoring Engine]
            LedgerService[Append-Only Ledger Service]
            DiagService[Diagnosis Service - Tier 1 Rule / Tier 2 LLM]
            PolicyEngine[Policy Engine - Stopping Rules]
            RetrievalService[RAG Retrieval Service - pgvector <=> search]
            DecService[Decision Service - LLM Arbitrator + RAG context]
            ExeService[Executor Service - Email Drafter + Dispatcher]
            AudService[Audit Service - Hash Chain + State Machine + DB Logger]
            HashChain[Hash Chain & Canonicalizer Engine]
            Redaction[PII Redaction Layer]
            EmbService[Embedding Service - Voyage AI Case Vectorizer]
            QueryService[Audit Query Service - Citation-Grounded Q&A]
            EntityService[Entity Query & State Derivation Service]
            CustomerService[Customer Lookup & Tenure Service]
            PolicyService[Policy Configuration & DNC Service]
            PromiseService[Promise-to-Pay Lifecycle Service]
            TicketService[Ticket Helpdesk & Resolution Service]
            WebhookService[Razorpay Webhook Settlement Service]
            MetService[Metrics Aggregation Service - Ledger Aggregator]
            FollowUpSched[Follow-Up Scheduler - 30s Loop]
        end
    end

    DetC --> RiskEngine
    DetC --> LedgerService
    DiagC --> DiagService
    DecC --> PolicyEngine --> DecService
    DecService --> RetrievalService
    ExeC --> ExeService
    AudC --> AudService --> HashChain
    AudService --> LedgerService
    AudC --> MetService
    EmbC --> EmbService
    Server --> QueryService
    Server --> EntityService
    Server --> CustomerService
    Server --> PolicyService
    Server --> PromiseService
    Server --> TicketService
    Server --> WebhookService
    FollowUpSched --> Producer
```

---

### 2.3 End-to-End Information & Message Flow

```mermaid
sequenceDiagram
    autonumber
    participant Pub as Upstream / Webhook / Simulator
    participant K_Raw as Topic: revenue.events.raw
    participant Det as Detection Consumer
    participant K_Enr as Topic: revenue.events.enriched
    participant Diag as Diagnosis Consumer
    participant LLM as OpenAI-Compatible LLM
    participant K_Diag as Topic: revenue.diagnoses
    participant Dec as Decision Consumer
    participant RAG as Retrieval Service (Voyage AI + pgvector)
    participant K_Dec as Topic: revenue.decisions
    participant Exe as Executor Consumer
    participant Ext as Razorpay / SMTP / Tickets
    participant K_Act as Topic: revenue.actions
    participant Aud as Audit Consumer
    participant K_Aud as Topic: revenue.audit
    participant Emb as Embedding Consumer
    participant PG as PostgreSQL (pgvector)
    participant R as Redis
    participant WS as WebSocket & UI

    Pub->>K_Raw: Publish RawRevenueEvent (JSON)
    K_Raw->>Det: Consume RawRevenueEvent
    Det->>R: SETNX razorrecovery:dedup:{id}:detection (TTL 1h)
    Det->>PG: Fetch Customer History & Invoices
    Det->>Det: computeRiskScore(amount, severity, history, urgency)
    Det->>PG: Upsert RevenueEvent + writeLedgerEntry(AT_RISK)
    Det->>WS: emitIncomingEvent (event:incoming)
    Det->>K_Enr: Publish EnrichedRevenueEvent

    K_Enr->>Diag: Consume EnrichedRevenueEvent
    Diag->>R: SETNX dedup:{id}:diagnosis
    alt Known error_reason (Tier 1)
        Diag->>Diag: CAUSE_MAP lookup (Confidence 1.0, RULE)
    else Unknown / Ambient Failure (Tier 2)
        Diag->>LLM: requestJson(DIAGNOSIS_SYSTEM_PROMPT, event+history)
        LLM-->>Diag: { cause_label, confidence, reasoning }
    end
    Diag->>PG: Upsert Diagnosis Record
    Diag->>K_Diag: Publish { event, diagnosis }

    K_Diag->>Dec: Consume { event, diagnosis }
    Dec->>R: SETNX dedup:{id}:decision
    Dec->>PG: Query EntityWorkflowState + Customer.dncFlag + Invoice.disputeFlag
    Dec->>Dec: filterLegalActions(ctx) [Pure Deterministic]
    alt legalActions.length == 0
        Dec->>Dec: chosenAction = "none" (Blocked by policy)
    else legalActions.length == 1
        Dec->>Dec: chosenAction = legalActions[0] (Deterministic)
    else legalActions.length > 1
        Dec->>RAG: findSimilarCases(cause, entityType, amount)
        RAG-->>Dec: Top-K similar cases from pgvector
        Dec->>LLM: requestJson(DECISION_PROMPT, legal_actions + RAG context)
        LLM-->>Dec: { chosen_action, reasoning }
        Dec->>Dec: Re-validate chosen_action in legalActions (Fallback if invalid)
    end
    Dec->>PG: Upsert Decision Record
    Dec->>K_Dec: Publish { event, diagnosis, decision }

    K_Dec->>Exe: Consume { event, diagnosis, decision }
    Exe->>R: SETNX dedup:{id}:executor
    alt chosenAction == Email Action
        Exe->>LLM: draftRecoveryEmail(customerName, cause, amount)
        LLM-->>Exe: { subject, body_paragraphs }
        Exe->>Ext: sendRecoveryEmail(to, subject, html)
    else chosenAction == Payment Link
        Exe->>Ext: createRecoveryPaymentLink(amount, customer, description)
    else chosenAction == Retry Payment
        Exe->>Ext: retryPayment(orderId)
    else chosenAction == Escalate
        Exe->>Ext: escalateToHuman(entityId, reasoning)
    end
    Exe->>PG: Upsert Action Record
    Exe->>K_Act: Publish { event, diagnosis, decision, action }

    K_Act->>Aud: Consume { event, diagnosis, decision, action }
    Aud->>R: SETNX dedup:{id}:audit
    Aud->>PG: Interactive Transaction: SELECT hash FROM AuditChainHead FOR UPDATE
    Aud->>Aud: Compute entry hash = sha256(prevHash + canonicalize(entry))
    Aud->>PG: Insert AuditEntry (sequenceNumber, prevHash, hash, snapshots)
    Aud->>PG: Update AuditChainHead (new hash)
    Aud->>PG: Update EntityWorkflowState + EntityCauseState
    opt If terminal state reached (RECOVERED or WRITTEN_OFF)
        Aud->>PG: writeLedgerEntry(RECOVERED or WRITTEN_OFF)
    end
    Aud->>WS: emitLiveUpdate -> emit(activity:new, metrics:update)
    Aud->>K_Aud: Publish { event, diagnosis, decision, action, auditEntryId }

    K_Aud->>Emb: Consume { auditEntryId, event }
    Emb->>R: SETNX dedup:{auditEntryId}:embedding
    opt If entry outcome in [recovered, written_off, escalated]
        Emb->>PG: Fetch AuditEntry and RevenueEvent snapshots
        Emb->>VOYAGE: embed(caseSummaryText, "document")
        VOYAGE-->>Emb: 1024-dim float vector
        Emb->>PG: INSERT INTO "AuditEmbedding" (vector) ON CONFLICT DO NOTHING
    end
```

---

### 2.4 State Machine Transition Diagram

```mermaid
stateDiagram-v2
    [*] --> DETECTED

    DETECTED --> CONTACTED : email_sent / payment_link_sent / reminder_sent / dunning_sent / winback_sent
    DETECTED --> RETRYING : retry_initiated
    DETECTED --> COOLING_DOWN : subscription_paused / cooldown_started
    DETECTED --> ESCALATED : escalation_triggered
    DETECTED --> DO_NOT_CONTACT : dnc_skip
    DETECTED --> WRITTEN_OFF : hard_decline / auto_cancel / written_off

    CONTACTED --> CONTACTED : email_sent / reminder_sent
    CONTACTED --> RETRYING : retry_initiated
    CONTACTED --> COOLING_DOWN : cooldown_started / subscription_paused
    CONTACTED --> ESCALATED : escalation_triggered
    CONTACTED --> RECOVERED : recovered / payment_confirmed / retry_success
    CONTACTED --> WRITTEN_OFF : hard_decline / auto_cancel / written_off
    CONTACTED --> DO_NOT_CONTACT : dnc_skip

    RETRYING --> RETRYING : retry_initiated
    RETRYING --> COOLING_DOWN : retry_failed / cooldown_started
    RETRYING --> RECOVERED : retry_success / payment_confirmed
    RETRYING --> ESCALATED : escalation_triggered
    RETRYING --> WRITTEN_OFF : hard_decline / auto_cancel / written_off
    RETRYING --> DO_NOT_CONTACT : dnc_skip

    COOLING_DOWN --> COOLING_DOWN : cooldown_started
    COOLING_DOWN --> RETRYING : cooldown_ended / retry_initiated
    COOLING_DOWN --> CONTACTED : email_sent
    COOLING_DOWN --> ESCALATED : escalation_triggered
    COOLING_DOWN --> WRITTEN_OFF : hard_decline / auto_cancel / written_off
    COOLING_DOWN --> DO_NOT_CONTACT : dnc_skip

    ESCALATED --> RECOVERED : payment_confirmed / recovered
    ESCALATED --> WRITTEN_OFF : written_off / hard_decline

    RECOVERED --> [*]
    WRITTEN_OFF --> [*]
    DO_NOT_CONTACT --> [*]

    note right of RECOVERED : Terminal State: Closes recovery arc\nWipes EntityCauseState memory\nResets attemptCount to 0\nWrites RECOVERED ledger entry
    note right of WRITTEN_OFF : Terminal State: Closes recovery arc\nWipes EntityCauseState memory\nWrites WRITTEN_OFF ledger entry
    note right of DO_NOT_CONTACT : Terminal State: Closes recovery arc\nWipes EntityCauseState memory
```

---

## 3. Complete Repository Structure & File-by-File Inventory

The codebase is organized as two independent apps within a monorepo:

```
razorrecovery/
├── docker-compose.yml              # Local multi-service infrastructure (Postgres 16 + pgvector, Redis 7, Redpanda, Mailhog)
├── .env.example                    # Template for all environment variables (including VOYAGE_API_KEY)
├── README.md                       # High-level architecture & operator setup guide
├── TODO.md                         # Product roadmap and architectural transition log
├── AGENTS.md                       # Global agent rules and repository conventions
├── docs/                           # Architectural design documents, plans, and changelog
│   ├── PROJECT.md                  # Comprehensive system reconstruction blueprint (Single Source of Truth)
│   ├── razorrecovery-advanced-features-plan.md # Advanced features implementation plan
│   ├── scripts.md                  # Detailed runbook for all backend npm scripts
│   └── changelog/                  # Historical synchronization changelog entries
├── backend/                        # Node.js + TypeScript backend application
│   ├── package.json                # Dependencies, scripts, and engine requirements
│   ├── tsconfig.json               # Strict TypeScript compiler options
│   ├── jest.config.js              # Unit/Integration testing configuration (SWC/Jest)
│   ├── prisma.config.ts            # Prisma tooling configuration
│   ├── AGENTS.md                   # Backend agent guidelines
│   ├── prisma/
│   │   ├── schema.prisma           # Relational schema (PostgreSQL + pgvector) with AuditEmbedding, LedgerEntry & hash chain
│   │   ├── seed.ts                 # Database seed script for test entities and Genesis hash chain initialization
│   │   └── migrations/             # Timestamped SQL schema migrations
│   │       ├── 20260822181206_init/
│   │       ├── 20260822194132_add_tickets/
│   │       ├── 20260824193107_remove_batch_add_source_run_id/
│   │       ├── 20260825000000_remove_source_run_id/
│   │       ├── 20260826000000_entity_cause_scoping/
│   │       ├── 20260826010000_add_diagnosis_snapshot/
│   │       ├── 20260827000000_audit_hash_chain/
│   │       ├── 20260827205736_financial_ledger/      # Adds LedgerEntry model + append-only PostgreSQL rules
│   │       ├── 20260828000000_audit_embeddings/        # Adds pgvector vector(1024) AuditEmbedding table + ivfflat index
│   │       └── 20260829000000_entity_workflow_attempts/# Adds unified attempt/cooldown columns to EntityWorkflowState
│   ├── src/
│   │   ├── index.ts                # Application root entrypoint & lifecycle bootstrap (6 consumers + server + scheduler)
│   │   ├── __probe_due.ts          # Internal diagnostic script for follow-up verification
│   │   ├── config/
│   │   │   ├── env.ts              # Zod-validated environment configuration loader
│   │   │   ├── prisma.ts           # Singleton Prisma Client with pg driver adapter
│   │   │   ├── redis.ts            # Singleton ioredis client
│   │   │   ├── kafka.ts            # Singleton KafkaJS instance
│   │   │   ├── razorpay.ts         # Singleton Razorpay Node SDK client
│   │   │   ├── mailer.ts           # Singleton Nodemailer SMTP transport
│   │   │   ├── openai.ts           # Resilient LLM client (with JSON schema fallback & 429 backoff)
│   │   │   ├── voyage.ts           # Voyage AI client (voyage-3, 1024-dim document/query embeddings)
│   │   │   └── logger.ts           # Compact error rendering and logging utilities
│   │   ├── domain/
│   │   │   ├── types.ts            # Core TypeScript domain types, interfaces, enums & DomainError
│   │   │   ├── hashChain.ts        # Cryptographic SHA-256 hash chain and canonicalization engine
│   │   │   ├── redaction.ts        # Recursive PII redaction and masking utility
│   │   │   ├── riskScoring.ts      # Pure risk score calculation formula
│   │   │   ├── policy.json         # Declarative policy catalog and stopping rules (v2, 5 active rules)
│   │   │   ├── policy.ts           # Policy cache loader and cause rule lookup (incl. escalateAboveAmount)
│   │   │   ├── stoppingRules.ts    # Deterministic legal action filter engine with Promise & Mandate guards
│   │   │   ├── emailTemplates.ts   # Parameterized branded HTML email generators for all recovery causes
│   │   │   ├── eventEnvelope.ts    # Partner ingestion envelope types + pure field-level validators
│   │   │   └── stateMachine.ts     # Pure workflow state transition table and validator
│   │   ├── simulator/
│   │   │   ├── seedEntities.ts     # Realistic demo customer seed generator
│   │   │   └── partnerEvents.ts    # Partner-shaped envelope factories + real-ingest-path simulator
│   │   ├── integrations/
│   │   │   ├── razorpayIntegration.ts # Razorpay Orders & Payment Links API adapter
│   │   │   ├── emailIntegration.ts    # Nodemailer email delivery adapter
│   │   │   └── ticketMock.ts          # Human escalation ticket persistence adapter
│   │   ├── services/
│   │   │   ├── customerService.ts  # Customer lookups, failure counting, and tenure calculations
│   │   │   ├── ingestService.ts    # Unified partner ingestion: validation, idempotency, upserts, publish
│   │   │   ├── entityService.ts    # Entity queries, state derivation, and audit detail responses
│   │   │   ├── diagnosisService.ts # Hybrid Tier 1 (RULE) / Tier 2 (LLM) diagnosis service
│   │   │   ├── decisionService.ts  # Policy-bounded recovery decision engine with RAG case retrieval
│   │   │   ├── executorService.ts  # Multi-channel action dispatcher + template/LLM email delivery
│   │   │   ├── auditService.ts     # Transactional hash-chained audit writer, verifyChain & state updater
│   │   │   ├── ledgerService.ts    # Append-only financial ledger service (writeLedgerEntry)
│   │   │   ├── embeddingService.ts # Terminal recovery case text builder & vector indexer
│   │   │   ├── retrievalService.ts # Cosine similarity pgvector query service (findSimilarCases)
│   │   │   ├── queryService.ts     # Citation-grounded natural-language audit trail assistant
│   │   │   ├── promiseService.ts   # Promise-to-Pay creation, reminder dispatch, stats, and updates
│   │   │   ├── ticketService.ts    # Escalation tickets, internal notes, customer outreach emails, and resolutions
│   │   │   ├── webhookService.ts   # Razorpay webhook signature verification, payment/promise settlement
│   │   │   ├── policyService.ts    # Live policy configuration, DNC register, and compliance logs
│   │   │   ├── revenueEventService.ts # Revenue event existence check and single event lookup
│   │   │   └── metricsService.ts   # Rolling window metrics, funnel, trend & ledger aggregator
│   │   ├── scheduler/
│   │   │   └── followUpScheduler.ts # 30s clock-driven scheduler for cooldowns, timeouts, deferred retries & promises
│   │   ├── kafka/
│   │   │   ├── topics.ts           # Kafka topic name constants (6 topics)
│   │   │   ├── producer.ts         # Shared, persistent Kafka producer wrapper
│   │   │   └── consumers/
│   │   │       ├── detectionConsumer.ts # Stage 1: Ingestion, history fetch, risk scoring, AT_RISK ledger
│   │   │       ├── diagnosisConsumer.ts # Stage 2: Root cause classification
│   │   │       ├── decisionConsumer.ts  # Stage 3: Policy evaluation, RAG case retrieval, action choice
│   │   │       ├── executorConsumer.ts  # Stage 4: Channel execution
│   │   │       ├── auditConsumer.ts     # Stage 5: Audit logging, state update, RECOVERED/WRITTEN_OFF ledger
│   │   │       └── embeddingConsumer.ts # Stage 6: Asynchronous vector indexing for terminal cases
│   │   ├── api/
│   │   │   ├── server.ts           # Express application setup, CORS, JSON parsing, routes
│   │   │   ├── websocket.ts        # Socket.IO WebSocket server and live broadcaster
│   │   │   ├── routes/
│   │   │   │   ├── audit.ts        # Tamper-evident hash chain verification endpoint (/audit/verify)
│   │   │   │   ├── entities.ts     # Entity listing, search, filtering & audit trail endpoints
│   │   │   │   ├── metrics.ts      # Rolling summary and trend analytics endpoints
│   │   │   │   ├── policy.ts       # Live policy rules, DNC list & compliance log endpoints
│   │   │   │   ├── promises.ts     # Promise-to-Pay CRUD, reminder sending, customer search & stats
│   │   │   │   ├── tickets.ts      # Escalation ticket dashboard, internal notes, outreach & resolution
│   │   │   │   └── query.ts        # Natural-language audit Q&A endpoint (/query)
│   │   │   └── webhooks/
│   │   │       └── razorpayWebhook.ts # Razorpay signature verification, payment/promise settlement
│   │   ├── utils/
│   │   │   ├── apiResponse.ts      # Standardized Express route error translation (DomainError handling)
│   │   │   ├── pagination.ts       # Standard page/limit parsing and paginated response envelopes
│   │   │   └── redisUtils.ts       # Redis SETNX dedup locks, cooldowns, and fast-recovered cache helpers
│   │   └── scripts/
│   │       ├── cleanDb.ts          # Fast database table truncate script
│   │       ├── createTopics.ts     # Kafka admin script to provision all 6 topics
│   │       ├── healthcheck.ts      # Multi-service connectivity verification (PG, Redis, Kafka, SMTP)
│   │       ├── runDemo.ts          # Interactive beat-by-beat demo driver over the real ingest API
│   │       ├── simulatePromisePayment.ts # Simulates payment webhook specifically for Promise-to-Pay
│   │       ├── simulateWebhookPayment.ts # Signed Razorpay payment webhook simulation (CLI + reusable fn)
│   │       ├── startConsumers.ts   # Standalone consumer starter
│   │       └── testIntegrations.ts # Manual integration test script for external APIs
│   └── tests/                      # Jest test suites (21 suites, 242 passing tests)
│       ├── hashChain.test.ts       # Unit tests for canonicalization and hash chain determinism
│       ├── redaction.test.ts       # Unit tests for recursive PII masking and field preservation
│       ├── auditChain.test.ts      # Integration tests for tamper detection, SQL mutation & concurrency
│       ├── riskScoring.test.ts     # Mathematical risk formula validation
│       ├── policy.test.ts          # Policy rule catalog & stopping condition validation
│       ├── stateMachine.test.ts    # Guard table and state transition verification
│       ├── intelligence.test.ts    # Diagnosis & decision engine short-circuiting & validation
│       ├── integrations.test.ts    # External API mocks and adapters
│       ├── execution.test.ts       # Full execution pipeline and action recording
│       ├── followUpScheduler.test.ts # Clock-driven scheduler logic & deferred retries
│       ├── simulator.test.ts       # Synthetic failure event generator testing
│       ├── api.test.ts             # Express REST endpoints & query filtering
│       ├── ledger.test.ts          # Append-only ledger idempotency, DB rule enforcement & metrics
│       ├── voyage.test.ts          # Voyage AI embedding client dimension & request validation
│       ├── embeddingService.test.ts# Case summary text formatting and terminal outcome gating
│       ├── ragServices.test.ts     # End-to-end indexing & pgvector neighbor mapping
│       ├── query.test.ts           # Natural-language audit assistant & citation grounding
│       ├── webhook.test.ts         # Razorpay webhook signature verification & state reset
│       ├── mandate.test.ts         # UPI Autopay mandate diagnosis, policy routing & stopping rules
│       ├── promiseToPay.test.ts    # Promise-to-Pay creation, reminder emails, grace periods, and settlement
│       └── tickets.test.ts         # Human escalation ticketing, notes, agent outreach & status resolution
└── frontend/                       # Next.js 16 (App Router) + React 19 + Tailwind CSS
    ├── package.json                # Frontend dependencies and scripts
    ├── tsconfig.json               # Frontend TypeScript configuration
    ├── next.config.ts              # Next.js compiler settings
    ├── postcss.config.mjs          # PostCSS configuration
    ├── eslint.config.mjs           # ESLint configuration
    ├── AGENTS.md                   # Frontend agent guidelines
    ├── app/
    │   ├── layout.tsx              # Root HTML shell with persistent Nav, Sidebar, and AppShell layout
    │   ├── page.tsx                # Overview & Operations Center (Hero, Feeds, Charts, Strip, Floating AI)
    │   ├── globals.css             # Global CSS, theme variables, and Tailwind directives
    │   ├── entities/
    │   │   ├── page.tsx            # Filterable, sortable, paginated Entity List with pagination controls
    │   │   └── [id]/page.tsx       # Entity Detail, Audit Timeline, Promise integration & Floating AI Assistant
    │   ├── promises/
    │   │   ├── page.tsx            # Promise-to-Pay management dashboard, KPI stats cards & Create Modal
    │   │   └── [id]/page.tsx       # Promise Detail view, payment link generator & reminder action
    │   ├── tickets/
    │   │   ├── page.tsx            # Helpdesk Escalation Tickets queue, priority filters & KPI counters
    │   │   └── [id]/page.tsx       # Ticket Detail view, internal notes thread, outreach email modal & resolution
    │   ├── metrics/
    │   │   └── page.tsx            # Deep analytics, Unit economics, CSV/JSON export & Floating AI Assistant
    │   └── policy/
    │       └── page.tsx            # Policy rules, DNC register, compliance log & Audit Integrity Verifier
    ├── components/
    │   ├── AppShell.tsx            # Responsive application shell managing desktop/mobile sidebar drawer
    │   ├── Nav.tsx                 # Persistent header with mobile menu trigger, status pill, and live indicator
    │   ├── Sidebar.tsx             # Collapsible side navigation with Operations, Workflows, Analytics, Config
    │   ├── WindowSelector.tsx      # Time window switcher (1h | 24h | 7d | all)
    │   ├── HeroMetrics.tsx         # 4 animated metrics counters (Risk, Recovered, Rate, Events)
    │   ├── IncomingEventFeed.tsx   # Live stream of newly ingested events (detection stage)
    │   ├── LiveActivityFeed.tsx    # Live scrolling feed of processed outcomes (audit stage)
    │   ├── FunnelChart.tsx         # Recharts conversion funnel visualization
    │   ├── CauseChannelCharts.tsx  # Recharts cause breakdown pie + channel efficiency bars
    │   ├── ComplianceStrip.tsx     # Guardrail status counters (DNC, Escalated, Cooldown)
    │   ├── EntityTable.tsx         # Server-filtered table with pagination, search, sorting, and stage badges
    │   ├── AuditTimeline.tsx       # Expandable step-by-step audit cards with AI reasoning callouts
    │   ├── PolicyTable.tsx         # Declarative policy rule viewer rendered directly from JSON
    │   ├── AuditChainVerifier.tsx  # Cryptographic audit hash chain live verification widget
    │   ├── AuditQueryPanel.tsx     # Natural-language audit assistant panel with grounded entity citations
    │   ├── FloatingAuditAIBar.tsx  # Bottom floating AI query bar with rotating prompt suggestions & drawer
    │   ├── GlobalFloatingAIBar.tsx # System-wide floating AI query bar for cross-entity exploration
    │   ├── CreatePromiseModal.tsx  # Modal dialog for creating customer Promise-to-Pay commitments
    │   ├── CustomerSearchCombobox.tsx # Customer search and auto-complete dropdown
    │   ├── TicketEmailModal.tsx    # Modal dialog for human agents to compose and dispatch custom outreach emails
    │   ├── PaginationControl.tsx   # Standardized pagination component with page buttons and page size selector
    │   ├── Badge.tsx               # Reusable stylized status and tag badge
    │   ├── Modal.tsx               # Standard modal wrapper with backdrop and transitions
    │   ├── MarkdownRenderer.tsx    # Safe markdown renderer with entity citation links
    │   ├── CountdownTimer.tsx      # Visual countdown timer for active promise deadlines
    │   └── PageHeader.tsx          # Standard page title and action bar header
    ├── lib/
    │   ├── api.ts                  # Axios API client functions (entities, metrics, policy, promises, tickets, query)
    │   ├── formatters.ts           # Shared currency, date, time, and relative duration formatters
    │   ├── badgeStyles.ts          # Tailwind color styling maps for statuses, stages, and causes
    │   └── socket.ts               # Singleton Socket.IO connection and `useLiveStream` hook
    └── types/
        └── index.ts                # Shared TypeScript interfaces for API responses and UI state
```

---

## 4. Database Reconstruction Specification

### 4.1 Complete Database Schema (Prisma)

The schema is defined in `backend/prisma/schema.prisma` and requires PostgreSQL 16+ with the `pgvector` extension enabled.

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  extensions = [vector]
}

enum EntityType {
  CART
  INVOICE
  SUBSCRIPTION
}

enum EventType {
  CHECKOUT_ABANDONED
  INVOICE_OVERDUE
  SUBSCRIPTION_MANDATE_CANCELLED
}

enum WorkflowState {
  DETECTED
  CONTACTED
  RETRYING
  COOLING_DOWN
  ESCALATED
  RECOVERED
  WRITTEN_OFF
  DO_NOT_CONTACT
}

enum DiagnosisMethod {
  RULE
  LLM
}

enum ActionIntegration {
  RAZORPAY
  EMAIL
  MOCK
}

model Customer {
  id            String    @id @default(uuid())
  name          String
  email         String
  phone         String?
  dncFlag       Boolean   @default(false)
  riskTier      String    @default("standard")
  lifetimeValue Float     @default(0)
  createdAt     DateTime  @default(now())

  invoices      Invoice[]
  carts         Cart[]
  subscriptions Subscription[]
  events        RevenueEvent[]
  workflowStates EntityWorkflowState[]
  promises      PromiseToPay[]
}

model Invoice {
  id          String   @id @default(uuid())
  customerId  String
  customer    Customer @relation(fields: [customerId], references: [id])
  amount      Float
  dueDate     DateTime
  status      String   @default("open")
  disputeFlag Boolean  @default(false)
  createdAt   DateTime @default(now())
}

model Cart {
  id          String   @id @default(uuid())
  customerId  String
  customer    Customer @relation(fields: [customerId], references: [id])
  amount      Float
  abandonedAt DateTime
  items       Json
  createdAt   DateTime @default(now())
}

model Subscription {
  id                     String   @id @default(uuid())
  customerId             String
  customer               Customer @relation(fields: [customerId], references: [id])
  razorpaySubscriptionId String?
  mrr                    Float
  nextBillDate           DateTime
  status                 String   @default("active")
  createdAt              DateTime @default(now())
}

model RevenueEvent {
  id                String     @id @default(uuid())
  entityType        EntityType
  entityId          String
  customerId        String
  customer          Customer   @relation(fields: [customerId], references: [id])
  eventType         EventType
  amount            Float
  currency          String     @default("INR")
  occurredAt        DateTime   @default(now())
  razorpayPaymentId String?
  razorpayOrderId   String?
  errorCode         String?
  errorReason       String?
  rawPayload        Json
  riskScore         Float?
  urgency           Float?

  diagnosis     Diagnosis?
  decision      Decision?
  action        Action?
  auditEntries  AuditEntry[]
  ledgerEntries LedgerEntry[]
  promises      PromiseToPay[]
}

model Diagnosis {
  id         String          @id @default(uuid())
  eventId    String          @unique
  event      RevenueEvent    @relation(fields: [eventId], references: [id])
  causeLabel String
  confidence Float
  method     DiagnosisMethod
  reasoning  String?
  createdAt  DateTime        @default(now())
}

model Decision {
  id            String       @id @default(uuid())
  eventId       String       @unique
  event         RevenueEvent @relation(fields: [eventId], references: [id])
  legalActions  Json
  chosenAction  String
  reasoning     String
  policyVersion String
  createdAt     DateTime     @default(now())
}

model Action {
  id                    String             @id @default(uuid())
  eventId               String             @unique
  event                 RevenueEvent       @relation(fields: [eventId], references: [id])
  actionType            String
  executedAt            DateTime           @default(now())
  result                String
  integration           ActionIntegration
  razorpayPaymentLinkId String?
  emailMessageId        String?
}

model AuditEntry {
  id                String       @id @default(uuid())
  eventId           String
  event             RevenueEvent @relation(fields: [eventId], references: [id])
  entityId          String
  actor             String
  inputSnapshot     Json
  diagnosisSnapshot Json?
  decisionSnapshot  Json?
  actionSnapshot    Json?
  outcome           String
  timestamp         DateTime     @default(now())
  sequenceNumber    Int          @unique @default(autoincrement())
  prevHash          String
  hash              String

  embedding         AuditEmbedding?
}

model AuditEmbedding {
  id           String     @id @default(uuid())
  auditEntryId String     @unique
  auditEntry   AuditEntry @relation(fields: [auditEntryId], references: [id])
  embedding    Unsupported("vector(1024)")
  createdAt    DateTime   @default(now())
}

model AuditChainHead {
  id        Int      @id @default(1)
  hash      String
  updatedAt DateTime @updatedAt
}

model EntityWorkflowState {
  id              String        @id @default(uuid())
  entityId        String        @unique
  customerId      String?
  customer        Customer?     @relation(fields: [customerId], references: [id])
  state           WorkflowState @default(DETECTED)
  attemptCount    Int           @default(0)
  lastContactedAt DateTime?
  cooldownUntil   DateTime?
  updatedAt       DateTime      @updatedAt
}

model EntityCauseState {
  id              String    @id @default(uuid())
  entityId        String
  causeLabel      String
  attemptCount    Int       @default(0)
  lastContactedAt DateTime?
  cooldownUntil   DateTime?
  updatedAt       DateTime  @updatedAt

  @@unique([entityId, causeLabel])
  @@index([entityId])
}

enum LedgerEntryType {
  AT_RISK
  RECOVERED
  WRITTEN_OFF
  REVERSED
}

model LedgerEntry {
  id          String          @id @default(uuid())
  entityId    String
  eventId     String
  type        LedgerEntryType
  amount      Float
  currency    String          @default("INR")
  referenceId String?
  createdAt   DateTime        @default(now())
  
  event       RevenueEvent    @relation(fields: [eventId], references: [id])

  @@index([entityId])
  @@index([type])
  @@index([createdAt])
  @@index([eventId, type])
}

model Ticket {
  id              String       @id @default(uuid())
  entityId        String
  reason          String
  status          String       @default("open") // "open" | "resolved" | "recovered" | "closed"
  priority        String       @default("medium") // "high" | "medium" | "low"
  assignedTo      String?
  resolutionNotes String?
  resolvedAt      DateTime?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  notes           TicketNote[]

  @@index([entityId])
  @@index([status])
  @@index([createdAt])
}

model TicketNote {
  id        String   @id @default(uuid())
  ticketId  String
  ticket    Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  author    String   @default("Human Agent")
  content   String
  type      String   @default("note") // "note" | "email_sent" | "status_change"
  createdAt DateTime @default(now())

  @@index([ticketId])
  @@index([createdAt])
}

model PromiseToPay {
  id                    String        @id @default(uuid())
  entityId              String
  customerId            String
  customer              Customer      @relation(fields: [customerId], references: [id])
  eventId               String?
  event                 RevenueEvent? @relation(fields: [eventId], references: [id])
  promisedAmount        Float
  currency              String        @default("INR")
  promisedDate          DateTime
  status                String        @default("pending") // "pending" | "reminder_sent" | "kept" | "broken" | "cancelled"
  reminderSentAt        DateTime?
  gracePeriodUntil      DateTime?
  razorpayPaymentLinkId String?
  paymentLinkUrl        String?
  notes                 String?
  createdAt             DateTime      @default(now())
  updatedAt             DateTime      @updatedAt

  @@index([entityId])
  @@index([customerId])
  @@index([status])
  @@index([promisedDate])
  @@index([razorpayPaymentLinkId])
}
```

---

### 4.2 Entity-Relationship (ER) Diagram

```mermaid
erDiagram
    Customer ||--o{ Invoice : "has"
    Customer ||--o{ Cart : "has"
    Customer ||--o{ Subscription : "has"
    Customer ||--o{ RevenueEvent : "has"
    Customer ||--o{ EntityWorkflowState : "has"
    Customer ||--o{ PromiseToPay : "commits"

    RevenueEvent ||--o| Diagnosis : "diagnosed by"
    RevenueEvent ||--o| Decision : "decided by"
    RevenueEvent ||--o| Action : "executed by"
    RevenueEvent ||--o{ AuditEntry : "audited in"
    RevenueEvent ||--o{ LedgerEntry : "financial ledger"
    RevenueEvent ||--o{ PromiseToPay : "settles"

    AuditEntry ||--o| AuditEmbedding : "vectorized in"
    Ticket ||--o{ TicketNote : "has"

    AuditEntry {
        string id PK
        string eventId FK
        string entityId
        string actor
        json inputSnapshot
        json diagnosisSnapshot
        json decisionSnapshot
        json actionSnapshot
        string outcome
        DateTime timestamp
        int sequenceNumber UK
        string prevHash
        string hash
    }

    AuditEmbedding {
        string id PK
        string auditEntryId UK,FK
        vector embedding "vector(1024)"
        DateTime createdAt
    }

    LedgerEntry {
        string id PK
        string entityId
        string eventId FK
        LedgerEntryType type
        float amount
        string currency
        string referenceId
        DateTime createdAt
    }

    AuditChainHead {
        int id PK
        string hash
        DateTime updatedAt
    }

    EntityWorkflowState {
        string id PK
        string entityId UK
        string customerId FK
        WorkflowState state
        int attemptCount
        DateTime lastContactedAt
        DateTime cooldownUntil
        DateTime updatedAt
    }

    EntityCauseState {
        string id PK
        string entityId
        string causeLabel
        int attemptCount
        DateTime lastContactedAt
        DateTime cooldownUntil
        DateTime updatedAt
    }

    Ticket {
        string id PK
        string entityId
        string reason
        string status
        string priority
        string assignedTo
        string resolutionNotes
        DateTime resolvedAt
        DateTime createdAt
        DateTime updatedAt
    }

    TicketNote {
        string id PK
        string ticketId FK
        string author
        string content
        string type
        DateTime createdAt
    }

    PromiseToPay {
        string id PK
        string entityId
        string customerId FK
        string eventId FK
        float promisedAmount
        string currency
        DateTime promisedDate
        string status
        DateTime reminderSentAt
        DateTime gracePeriodUntil
        string razorpayPaymentLinkId
        string paymentLinkUrl
        string notes
        DateTime createdAt
        DateTime updatedAt
    }
```

---

### 4.3 Key Architectural Database Design Principles
1. **Append-Only Financial Ledger with Database Rules (`LedgerEntry`)**:
   Financial ledger records (`AT_RISK`, `RECOVERED`, `WRITTEN_OFF`, `REVERSED`) are strictly append-only. PostgreSQL rules (`CREATE RULE ledger_no_update AS ON UPDATE TO "LedgerEntry" DO INSTEAD NOTHING;` and `CREATE RULE ledger_no_delete AS ON DELETE TO "LedgerEntry" DO INSTEAD NOTHING;`) guarantee at the database engine level that no financial row can ever be modified or deleted.
2. **High-Dimensional Vector Storage & IVFFlat Indexing (`AuditEmbedding`)**:
   PostgreSQL `pgvector` stores 1024-dimensional floating-point embeddings generated by Voyage AI `voyage-3`. An `ivfflat` index with `vector_cosine_ops` (`CREATE INDEX ON "AuditEmbedding" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);`) ensures sub-millisecond approximate nearest neighbor retrieval (`<=>`).
3. **Cryptographic Tamper-Evident Audit Hash Chain (`AuditChainHead` & `AuditEntry`)**:
   Every audit entry is cryptographically linked to the preceding entry via SHA-256 (`hash = sha256(prevHash + canonicalize(entry))`). Writes are serialized using an interactive transaction with a row-level lock on `AuditChainHead` (`SELECT hash FROM "AuditChainHead" WHERE id = 1 FOR UPDATE`), guaranteeing strict monotonic sequence numbers, zero forking, and complete verification coverage.
4. **Per-Cause & Unified Entity Attempt Tracking**:
   Entity attempt counters, cooldown timestamps, and last contact dates are tracked both at the unified entity level in `EntityWorkflowState` and scoped per `(entityId, causeLabel)` in `EntityCauseState`.
5. **Terminal Arc Closure**:
   When an entity reaches a terminal state (`RECOVERED`, `WRITTEN_OFF`, `DO_NOT_CONTACT`), all associated rows in `EntityCauseState` are automatically purged and `EntityWorkflowState.attemptCount` is reset to 0, ensuring future billing cycles start with a clean budget.

---

## 5. Domain Logic & Core Algorithms

### 5.1 Risk Scoring Formula (`backend/src/domain/riskScoring.ts`)

The risk scoring engine is a pure, deterministic mathematical function. It evaluates four weighted components:

$$\text{RiskScore} = w_{\text{amount}} \cdot N_{\text{amount}} + w_{\text{severity}} \cdot S_{\text{event}} + w_{\text{history}} \cdot H_{\text{cust}} + w_{\text{urgency}} \cdot U_{\text{time}}$$

Where:
- **Weights**:
  - $w_{\text{amount}} = 0.35$
  - $w_{\text{severity}} = 0.25$
  - $w_{\text{history}} = 0.15$
  - $w_{\text{urgency}} = 0.25$
- **Normalized Amount ($N_{\text{amount}}$)**:
  $$N_{\text{amount}} = \begin{cases} \min\left(\frac{\text{event.amount}}{\text{recentMaxAmount}}, 1.0\right) & \text{if } \text{recentMaxAmount} > 0 \\ 0 & \text{otherwise} \end{cases}$$
  *Note*: `recentMaxAmount` is sourced from a rolling Redis key (`razorrecovery:riskNorm:recentMaxAmount`, TTL 24h) representing the largest transaction amount observed in the rolling window.
- **Event Severity ($S_{\text{event}}$)**:
  $$\text{Severity} = \begin{cases} 
  0.80 & \text{for } \text{PAYMENT\_FAILED} \\ 
  0.75 & \text{for } \text{SUBSCRIPTION\_FAILED} \\ 
  0.60 & \text{for } \text{INVOICE\_OVERDUE} \\ 
  0.40 & \text{for } \text{CHECKOUT\_ABANDONED} 
  \end{cases}$$
- **Customer Failure History ($H_{\text{cust}}$)**:
  $$H_{\text{cust}} = \min\left(\frac{\text{priorFailures}}{5}, 1.0\right)$$
- **Time Urgency ($U_{\text{time}}$)**:
  $$U_{\text{time}} = \begin{cases} 
  \min\left(\frac{\text{daysOverdue}}{30}, 1.0\right) & \text{for } \text{INVOICE\_OVERDUE} \\ 
  \max\left(0, 1.0 - \frac{\text{hoursSinceAbandon}}{48}\right) & \text{for } \text{CHECKOUT\_ABANDONED} \\ 
  0.50 & \text{for other events} 
  \end{cases}$$

The calculated score is rounded to 3 decimal places: `Number(riskScore.toFixed(3))`.

---

### 5.2 Policy Specification (`backend/src/domain/policy.json`)

The entire action space is bound to this declarative rule catalog:

```json
{
  "version": "2.1.0",
  "rules": [
    {
      "cause": "cart_abandoned",
      "actions": ["send_reminder_email", "send_payment_link", "escalate_to_human"],
      "escalateAboveAmount": 10000,
      "stopping": { "maxAttempts": 2, "windowDays": 7, "onMaxAction": "escalate_to_human" }
    },
    {
      "cause": "invoice_overdue",
      "actions": ["send_reminder_email", "send_soft_chase_email", "escalate_to_human"],
      "stopping": { "maxAttempts": 3, "windowDays": 7, "onMaxAction": "escalate_to_human" }
    },
    {
      "cause": "mandate_requires_reauthorization",
      "actions": ["send_reminder_email", "pause_subscription", "escalate_to_human"],
      "escalateAboveAmount": 10000,
      "stopping": { "hardStopDays": 30, "onHardStopAction": "escalate_to_human" }
    },
    {
      "cause": "no_reason_signal",
      "actions": ["send_reminder_email"],
      "stopping": { "noResponseWithinHours": 48 }
    },
    {
      "cause": "promise_broken",
      "actions": ["escalate_to_human"],
      "stopping": { "maxAttempts": 1, "onMaxAction": "escalate_to_human" }
    }
  ]
}
```

`escalateAboveAmount` is the value-based escalation knob: exposure at or above the
threshold skips the standard contact cadence and goes straight to human review
(e.g. a high-value abandoned cart escalates on its first event).

---

### 5.3 Deterministic Stopping Engine (`backend/src/domain/stoppingRules.ts`)

The legal action filter prunes the catalog down to an unambiguous list of valid actions before the LLM is ever invoked:

1. **Step 0 — Recovered Arc Guard**: If `ctx.isRecovered === true`, the recovery arc is closed $\rightarrow$ return `[]` immediately.
2. **Step 1 — DNC Check**: If `ctx.isDnc === true` or `ctx.causeLabel === "dnc"`, customer communication is forbidden $\rightarrow$ return `[]` immediately.
3. **Step 2 — Dispute & Broken Promise Overrides**: If `ctx.isDisputed === true`, `ctx.causeLabel === "invoice_disputed"`, or `ctx.causeLabel === "promise_broken"`, standard automated dunning is bypassed $\rightarrow$ return `["escalate_to_human"]` immediately.
4. **Step 3 — Active Promise-to-Pay Guard**: If `ctx.hasActivePromise === true`, the customer has an active unbroken commitment $\rightarrow$ return `[]` immediately to pause automated dunning outreach.
5. **Step 4 — Cause Lookup**: Find the rule matching `ctx.causeLabel` in `policy.json`. If not found $\rightarrow$ return `[]` immediately.
6. **Step 5 — Cooldown Filter**: If `ctx.isInCooldown === true`, the entity is within its contact cooldown window $\rightarrow$ return `[]` immediately.
7. **Step 6 — Max Attempts Guard**:
   If `stopping.maxAttempts` is defined and `ctx.attemptCount >= stopping.maxAttempts`:
   - If `stopping.onMaxAction` is specified (e.g., `"escalate_to_human"`, `"hard_decline"`, `"send_reminder_email"`) $\rightarrow$ return `[stopping.onMaxAction]`.
   - Otherwise $\rightarrow$ return `[]`.
8. **Step 7 — Hard Stop Days Guard**:
   If `stopping.hardStopDays` is defined and `ctx.daysOverdue >= stopping.hardStopDays`:
   - Return `[stopping.onHardStopAction]` (e.g., `["escalate_to_human"]`).
9. **Step 8 — No Response Timeout**:
   If `stopping.noResponseWithinHours` is defined and `hoursSinceLastContact >= threshold`:
   - If `stopping.onTimeoutAction` is specified $\rightarrow$ return `[stopping.onTimeoutAction]`.
   - Otherwise $\rightarrow$ return `[]`.
10. **Step 9 — Mandate Reauthorization Policy Gate**:
    For `mandate_requires_reauthorization`, the policy strictly omits `retry_payment_immediate` and `retry_payment_delayed` from its `actions` array. "Policy is data" — the omission acts as the mathematical hard gate preventing retry attempts on dead mandates.
11. **Step 10 — Return Pruned List**: Returns the remaining valid legal actions.

---

### 5.4 Deterministic-First Root Cause Diagnosis (`backend/src/services/diagnosisService.ts`)

```mermaid
flowchart TD
    Start([Enriched Revenue Event]) --> Promise{Promise-broken marker?}
    Promise -->|Yes| ReturnPromise[Return: promise_broken, method='RULE', confidence=1.0]
    Promise -->|No| Mandate{SUBSCRIPTION_MANDATE_CANCELLED with mandate/subscription status?}
    Mandate -->|Yes| ReturnMandate[Return: mandate_requires_reauthorization, method='RULE', confidence=1.0]
    Mandate -->|No| Invoice{INVOICE event?}
    Invoice -->|disputeFlag=true| ReturnDisputed[Return: invoice_disputed, method='RULE', confidence=1.0]
    Invoice -->|disputeFlag=false| ReturnOverdue[Return: invoice_overdue, method='RULE', confidence=1.0]
    Invoice -->|not an invoice| Cart{CHECKOUT_ABANDONED?}
    Cart -->|Yes| ReturnCart[Return: cart_abandoned, method='RULE', confidence=1.0]
    Cart -->|No| LLMCall[Call LLM Messages API — only for payloads without recognizable rule signals]

    LLMCall --> ParseJson[Parse Structured JSON]
    ParseJson --> ValidLabel{cause_label in allowed enum?}
    ValidLabel -->|Yes| ReturnLLM[Return: method='LLM', confidence, reasoning]
    ValidLabel -->|No| RetryPrompt[Retry LLM with explicit correction prompt]
    RetryPrompt --> RetryValid{Valid label on retry?}
    RetryValid -->|Yes| ReturnLLM
    RetryValid -->|No / Error| Fallback[Fallback: cause='no_reason_signal' or 'unknown']
```

The engine's scope is revenue leakage, not payment failures: partner systems own their
gateways and only report carts left unchecked out, invoices gone overdue, and subscription
mandates cancelled or halted. Gateway-side causes (expired cards, insufficient funds,
timeouts, retryable mandate debit failures) were removed with the ingestion-v2 migration —
the engine never sees a payment attempt fail. The LLM path remains as the arbiter for
payloads that lack their expected partner signals.

Allowed cause labels:
`cart_abandoned`, `invoice_overdue`, `invoice_disputed`, `mandate_requires_reauthorization`,
`no_reason_signal`, `dnc`, `promise_broken`.

---

### 5.5 Bounded Decision Arbitrator with RAG Case Retrieval (`backend/src/services/decisionService.ts`)

The decision engine chooses an action strictly within the pre-filtered legal actions, augmented by historical similar-case retrieval:
1. **Zero Legal Actions**: Short-circuit immediately. Return `{ chosenAction: "none", legalActions: [], reasoning: "Blocked by policy (...)", policyVersion }`. No LLM call is made.
2. **Value-Based Escalation Trigger**: If the cause's policy rule defines `escalateAboveAmount` and the exposure amount meets or exceeds the threshold while escalation is a legal action, short-circuit to `escalate_to_human` (high-value carts skip the standard contact cadence). No LLM call is made.
3. **Follow-Up Scheduled Retry**: If `entityContext.dueScheduledRetry === true`, short-circuit and choose the first legal action directly.
4. **Exactly One Legal Action**: Short-circuit immediately. When a policy restriction (dispute, broken promise, max attempts) determined the single action, the reasoning carries that block reason (e.g. `"Blocked by policy (Invoice is disputed)"`); otherwise `"Only legal action available: ..."`. No LLM call is made.
5. **Multiple Legal Actions (2+)**: 
   - Queries `findSimilarCases(diagnosis.causeLabel, retrievalContext.entityType, retrievalContext.amount)` via Voyage AI & pgvector.
   - Formats similar past cases (`cause`, `action`, `outcome`, `days_to_recover`) into `similarCasesPrompt`.
   - Calls LLM with `DECISION_PROMPT` passing `{ diagnosis, legal_actions: legalActions, entity_context, similar_past_cases }`.
6. **Enforce Membership Re-validation**:
   If the LLM returns a `chosen_action` that is **not** present in `legalActions`, log an error and deterministically fall back to `legalActions[0]`.

---

### 5.6 Cryptographic Hash Chain & Deterministic Canonicalization (`backend/src/domain/hashChain.ts`)

To ensure mathematical proof of audit trail integrity, all `AuditEntry` records form a cryptographically linked SHA-256 hash chain:

1. **Genesis Anchor**:
   The chain begins at a deterministic genesis hash:
   $$\text{GENESIS\_HASH} = \text{sha256}(\text{"razorrecovery-genesis"})$$
2. **Deterministic Canonicalization (`canonicalize`)**:
   Before hashing, JSON object keys are recursively sorted in alphabetical order so identical logical payloads always produce identical byte strings regardless of JSON key order. Array element ordering is strictly preserved.
3. **Hash Calculation (`computeEntryHash`)**:
   Every entry's hash is computed as:
   $$\text{hash}_N = \text{sha256}(\text{prevHash}_{N-1} + \text{canonicalize}(\text{entry}_N))$$
   Where $\text{entry}_N$ includes `{ eventId, entityId, actor, inputSnapshot, diagnosisSnapshot, decisionSnapshot, actionSnapshot, outcome, timestamp }` (with `timestamp` formatted as a UTC ISO 8601 string).
4. **Interactive Transaction with Row-Level Locking**:
   When writing an audit entry, the audit service initiates `prisma.$transaction()` and acquires a row-lock on `AuditChainHead` (`SELECT hash FROM "AuditChainHead" WHERE id = 1 FOR UPDATE`), reading the latest `prevHash`, computing the current `hash`, inserting the `AuditEntry`, and updating `AuditChainHead` within the same transaction. This serializes all audit writes and prevents forking under high concurrent workloads.
5. **Chain Verification Engine (`verifyChain`)**:
   Validates the integrity of the chain over any arbitrary sequence range `[fromSequence, toSequence]`. If `fromSequence > 1`, it queries the preceding row to establish the expected `prevHash`. It stops immediately at the first invalid entry and reports `{ valid: false, entriesChecked, brokenAtEntryId, brokenAtSequence }`.

---

### 5.7 Presentation-Layer PII Redaction Layer (`backend/src/domain/redaction.ts`)

To protect customer privacy during presentation, logging, and reporting without mutating durable audit hashes:

1. **Sensitive Field Registry**:
   Monitors fields including `email`, `customerEmail`, `contactEmail`, `phone`, `customerPhone`, `contactPhone` (case-insensitive).
2. **Masking Rules**:
   - `maskEmail(email)`: Retains first character and domain suffix: `john.doe@example.com` $\rightarrow$ `j***@example.com`.
   - `maskPhone(phone)`: Retains only the last 4 digits: `+919876543210` $\rightarrow$ `********3210`.
3. **Recursive Deep Traversal (`redactPII`)**:
   Recursively traverses nested objects and arrays of arbitrary depth, redacting matching keys while leaving all non-sensitive primitive and structural fields untouched.

---

### 5.8 Parameterized Recovery Email Templates (`backend/src/domain/emailTemplates.ts`)

To ensure consistent, branded, and legally sound customer communications, all emails are generated via parameterized templates with dynamic variable interpolation:

1. **Branded HTML Shell (`buildEmailTemplate`)**:
   Standardized layout featuring the RazorRecovery header, styled message paragraphs, action buttons with INR currency formatting (`₹X,XXX`), and automated footer disclaimers.
2. **Specialized Cause Templates (`getEmailTemplate` & `generateRecoveryEmail`)**:
   - **Expired Card**: Requests updated card details or alternative UPI payment.
   - **Insufficient Funds**: Friendly notice with retry link across UPI/Netbanking/Cards.
   - **Gateway Timeout**: Reassures transaction safety and provides completion link.
   - **Mandate Re-Authorization**: Urgently prompts customer to re-authorize UPI Autopay / e-NACH mandate.
   - **Mandate Retryable Failure**: Informs customer of automated retry schedule with immediate manual payment alternative.
   - **Abandoned Cart / Price Friction**: Reminds customer of reserved items with direct checkout URL.
   - **Overdue B2B Invoice**: Professional payment request referencing invoice number and due dates.
   - **Soft Chase Dunning**: Escalated follow-up warning of potential account suspension.
   - **Promise-to-Pay Confirmation & Reminders**: Formats agreed commitment dates, balances, and payment links.
   - **Agent Ticket Outreach**: Allows human operators to dispatch customized notes with integrated Razorpay payment links.

---

## 6. Financial Ledger Subsystem (`backend/src/services/ledgerService.ts`)

### 6.1 Ledger Architecture & Entry Types
The platform enforces double-entry precision with an immutable, append-only `LedgerEntry` table tracking all monetary lifecycle stages:

| Ledger Type | Emitted At Stage | Condition | Effect on Metrics |
| :--- | :--- | :--- | :--- |
| `AT_RISK` | Detection Consumer | Initial revenue event ingestion | Increments `amountAtRisk` |
| `RECOVERED` | Audit Consumer / Razorpay Webhook | Entity reaches `RECOVERED` state | Increments `amountRecovered` |
| `WRITTEN_OFF` | Audit Consumer | Entity reaches `WRITTEN_OFF` state | Records final loss write-off |
| `REVERSED` | Razorpay Webhook | Webhook receives refund event (`refund.processed` / `payment.refunded`) | Deducts from `amountRecovered` |

### 6.2 Idempotency & Database Rule Immutability
1. **Idempotency**: `writeLedgerEntry` queries for existing `(eventId, type)` within the active transaction before inserting. Replays or racing webhooks return the existing record without duplicate insertions.
2. **Engine-Level Immutability**:
   ```sql
   CREATE RULE ledger_no_update AS ON UPDATE TO "LedgerEntry" DO INSTEAD NOTHING;
   CREATE RULE ledger_no_delete AS ON DELETE TO "LedgerEntry" DO INSTEAD NOTHING;
   ```
   Any direct SQL `UPDATE` or `DELETE` attempt silently does nothing, guaranteeing ledger records cannot be retroactively altered.

---

## 7. Semantic Case Retrieval & RAG Embedding Subsystem

### 7.1 Case Vectorization (`backend/src/services/embeddingService.ts`)
When an audit entry reaches a terminal outcome (`recovered`, `written_off`, `escalated`), the asynchronous **Embedding Consumer** vectorizes the completed case:
1. **Structured Case Representation (`buildCaseSummaryText`)**:
   Formats the case into a concise keyword string:
   `cause=invoice_overdue, entity_type=INVOICE, amount_bucket=2000_to_10000, action=send_payment_link, outcome=recovered, days_to_recover=2`
   Where `amount_bucket` is categorized into `under_500`, `500_to_2000`, `2000_to_10000`, or `over_10000`.
2. **Voyage AI Client (`backend/src/config/voyage.ts`)**:
   Calls Voyage's embedding API (`POST https://api.voyageai.com/v1/embeddings`) with model `voyage-3` and `input_type: "document"`, returning a 1024-dimensional normalized vector.
3. **Database Insertion**:
   Persists to `AuditEmbedding` with `vector(1024)` column using `ON CONFLICT ("auditEntryId") DO NOTHING`.

### 7.2 Similar Case Retrieval (`backend/src/services/retrievalService.ts`)
During decision arbitration, `findSimilarCases(cause, entityType, amount, k = 3)`:
1. Generates query vector via `embed(queryText, "query")`.
2. Executes nearest neighbor cosine distance search in PostgreSQL:
   ```sql
   SELECT a."diagnosisSnapshot", a."decisionSnapshot", a.outcome,
          CASE WHEN a.outcome = 'recovered'
            THEN GREATEST(0, CEIL(EXTRACT(EPOCH FROM (a.timestamp - r."occurredAt")) / 86400))::int
            ELSE NULL END AS "daysToRecover"
   FROM "AuditEmbedding" e
   JOIN "AuditEntry" a ON a.id = e."auditEntryId"
   JOIN "RevenueEvent" r ON r.id = a."eventId"
   ORDER BY e.embedding <=> $1::vector
   LIMIT $2
   ```
3. Returns formatted historical case contexts to guide LLM reasoning.

---

## 8. Natural-Language Audit Trail Assistant (`backend/src/services/queryService.ts`)

### 8.1 Grounded AI Q&A Engine
The platform provides a natural-language query assistant capable of answering operator questions about past recovery decisions, root causes, and compliance actions:
1. **Entity-Scoped Queries (`entityId` provided)**:
   Fetches all audit entries matching `entityId` or `eventId`, formats chronological timeline records, and injects them into the prompt.
2. **Cross-Entity Semantic Queries (`entityId` omitted)**:
   Embeds the question with Voyage AI, executes pgvector cosine similarity search (`<=>`) over `AuditEmbedding` to select top-6 relevant historical entries, falling back to recent entries if embeddings are sparse.
3. **Strict Citation Grounding**:
   The system prompt forces the assistant to cite the source entity for every factual claim in the exact format `[entity:{id}]`.
4. **Citation Parsing (`extractCitations`)**:
   Regex parses `[entity:([^\]\s]+)]` from the LLM answer and returns an array of clickable `citedEntityIds` for the UI.

---

## 9. Messaging, Kafka Topics, and Background Consumers

### 9.1 Kafka Topic Taxonomy

| Topic Name | Message Key | Payload Structure | Producer | Consumers |
| :--- | :--- | :--- | :--- | :--- |
| `revenue.events.raw` | `event.id` | `RawRevenueEvent` | Webhooks / Simulator / Scheduler | `detection-service` |
| `revenue.events.enriched`| `event.id` | `EnrichedRevenueEvent` | `detection-service` | `diagnosis-service` |
| `revenue.diagnoses` | `event.id` | `{ event, diagnosis }` | `diagnosis-service` | `decision-service` |
| `revenue.decisions` | `event.id` | `{ event, diagnosis, decision }` | `decision-service` | `executor-service` |
| `revenue.actions` | `event.id` | `{ event, diagnosis, decision, action }`| `executor-service` | `audit-service` |
| `revenue.audit` | `event.id` | `{ event, diagnosis, decision, action, auditEntryId }`| `audit-service` / Webhook | `embedding-service` |

---

### 9.2 Consumer Fleet Specification

1. **Detection Consumer (`detection-service`)**: Subscribes to `revenue.events.raw`. Fetches customer history, calculates normalized risk score and urgency, writes `AT_RISK` ledger entry, upserts `RevenueEvent`, broadcasts `event:incoming` over WebSockets, and publishes to `revenue.events.enriched`.
2. **Diagnosis Consumer (`diagnosis-service`)**: Subscribes to `revenue.events.enriched`. Performs Tier 1 `CAUSE_MAP` lookup or Tier 2 LLM classification, upserts `Diagnosis`, and publishes to `revenue.diagnoses`.
3. **Decision Consumer (`decision-service`)**: Subscribes to `revenue.diagnoses`. Evaluates deterministic stopping rules, retrieves similar cases via RAG, queries LLM arbitrator, re-validates membership, sets fast-cooldown lock in Redis, upserts `Decision`, and publishes to `revenue.decisions`.
4. **Executor Consumer (`executor-service`)**: Subscribes to `revenue.decisions`. Dispatches multi-channel actions (drafts email via LLM, creates Razorpay payment link, initiates retry, or logs mock ticket), upserts `Action`, and publishes to `revenue.actions`.
5. **Audit Consumer (`audit-service`)**: Subscribes to `revenue.actions`. Acquires row-lock on `AuditChainHead`, computes entry SHA-256 hash, inserts `AuditEntry`, updates `EntityWorkflowState` and `EntityCauseState`, writes `RECOVERED` or `WRITTEN_OFF` ledger entries for terminal arcs, broadcasts live WebSockets (`activity:new`, `metrics:update`), and publishes to `revenue.audit`.
6. **Embedding Consumer (`embedding-service`)**: Subscribes to `revenue.audit`. Filters for terminal outcomes (`recovered`, `written_off`, `escalated`), builds structured case text, requests 1024-dim embedding from Voyage AI, and inserts into `AuditEmbedding` with pgvector.

---

### 9.3 Redis Namespace & Key Lifecycle

| Key Pattern | Data Type | TTL | Purpose | Created By | Read By |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `razorrecovery:dedup:{eventId}:{stage}` | String (`"1"`) | 3600s (1h) | Idempotent SETNX deduplication guard per pipeline stage | All Kafka Consumers | All Kafka Consumers |
| `razorrecovery:metrics:{window}` | String (JSON) | 5s | Cached metrics snapshot for fast dashboard polling | `metricsService` | `metricsService` |
| `razorrecovery:riskNorm:recentMaxAmount`| String (Float)| 86400s (24h) | Rolling 24-hour maximum transaction amount for risk score normalization | `detectionConsumer` | `detectionConsumer` |
| `razorrecovery:cooldown:{entityId}` | String (ISO Date)| Variable | Fast-cooldown lock preventing rapid-fire duplicate contacts | `decisionConsumer` | `decisionConsumer` |
| `razorrecovery:recovered:{entityId}` | String (`"true"`)| 30 days | Fast-recovered lock preventing contacts on recovered entities | `auditService` / Webhook | `decisionConsumer` |
| `razorrecovery:dnc:set` | Set (String) | None | In-memory cache of Do-Not-Contact customer IDs | Seed / Admin scripts | Policy Router |
| `razorrecovery:followup:{entityId}:{cause}:{type}` | String (`"1"`) | 24h / 7d | Prevents rapid re-firing of follow-up scheduler events | `followUpScheduler` | `followUpScheduler` |
| `razorrecovery:scheduledretry:{actionId}` | String (`"1"`) | 24h | Prevents duplicate dispatch of due deferred retries | `followUpScheduler` | `followUpScheduler` |

---

### 9.4 Follow-Up Scheduler (`backend/src/scheduler/followUpScheduler.ts`)

The pipeline itself is reactive; the **Follow-Up Scheduler** acts on a 30-second interval timer to evaluate time-dependent policy commitments and lifecycle deadlines:
1. **Cooldown Expiration**: Scans `EntityCauseState` for open arcs where `attemptCount < maxAttempts`, `cooldownUntil <= now`, and no pending scheduled retries exist. It generates a synthetic `RawRevenueEvent` (tagged `followUp: { type: "cooldown_expired", causeLabel }`) and publishes it to `revenue.events.raw`.
2. **No-Response Timeout**: Scans for entities where `now - lastContactedAt >= noResponseWithinHours`. It generates a synthetic event (tagged `followUp: { type: "no_response_timeout", causeLabel }`).
3. **Deferred Retries (`retry_payment_delayed`)**: Queries `Action` rows with `result = 'scheduled'`. When the cause's `cooldownUntil <= now`:
   - If the arc closed or escalated $\rightarrow$ marks action `result = 'cancelled'`.
   - If open $\rightarrow$ marks action `result = 'dispatched'`, creates a synthetic event (tagged `followUp: { type: "scheduled_retry_due", actionId, causeLabel }`), and emits to `revenue.events.raw`. The decision engine deterministically triggers the retry.
4. **Promise-to-Pay Automation (`scanAndProcessPromises`)**:
   - **Overdue Promises (`pending` & `promisedDate <= now`)**: Uses Redis dedup lock (`razorrecovery:promise:reminder:{id}`), transitions status to `reminder_sent`, sets a 24-hour `gracePeriodUntil`, and automatically dispatches a branded reminder email with direct Razorpay payment link.
   - **Broken Promises (`reminder_sent` & `gracePeriodUntil <= now`)**: Uses Redis dedup lock (`razorrecovery:promise:broken:{id}`), transitions status to `broken`, and synthesizes a `promise_broken` event to `revenue.events.raw` which autonomously routes to human support escalation.

---

## 10. External Integrations & Adapters

### 10.1 Razorpay Test Mode Integration (`backend/src/integrations/razorpayIntegration.ts`)
- **Payment Retry (`retryPayment(orderId)`):**
  Fetches order details via `razorpay.orders.fetch(orderId)` to verify readiness for customer-initiated Checkout retry. If the ID is simulated (`order_sim_...`), it returns a synthetic success without calling Razorpay.
- **Recovery Payment Link (`createRecoveryPaymentLink(params)`):**
  Calls `razorpay.paymentLink.create(...)` with:
  - `amount`: Converted to paise (`Math.round(params.amount * 100)`)
  - `currency`: `"INR"`
  - `description`: Recovery payment description
  - `customer`: `{ name, email, contact }`
  - `notify`: `{ sms: true, email: true }`
  - `reminder_enable`: `true`
  Returns `{ actionType: "send_payment_link", result: "success", integration: "RAZORPAY", razorpayPaymentLinkId, paymentLinkShortUrl }`.

### 10.2 Email Integration (`backend/src/integrations/emailIntegration.ts`)
- **Transporter**: Nodemailer configured with `SMTP_HOST` (default `localhost`) and `SMTP_PORT` (default `1025` for Mailhog).
- **Personalized Email Copywriter (`draftRecoveryEmail` in `executorService.ts`):**
  Uses the LLM to generate empathetic, cause-specific dunning copy incorporating the customer name, amount, failure reason, and embedded payment URL.

### 10.3 Mock Ticketing Integration (`backend/src/integrations/ticketMock.ts`)
- **Escalation (`escalateToHuman(entityId, reason)`):**
  Creates a row in the `Ticket` table with `status = 'open'`, capturing the reasoning for compliance review.

### 10.4 Voyage AI Integration (`backend/src/config/voyage.ts`)
- **Endpoint**: `https://api.voyageai.com/v1/embeddings`
- **Model**: `voyage-3` (1024 dimensions)
- **Input Types**: `"document"` for indexing terminal audit cases; `"query"` for runtime similar case search and natural-language assistant queries.

---

## 11. Complete REST & WebSocket API Specification

Base URL: `http://localhost:4000`

### 11.1 API Endpoints

#### 1. `GET /health`
- **Purpose**: System healthcheck.
- **Response `200 OK`**: `{ "status": "ok", "service": "razorrecovery-backend" }`

#### 2. `GET /entities`
- **Purpose**: Paginated, filterable, sortable query across all revenue entities.
- **Query Parameters**:
  - `page` (integer, default: 1), `limit` (integer, default: 20, max: 100)
  - `window` (`"1h" | "24h" | "7d" | "all"`, optional)
  - `state` (`"DETECTED" | "CONTACTED" | "RETRYING" | "COOLING_DOWN" | "ESCALATED" | "RECOVERED" | "WRITTEN_OFF" | "DO_NOT_CONTACT"`)
  - `cause`, `eventType`, `minAmount`, `maxAmount`, `search`, `sort`
- **Response `200 OK`**:
  ```json
  {
    "items": [
      {
        "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "entityType": "INVOICE",
        "entityId": "inv-12345",
        "customerId": "cust-987",
        "customerName": "Aarav Sharma",
        "customerEmail": "aarav.sharma@example.test",
        "eventType": "INVOICE_OVERDUE",
        "amount": 5400.0,
        "currency": "INR",
        "occurredAt": "2026-08-27T12:00:00.000Z",
        "riskScore": 0.675,
        "state": "CONTACTED",
        "stage": "EXECUTED",
        "causeLabel": "invoice_overdue",
        "diagnosisMethod": "RULE",
        "actionType": "send_payment_link",
        "actionResult": "success",
        "actionIntegration": "RAZORPAY",
        "razorpayPaymentId": "pay_sim_123",
        "razorpayOrderId": "order_sim_456",
        "lastContactedAt": "2026-08-27T12:00:05.000Z",
        "attemptCount": 1,
        "totalEventsCount": 1
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
  ```

#### 3. `GET /entities/:id/audit`
- **Purpose**: Returns the full cryptographically chained audit trail, workflow state, and event history for an entity or event ID.
- **Response `200 OK`**:
  ```json
  {
    "entityId": "entity-uuid-1",
    "customer": { "id": "cust-987", "name": "Aarav Sharma", "email": "aarav@example.test", "dncFlag": false },
    "workflowState": {
      "id": "wf-uuid-1",
      "entityId": "entity-uuid-1",
      "state": "CONTACTED",
      "attemptCount": 1,
      "lastContactedAt": "2026-08-27T12:00:05.000Z",
      "cooldownUntil": null,
      "updatedAt": "2026-08-27T12:00:05.000Z"
    },
    "events": [ ... ],
    "auditEntries": [
      {
        "id": "audit-uuid-1",
        "eventId": "event-uuid-1",
        "entityId": "entity-uuid-1",
        "actor": "system",
        "outcome": "pending",
        "inputSnapshot": { "id": "...", "amount": 5400, "riskScore": 0.675 },
        "diagnosisSnapshot": { "causeLabel": "invoice_overdue", "confidence": 1, "method": "RULE" },
        "decisionSnapshot": { "chosenAction": "send_payment_link", "legalActions": ["retry_payment", "send_payment_link"], "reasoning": "..." },
        "actionSnapshot": { "actionType": "send_payment_link", "result": "success", "integration": "RAZORPAY", "paymentLinkShortUrl": "https://rzp.io/l/xyz" },
        "timestamp": "2026-08-27T12:00:06.000Z",
        "sequenceNumber": 1,
        "prevHash": "d7c09e32ebdfa4ba13e9ef94a91b828552fe899d08ccd52969f4882651343b5d",
        "hash": "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0",
        "state": "CONTACTED",
        "event": { ... }
      }
    ]
  }
  ```

#### 4. `GET /metrics/summary`
- **Query Parameters**: `window` (`"1h" | "24h" | "7d" | "all"`, default: `"24h"`)
- **Response `200 OK`**:
  ```json
  {
    "window": "24h",
    "amountAtRisk": 150000.0,
    "amountRecovered": 95000.0,
    "recoveryRate": 0.6333,
    "eventsProcessed": 45,
    "funnel": [
      { "stage": "detected", "count": 45 },
      { "stage": "diagnosed", "count": 45 },
      { "stage": "contacted", "count": 38 },
      { "stage": "recovered", "count": 28 }
    ],
    "byCause": [
      { "cause": "invoice_overdue", "recovered": 45000.0, "atRisk": 50000.0 }
    ],
    "byChannel": [
      { "channel": "razorpay", "count": 25, "recoveredCount": 20, "recoveredAmount": 65000.0 },
      { "channel": "email", "count": 15, "recoveredCount": 8, "recoveredAmount": 30000.0 },
      { "channel": "human", "count": 5, "recoveredCount": 0, "recoveredAmount": 0.0 }
    ],
    "medianTimeToRecoveryHours": 1.45,
    "compliance": { "dncBlocked": 3, "autoEscalated": 4, "cooldownStopped": 2 }
  }
  ```

#### 5. `GET /metrics/trend`
- **Query Parameters**: `window` (`"1h" | "24h" | "7d" | "all"`), `bucket` (`"hour" | "day"`)
- **Response `200 OK`**:
  ```json
  [
    { "bucketStart": "2026-08-27T10:00:00.000Z", "eventsProcessed": 12, "amountRecovered": 24000.0 },
    { "bucketStart": "2026-08-27T11:00:00.000Z", "eventsProcessed": 18, "amountRecovered": 38000.0 }
  ]
  ```

#### 6. `GET /policy`
- **Query Parameters**: `page`, `limit`, `dncPage`, `dncLimit`
- **Response `200 OK`**: `{ "policy": { ... }, "dncList": { ... }, "complianceLog": { ... } }`

#### 7. `GET /audit/verify`
- **Purpose**: Verifies SHA-256 cryptographic hash chain integrity over all audit records or a bounded sequence range.
- **Query Parameters**: `fromSequence` (optional, default: 1), `toSequence` (optional)
- **Response `200 OK` (Valid)**: `{ "valid": true, "entriesChecked": 50 }`
- **Response `200 OK` (Tampered)**: `{ "valid": false, "entriesChecked": 24, "brokenAtEntryId": "audit-uuid-25", "brokenAtSequence": 25 }`

#### 8. `POST /query`
- **Purpose**: Natural-language audit trail assistant with grounded citation returns.
- **Request Body**:
  ```json
  {
    "question": "Why was this customer escalated to human support?",
    "entityId": "inv-12345"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "answer": "Entity [entity:inv-12345] was escalated to human support because a formal billing dispute was detected, which under policy overrides automated dunning.",
    "citedEntityIds": ["inv-12345"]
  }
  ```

#### 9. `POST /webhooks/razorpay`
- **Headers**: `X-Razorpay-Signature: <hex-hmac-sha256>`
- **Security**: Validated using HMAC-SHA256 and `crypto.timingSafeEqual`.
- **Supported Events**:
  - `payment.captured` / `payment_link.paid`: Resolves matching `Action`, `RevenueEvent`, and any associated `PromiseToPay` commitments (marking promise as `kept`), transitions `EntityWorkflowState` to `RECOVERED`, wipes `EntityCauseState`, writes `RECOVERED` ledger entry, records hash-chained `AuditEntry`, publishes to `revenue.audit` for vector indexing, and emits live WebSocket updates.
  - `refund.processed` / `payment.refunded`: Queries original `RECOVERED` ledger entry and writes a `REVERSED` ledger entry.
- **Response `200 OK`**: `{ "status": "ok", "processed": true }`

#### 10. `GET /promises` & `GET /api/promises`
- **Purpose**: Lists all Promise-to-Pay commitments with status filtering and customer search.
- **Query Parameters**: `status`, `customerId`, `entityId`, `search`, `page`, `limit`
- **Response `200 OK`**: Paginated array of `FormattedPromiseToPay` records with real-time `msRemaining` and `isOverdue` calculations.

#### 11. `GET /promises/stats`
- **Purpose**: Summary metrics for Promise-to-Pay dashboard.
- **Response `200 OK`**:
  ```json
  {
    "totalCount": 18,
    "pendingCount": 5,
    "reminderSentCount": 3,
    "keptCount": 8,
    "brokenCount": 2,
    "totalPromisedAmount": 95000.0,
    "totalRecoveredAmount": 62000.0
  }
  ```

#### 12. `POST /promises`
- **Purpose**: Creates a new Promise-to-Pay agreement, optionally generating a Razorpay Payment Link and dispatching confirmation email.
- **Request Body**: `{ customerId, entityId, amount, promisedDate, notes, sendEmail }`
- **Response `201 Created`**: Created `FormattedPromiseToPay` object.

#### 13. `POST /promises/:id/send-reminder`
- **Purpose**: Manually triggers reminder email dispatch for a promise.
- **Response `200 OK`**: `{ message: "Reminder email sent successfully.", promise: ... }`

#### 14. `GET /tickets`
- **Purpose**: Paginated list of human escalation tickets with status and priority filtering.
- **Query Parameters**: `status` (`open | resolved | recovered | written_off | closed`), `search`, `page`, `limit`
- **Response `200 OK`**: Paginated `TicketSummaryDto` records including customer context and revenue event snapshots.

#### 15. `GET /tickets/stats`
- **Purpose**: Helpdesk escalation summary counts and financial at-risk totals.
- **Response `200 OK`**: `{ openCount, recoveredCount, totalAtRisk, totalRecovered }`

#### 16. `POST /tickets/:id/notes`
- **Purpose**: Appends an internal note or agent communication entry to a ticket thread.
- **Request Body**: `{ content, author, type }`
- **Response `201 Created`**: Created `TicketNote` object.

#### 17. `POST /tickets/:id/send-email`
- **Purpose**: Dispatches a direct outreach email from support agents to the customer with optional Razorpay payment link.
- **Request Body**: `{ subject, message, includePaymentLink, agentName }`
- **Response `200 OK`**: `{ message: "Email sent successfully", emailMessageId, paymentLinkUrl }`

#### 18. `POST /tickets/:id/resolve`
- **Purpose**: Resolves or recovers an escalated ticket, closing the workflow arc and recording `RECOVERED` or `WRITTEN_OFF` ledger entries.
- **Request Body**: `{ status, resolutionNotes, agentName, recoveredAmount }`
- **Response `200 OK`**: `{ message: "Ticket updated successfully", ticket: ... }`

---

### 11.2 WebSocket Server Contract (`backend/src/api/websocket.ts`)

- **Protocol**: Socket.IO over WebSocket (with long-polling fallback).
- **Channels**: Single global broadcast channel.
- **Events Emitter Schema**:

```typescript
// 1. Ingestion stage event (emitted by Detection Consumer)
socket.emit("event:incoming", {
  eventId: string,
  entityId: string,
  customerId: string,
  customerName: string,
  eventType: string,
  amount: number,
  currency: string,
  occurredAt: string,
  riskScore: number,
  synthesized?: boolean,
  followUpType?: string
});

// 2. Audit stage event (emitted by Audit Consumer)
socket.emit("activity:new", {
  entityId: string,
  timestamp: string,
  customerId: string,
  customerName: string,
  eventType: string,
  cause: string,
  action: string,
  actionResult: string | null,
  outcome: string
});

// 3. Metrics update event (emitted by Audit Consumer & Webhook)
socket.emit("metrics:update", fullMetricsSummaryObject);
```

---

## 12. Complete Frontend Specification

### 12.1 Overview Dashboard (`frontend/app/page.tsx`)
- **Header**: Title + `<WindowSelector>` driving active rolling window (`1h | 24h | 7d | all`).
- **`<IncomingEventFeed>`**: Displays raw events entering the pipeline in real-time (`event:incoming`) with scheduler badges (`⟳ scheduler: ...`).
- **`<HeroMetrics>`**: Four animated counting cards (Amount at Risk ₹, Amount Recovered ₹, Recovery Conversion Rate %, Events Processed).
- **`<LiveActivityFeed>`**: Live chronological stream of audit outcomes (`activity:new`) with color-coded outcome pills. Clicking any row navigates to `/entities/[id]`.
- **`<FunnelChart>`**: Recharts bar chart showing progression through `detected → diagnosed → contacted → recovered`.
- **`<CauseChannelCharts>`**: Cause breakdown donut chart + channel efficiency grouped bar chart.
- **`<ComplianceStrip>`**: Real-time counter pill badges for `DNC Blocked`, `Auto-Escalated`, and `Cooldown Stopped`.

---

### 12.2 Entities Management Page (`frontend/app/entities/page.tsx`)
- **Filter Bar**: Full server-side query filters for text search (name/email/ID), workflow state, failure cause, event type, min amount, and max amount.
- **`<EntityTable>`**: Sortable table displaying Customer, Event Type, Amount (₹), Workflow State, Stage (`DETECTED | DIAGNOSED | DECIDED | EXECUTED`), Risk Score, Attempt Count, Action Result, Total Events badge, and Timestamp.
- **Pagination**: Server-side pagination controls with selectable page limits (10, 20, 50, 100).

---

### 12.3 Entity Detail, Audit Timeline & Grounded AI Assistant (`frontend/app/entities/[id]/page.tsx`)
- **Customer Banner**: Displays Customer Name, Email, Entity ID, Workflow State badge, Event Type, Amount at Risk, Total Attempts, Cooldown Window, Last Contact Date, active Promises-to-Pay, and active DNC / Dispute flags.
- **2-Column Layout**:
  - **Left Column (`<AuditTimeline>`)**: Step-by-step chronological audit sequence with prominent AI reasoning callouts (Diagnosis Reasoning & Decision Reasoning), payment settlement cards, and expandable raw JSON snapshot inspectors (`inputSnapshot`, `diagnosisSnapshot`, `decisionSnapshot`, `actionSnapshot`).
  - **Right Column / Floating Bar (`<FloatingAuditAIBar>` & `<AuditQueryPanel>`)**: Natural-language assistant strictly grounded in the entity's immutable audit history with rotating suggested quick prompts and slide-out chat drawer.

---

### 12.4 Promise-to-Pay Operations Console (`frontend/app/promises/page.tsx` & `[id]/page.tsx`)
- **Overview & KPI Cards**: Active metrics summary tracking Total Promised (₹), Amount Recovered (₹), Pending Promises, Reminders Sent, Kept vs Broken counts.
- **Create Promise Modal (`<CreatePromiseModal>`)**: Interactive dialog with customer auto-complete combobox (`<CustomerSearchCombobox>`), preset date buttons (+3, +7, +14 days), amount validation, and automated payment link generation.
- **Promise List & Detail Views**: Filterable commitments queue with live countdown timers (`<CountdownTimer>`), reminder email triggers, and direct payment link copy buttons.

---

### 12.5 Helpdesk Escalation Tickets (`frontend/app/tickets/page.tsx` & `[id]/page.tsx`)
- **Escalations Dashboard**: Ticket queues partitioned by priority (`high | medium | low`) and status (`open | recovered | written_off | resolved`).
- **Ticket Detail & Resolution Console**:
  - Chronological activity feed combining automated system audit entries and human notes.
  - Internal Notes thread with agent author attribution.
  - **Outreach Email Modal (`<TicketEmailModal>`)**: Composes personalized agent emails with dynamic Razorpay payment link inclusion.
  - Resolution modal with financial recovery tracking and atomic ledger recording.

---

### 12.6 Analytics, Unit Economics & Cross-Entity Assistant (`frontend/app/metrics/page.tsx`)
- **Stream Throughput Trend Chart**: Hourly bucketed bar chart tracking events processed vs. ₹ recovered over time.
- **Recovery by Cause Table**: Sortable table breaking down recovery conversion percentages by failure cause.
- **Channel Cost-per-Recovery Unit Economics**: Presentation overlay mapping communication costs (`Email: ₹0.50`, `SMS: ₹1.50`, `Razorpay Link: ₹1.00`, `Human Escalation: ₹200.00`) against recovered revenue to calculate net ROI and cost-per-event.
- **Dataset Exporters**: Direct client-side buttons to export the active dataset to `.json` or `.csv`.
- **System-Wide Audit Intelligence (`<AuditQueryPanel>`)**: Cross-entity natural-language Q&A powered by pgvector semantic retrieval with clickable citations.

---

### 12.5 Policy, Compliance & Audit Integrity Center (`frontend/app/policy/page.tsx`)
- **`<AuditChainVerifier>`**: Live cryptographic audit hash chain integrity verification widget. Queries `GET /audit/verify`, displaying green badge confirmation on valid chains (`✓ N entries verified`) and alerting on any tampering with the exact sequence number, entry ID, and link to the offending entity detail page.
- **`<PolicyTable>`**: Direct rendering of the declarative `policy.json` rules showing allowed actions and JSON stopping rules per cause.
- **DNC Registry Table**: Paginated list of all active Do-Not-Contact customer IDs from Redis and PostgreSQL.
- **Compliance Audit Log**: Paginated table listing all actions that were blocked or escalated by guardrails.

---

## 13. Configuration Specification

### Complete `.env.example` Reference

```ini
# ==============================================================================
# RazorRecovery Environment Configuration
# ==============================================================================

# --- Database (PostgreSQL 16+ with pgvector) ---
DATABASE_URL=postgresql://razorrecovery:razorrecovery@localhost:5432/razorrecovery

# --- Redis Cache & Deduplication ---
REDIS_URL=redis://localhost:6379

# --- Kafka / Redpanda Message Broker ---
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=razorrecovery-backend

# --- Razorpay (Test Mode Credentials) ---
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxx

# --- LLM Endpoint (OpenAI-compatible / OpenRouter / Gemini API) ---
LLM_API_KEY=xxxxxxxxxxxxxxxxxxxx
LLM_MODEL=gemini-3.1-flash-lite
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/

# --- Voyage AI (RAG embeddings & semantic search) ---
VOYAGE_API_KEY=pa-xxxxxxxxxxxxxxxxxxxx
VOYAGE_MODEL=voyage-3

# --- Email Transport (Mailhog for development) ---
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=billing@razorrecovery.demo

# --- Backend Server Configuration ---
PORT=4000
CORS_ORIGIN=http://localhost:3000

# --- Frontend Configuration (Next.js) ---
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000
```

---

## 14. Testing & Verification Specification

The test suite is built on **Jest** + **@swc/jest** with sequential in-band worker execution (`maxWorkers: 1`) and contains **18 test suites with 208 passing tests**:

| Test File | Test Scope & Assertions |
| :--- | :--- |
| `hashChain.test.ts` | Validates canonicalization key sorting, array preservation, primitives, `GENESIS_HASH` stability, and hash determinism. |
| `redaction.test.ts` | Asserts recursive PII masking for flat/deeply nested objects and arrays of objects while keeping non-sensitive values untouched. |
| `auditChain.test.ts` | Integration tests for serialized transactional hash chaining, valid chain verification, mid-chain verification, direct SQL tampering detection on `outcome`/`inputSnapshot`/`actor`, 50-entry bulk verification, and concurrent non-forking writes. |
| `riskScoring.test.ts` | Validates risk formula weights, normalized amount capping, urgency calculations for overdue invoices and carts, repeat offender capping ($H_{\text{cust}} \le 1.0$), and severity differentials. |
| `policy.test.ts` | Asserts each policy rule in `policy.json`, DNC empty list override, dispute escalation override, and attempt count pruning. |
| `stateMachine.test.ts` | Validates all state transitions in guard table, verifies terminal states (`RECOVERED`, `WRITTEN_OFF`, `DO_NOT_CONTACT`) have 0 outgoing transitions, and asserts illegal transitions throw errors. |
| `intelligence.test.ts` | Asserts Tier 1 diagnosis makes zero network/LLM calls for known Razorpay reasons; asserts Tier 2 LLM fallback retries on invalid enum labels; asserts decision engine short-circuits on 0 and 1 legal actions without calling LLM; asserts LLM action choice is strictly validated against legal actions. |
| `integrations.test.ts` | Tests Razorpay API SDK adapter, Nodemailer SMTP delivery adapter, and ticket mock persistence. |
| `execution.test.ts` | Tests full execution pipeline, email drafting with fallback template, Razorpay integration mocks, ticket persistence, `EntityCauseState` per-cause budget updates, and metrics aggregation over test events. |
| `followUpScheduler.test.ts` | Asserts `selectDueFollowUps` pure selection logic, cooldown expiration detection, budget enforcement, escalation skipping, terminal arc ignoring, and scheduled retry dispatch/cancellation. |
| `simulator.test.ts` | Validates synthetic failure generation across all 4 event types and verifies error reasons match official Razorpay vocabulary. |
| `api.test.ts` | Validates Express route responses, query filter parsing, entity pagination, metrics summary shapes, `/audit/verify` verification endpoint, and Razorpay webhook HMAC signature verification. |
| `ledger.test.ts` | Tests `writeLedgerEntry` creation, idempotency, append-only database rule enforcement preventing SQL `UPDATE` and `DELETE`, metrics calculation with `AT_RISK`/`RECOVERED`/`REVERSED`, and deterministic reference IDs. |
| `voyage.test.ts` | Tests Voyage AI embedding client document/query request shapes, Authorization headers, and 1024-dimension enforcement. |
| `embeddingService.test.ts` | Validates amount bucket categorization (`under_500`, `500_to_2000`, `2000_to_10000`, `over_10000`), case summary text builder, and terminal outcome filtering (`recovered`, `written_off`, `escalated`). |
| `ragServices.test.ts` | Tests end-to-end audit entry vectorization, non-terminal gating, and pgvector cosine distance nearest-neighbor mapping (`findSimilarCases`). |
| `query.test.ts` | Tests citation extraction regex (`extractCitations`), entity-scoped grounded audit query Q&A, cross-entity vector retrieval fallback, and `POST /query` route validation. |
| `webhook.test.ts` | Tests HMAC signature validation, payment capture handling, clean reset of entity attempt counters to 0, and transactional ledger logging. |

Run tests in the `backend/` directory:
```bash
npm test
```

---

## 15. Complete Reconstruction & Build Sequence

To rebuild this entire project from scratch in an empty repository, execute the steps in the exact order below:

```mermaid
graph TD
    Step1[1. Repo Init & Docker Compose] --> Step2[2. Backend Setup & Dependencies]
    Step2 --> Step3[3. Prisma Schema & pgvector Migrations]
    Step3 --> Step4[4. Config Modules - DB, Redis, Kafka, LLM, Voyage]
    Step4 --> Step5[5. Domain Logic, Types & Hash Chain]
    Step5 --> Step6[6. Integrations, Ledger & Simulator]
    Step6 --> Step7[7. Intelligence, Services & RAG]
    Step7 --> Step8[8. Kafka Topics & 6 Consumers]
    Step8 --> Step9[9. Scheduler, Query Service & API Routes]
    Step9 --> Step10[10. Frontend Setup, UI Components & AI Panel]
    Step10 --> Step11[11. Verification & End-to-End Test]
```

### Detailed Step-by-Step Instructions

#### Step 1: Initialize Repository & Infrastructure
1. Create root directory with `.gitignore`, `docker-compose.yml`, and `.env.example`.
2. Define PostgreSQL 16 with pgvector (`image: pgvector/pgvector:pg16`), Redis 7 (`6379`), Redpanda Kafka (`9092`), and Mailhog (`1025`/`8025`) in `docker-compose.yml`.
3. Start infrastructure: `docker compose up -d postgres redis redpanda mailhog`.

#### Step 2: Initialize Backend Project
1. Create `backend/package.json` with dependencies:
   - `@prisma/client`, `@prisma/adapter-pg`, `pg`, `express`, `cors`, `dotenv`, `kafkajs`, `ioredis`, `socket.io`, `razorpay`, `nodemailer`, `openai`, `zod`.
   - Dev dependencies: `typescript`, `tsx`, `prisma`, `jest`, `@swc/core`, `@swc/jest`, `ts-jest`, `@types/...`.
2. Initialize `tsconfig.json` with `target: ES2020`, `module: commonjs`, `strict: true`.

#### Step 3: Configure Database & Run Migrations
1. Create `backend/prisma/schema.prisma` with all models (`AuditEmbedding`, `LedgerEntry`, `AuditChainHead`, `EntityWorkflowState`, etc.).
2. Run migrations: `npx prisma migrate dev --name init`.
3. Apply SQL rules for append-only `LedgerEntry` table and IVFFlat index on `AuditEmbedding`.
4. Create `backend/prisma/seed.ts` seeding `AuditChainHead` with `GENESIS_HASH` and calling `seedEntities({ customers: 20 })`.

#### Step 4: Implement Backend Configuration Modules
1. `src/config/env.ts`: Zod schema validating all environment variables (including `VOYAGE_API_KEY`).
2. `src/config/prisma.ts`: Singleton `PrismaClient` with pg adapter.
3. `src/config/redis.ts`: Singleton `ioredis` instance.
4. `src/config/kafka.ts`: Singleton `kafkajs` instance.
5. `src/config/razorpay.ts`: Singleton `Razorpay` instance.
6. `src/config/mailer.ts`: Nodemailer SMTP transport.
7. `src/config/openai.ts`: Resilient OpenAI client with structured JSON schema support, rate limit retries (429 backoff), and plain JSON prompt fallback.
8. `src/config/voyage.ts`: Voyage AI embedding client (`voyage-3`, 1024 dimensions).
9. `src/config/logger.ts`: Concise error logging helpers (`logError`, `renderError`).

#### Step 5: Implement Domain Layer
1. `src/domain/types.ts`: Shared interfaces, enums, `DomainError`.
2. `src/domain/hashChain.ts`: Cryptographic hash chain engine (`GENESIS_HASH`, `canonicalize`, `computeEntryHash`).
3. `src/domain/redaction.ts`: Recursive PII masking (`redactPII`, `maskEmail`, `maskPhone`).
4. `src/domain/policy.json`: Declarative v2 catalog and stopping conditions (5 revenue-leakage rules, value-based escalation knob).
5. `src/domain/policy.ts`: Policy loader and cached lookup functions.
6. `src/domain/riskScoring.ts`: Pure risk score formula implementation.
7. `src/domain/stoppingRules.ts`: Pure `filterLegalActions` function.
8. `src/domain/stateMachine.ts`: Guard table and `nextState` transition mapper.
9. `src/domain/eventEnvelope.ts`: Partner ingestion envelope types + pure field-level validators.

#### Step 6: Implement Simulator, Integrations & Financial Ledger
1. `src/services/ingestService.ts`: Unified partner ingestion — envelope validation, idempotency (Redis marker + key-reuse conflict detection), customer/entity upserts, Kafka publish.
2. `src/api/routes/ingest.ts`: `POST /api/v1/events` with shared API-key auth (constant-time digest compare) and typed HTTP error mapping.
3. `src/simulator/partnerEvents.ts`: Partner-shaped envelope factories with realistic distributions, driving the real ingestion path.
4. `src/simulator/seedEntities.ts`: Demo customer seed generator (with ~4% DNC fixtures).
5. `src/services/ledgerService.ts`: `writeLedgerEntry` with idempotency and amount validation.
6. `src/integrations/razorpayIntegration.ts`: Razorpay payment link creation and order retry fetcher.
7. `src/integrations/emailIntegration.ts`: Nodemailer send helper.
8. `src/integrations/ticketMock.ts`: Escalation ticket database persistence.

#### Step 7: Implement Core Intelligence, RAG & Business Services
1. `src/services/diagnosisService.ts`: Deterministic-first rule classifier (partner-owned facts) with the LLM as fallback for payloads lacking expected signals.
2. `src/services/embeddingService.ts`: Case summary text builder (`buildCaseSummaryText`) and `indexAuditEntry`.
3. `src/services/retrievalService.ts`: Cosine similarity pgvector query service (`findSimilarCases`).
4. `src/services/decisionService.ts`: Bounded decision arbitrator with RAG case retrieval, the `escalateAboveAmount` policy trigger, and membership re-validation.
5. `src/services/executorService.ts`: Action dispatcher, LLM-based `draftRecoveryEmail`, and Action row persistence.
6. `src/services/auditService.ts`: Hash-chained audit writer (`writeChainedAuditEntry`), verification engine (`verifyChain`), state transitions, per-cause `EntityCauseState` tracking, and the shared `announceAuditEntry` post-commit fan-out.
7. `src/services/queryService.ts`: Natural-language audit query assistant with citation grounding (`queryAuditTrail`).
8. `src/services/metricsService.ts`: Rolling window metrics aggregation directly over `LedgerEntry` rows, funnel counts, and Redis caching.

#### Step 8: Implement Kafka Infrastructure & 6 Consumers
1. `src/kafka/topics.ts`: Registry of all 6 topic names.
2. `src/kafka/producer.ts`: Shared connected producer wrapper.
3. `src/scripts/createTopics.ts`: Kafka admin script to create topics on broker.
4. Implement all 6 consumers in `src/kafka/consumers/`:
   - `detectionConsumer.ts` (subscribes to `revenue.events.raw`, writes `AT_RISK` ledger)
   - `diagnosisConsumer.ts` (subscribes to `revenue.events.enriched`)
   - `decisionConsumer.ts` (subscribes to `revenue.diagnoses`, queries RAG cases)
   - `executorConsumer.ts` (subscribes to `revenue.decisions`)
   - `auditConsumer.ts` (subscribes to `revenue.actions`, writes `RECOVERED`/`WRITTEN_OFF` ledger)
   - `embeddingConsumer.ts` (subscribes to `revenue.audit`, indexes terminal cases in pgvector)

#### Step 9: Implement Scheduler, API Routes & Server
1. `src/scheduler/followUpScheduler.ts`: 30-second clock-driven scheduler for cooldown expiration, no-response timeouts, and deferred retries.
2. `src/api/websocket.ts`: Socket.IO broadcaster (`activity:new`, `metrics:update`, `event:incoming`).
3. `src/api/webhooks/razorpayWebhook.ts`: HMAC signature verification, payment/refund recovery handler with transactional audit chain write and `RECOVERED`/`REVERSED` ledger entry.
4. `src/api/routes/entities.ts`, `routes/metrics.ts`, `routes/policy.ts`, `routes/audit.ts`, `routes/query.ts`: Express route handlers.
5. `src/api/server.ts`: Express application assembly, rawBody retention, and HTTP server setup.
6. `src/index.ts`: Bootstraps producer, all 6 consumers, follow-up scheduler, Express server, and graceful shutdown handlers.

#### Step 10: Initialize Frontend & Build UI Components
1. Initialize Next.js 16 app in `frontend/` with TypeScript and Tailwind CSS.
2. `frontend/types/index.ts`: Mirror backend data structures (including `AuditVerifyResult`, `AuditQueryResponse`).
3. `frontend/lib/api.ts`: Axios client for backend API endpoints (including `verifyAuditChain`, `askAuditQuery`).
4. `frontend/lib/socket.ts`: Module-level singleton Socket.IO connection and `useLiveStream` hook.
5. Create UI components in `frontend/components/`:
   - `Nav.tsx`, `WindowSelector.tsx`, `HeroMetrics.tsx`, `IncomingEventFeed.tsx`, `LiveActivityFeed.tsx`, `FunnelChart.tsx`, `CauseChannelCharts.tsx`, `ComplianceStrip.tsx`, `EntityTable.tsx`, `AuditTimeline.tsx`, `PolicyTable.tsx`, `AuditChainVerifier.tsx`, `AuditQueryPanel.tsx`.
6. Implement Next.js pages:
   - `app/layout.tsx`
   - `app/page.tsx` (Overview & Operations Center)
   - `app/entities/page.tsx` (Entities List)
   - `app/entities/[id]/page.tsx` (Audit Trail & Entity-Scoped AI Assistant)
   - `app/metrics/page.tsx` (Analytics, Unit Economics & System-Wide AI Assistant)
   - `app/policy/page.tsx` (Policy, Compliance & Audit Integrity Verification)

#### Step 11: End-to-End Verification
1. Run backend tests: `cd backend && npm test`.
2. Seed base database: `cd backend && npm run seed`.
3. Start backend: `cd backend && npm run dev`.
4. Start frontend: `cd frontend && npm run dev`.
5. Run the interactive demo driver (all showcase beats over the real ingest API): `cd backend && npm run demo`.
6. Test payment webhook: `cd backend && npm run test:webhook`.
7. Verify live updates, RAG-guided decisions, and grounded audit queries at `http://localhost:3000`.

---

## 16. File-Level Reconstruction Map

| File Path | Subsystem | Responsibility | Key Dependencies | Required For |
| :--- | :--- | :--- | :--- | :--- |
| `docker-compose.yml` | Infra | Containers for PG (pgvector), Redis, Redpanda Kafka, Mailhog | Docker | Development / Demo |
| `backend/prisma/schema.prisma` | DB | Relational & vector data schema & migrations | Prisma, PostgreSQL, pgvector | Runtime |
| `backend/src/config/env.ts` | Config | Validates all environment variables using Zod | `zod`, `dotenv` | Runtime |
| `backend/src/config/prisma.ts` | DB | Singleton Prisma Client | `@prisma/client`, `@prisma/adapter-pg` | Runtime |
| `backend/src/config/redis.ts` | Cache | Singleton Redis Client & Key namespace documentation | `ioredis` | Runtime |
| `backend/src/config/kafka.ts` | Messaging | Singleton KafkaJS Client | `kafkajs` | Runtime |
| `backend/src/config/openai.ts` | LLM | Resilient Chat Completions Client with backoff & fallbacks | `openai` | Runtime |
| `backend/src/config/voyage.ts` | RAG | Voyage AI 1024-dim embedding client (`voyage-3`) | `fetch`, `env.ts` | Runtime |
| `backend/src/config/razorpay.ts` | Integration | Singleton Razorpay SDK Client | `razorpay` | Runtime |
| `backend/src/config/mailer.ts` | Integration | Singleton Nodemailer SMTP transport | `nodemailer` | Runtime |
| `backend/src/domain/types.ts` | Domain | Domain interfaces, enums, `DomainError` | Pure TS | Runtime |
| `backend/src/domain/hashChain.ts` | Domain | Cryptographic SHA-256 hash chain and canonicalizer | `crypto` | Runtime |
| `backend/src/domain/redaction.ts` | Domain | Recursive PII masking and redaction utility | Pure TS | Runtime |
| `backend/src/domain/riskScoring.ts` | Domain | Mathematical risk score calculation | `types.ts` | Runtime |
| `backend/src/domain/policy.json` | Domain | Declarative recovery rules and stopping conditions | JSON | Runtime |
| `backend/src/domain/policy.ts` | Domain | Cached policy loader | `policy.json` | Runtime |
| `backend/src/domain/stoppingRules.ts` | Domain | Pure deterministic legal action filter | `policy.ts` | Runtime |
| `backend/src/domain/stateMachine.ts` | Domain | Pure state transition guard table and validator | `types.ts` | Runtime |
| `backend/src/domain/eventEnvelope.ts` | Domain | Partner ingestion envelope types & pure validators | Pure TS | Runtime |
| `backend/src/simulator/seedEntities.ts` | Simulator | Realistic demo customer seed generator | Prisma | Development |
| `backend/src/simulator/partnerEvents.ts` | Simulator | Partner-shaped envelope factories driving the real ingest path | `eventEnvelope.ts`, `ingestService.ts` | Runtime |
| `backend/src/services/ingestService.ts` | Ingestion | Unified partner ingestion: validation, idempotency, upserts, publish | `eventEnvelope.ts`, `redis.ts`, `producer.ts` | Runtime |
| `backend/src/api/routes/ingest.ts` | API | `POST /api/v1/events` with API-key auth & typed error mapping | Express, `ingestService.ts` | Runtime |
| `backend/src/integrations/razorpayIntegration.ts` | Integration | Razorpay Payment Link creation & Order retry | `razorpay.ts` | Runtime |
| `backend/src/integrations/emailIntegration.ts` | Integration | Nodemailer email delivery | `mailer.ts` | Runtime |
| `backend/src/integrations/ticketMock.ts` | Integration | Escalation ticket database persistence | `prisma.ts` | Runtime |
| `backend/src/services/ledgerService.ts` | Ledger | Append-only financial ledger writer | `prisma.ts`, `types.ts` | Runtime |
| `backend/src/services/embeddingService.ts` | RAG | Terminal case summary formatter & vector indexer | `prisma.ts`, `voyage.ts` | Runtime |
| `backend/src/services/retrievalService.ts` | RAG | Cosine similarity pgvector query service | `prisma.ts`, `voyage.ts` | Runtime |
| `backend/src/services/queryService.ts` | Assistant | Citation-grounded natural-language audit Q&A | `prisma.ts`, `openai.ts`, `voyage.ts` | Runtime |
| `backend/src/services/diagnosisService.ts` | Intelligence | Deterministic-first rule diagnosis with LLM fallback | `openai.ts`, `types.ts` | Runtime |
| `backend/src/services/decisionService.ts` | Intelligence | Policy-bounded LLM action selection with RAG context & value-based escalation | `openai.ts`, `retrievalService.ts` | Runtime |
| `backend/src/services/executorService.ts` | Execution | Action dispatching & LLM email drafting | Integrations, `openai.ts` | Runtime |
| `backend/src/services/auditService.ts` | Audit | Hash-chained audit writer, verifyChain, state transitions, announce fan-out | `prisma.ts`, `hashChain.ts` | Runtime |
| `backend/src/services/metricsService.ts` | Analytics | Rolling window metrics aggregation & ledger aggregation | `prisma.ts`, `redis.ts` | Runtime |
| `backend/src/scheduler/followUpScheduler.ts` | Scheduler | 30s loop for cooldowns, timeouts, deferred retries | `prisma.ts`, `redis.ts`, `producer.ts` | Runtime |
| `backend/src/kafka/topics.ts` | Messaging | Kafka topic name constants (6 topics) | Pure TS | Runtime |
| `backend/src/kafka/producer.ts` | Messaging | Shared Kafka producer wrapper | `kafka.ts`, `topics.ts` | Runtime |
| `backend/src/kafka/consumers/detectionConsumer.ts` | Pipeline | Ingestion, history loading, risk scoring, AT_RISK ledger | Kafka, Redis, Prisma, `riskScoring.ts` | Runtime |
| `backend/src/kafka/consumers/diagnosisConsumer.ts` | Pipeline | Cause diagnosis | Kafka, Redis, Prisma, `diagnosisService.ts`| Runtime |
| `backend/src/kafka/consumers/decisionConsumer.ts` | Pipeline | Policy evaluation, RAG retrieval & action choice | Kafka, Redis, Prisma, `decisionService.ts` | Runtime |
| `backend/src/kafka/consumers/executorConsumer.ts` | Pipeline | Multi-channel execution | Kafka, Redis, Prisma, `executorService.ts` | Runtime |
| `backend/src/kafka/consumers/auditConsumer.ts` | Pipeline | Audit trail recording, state update, RECOVERED ledger | Kafka, Redis, Prisma, `auditService.ts` | Runtime |
| `backend/src/kafka/consumers/embeddingConsumer.ts` | Pipeline | Asynchronous vector embedding indexing for terminal cases | Kafka, Redis, Prisma, `embeddingService.ts`| Runtime |
| `backend/src/api/websocket.ts` | API | Socket.IO server & live broadcasters | `socket.io`, `metricsService.ts` | Runtime |
| `backend/src/api/webhooks/razorpayWebhook.ts` | API | Razorpay webhook signature verification, payment/refund recovery | Express, `crypto`, `prisma.ts` | Runtime |
| `backend/src/api/routes/audit.ts` | API | Tamper-evident hash chain verification endpoint | Express, `auditService.ts` | Runtime |
| `backend/src/api/routes/entities.ts` | API | Entity listing, search, and audit endpoints | Express, `prisma.ts` | Runtime |
| `backend/src/api/routes/metrics.ts` | API | Rolling metrics summary and trend endpoints | Express, `metricsService.ts` | Runtime |
| `backend/src/api/routes/policy.ts` | API | Policy rules, DNC list, compliance log | Express, `prisma.ts`, `redis.ts` | Runtime |
| `backend/src/api/routes/query.ts` | API | Grounded natural-language audit trail Q&A endpoint | Express, `queryService.ts` | Runtime |
| `backend/src/api/server.ts` | API | Express application assembly & CORS | Express, `websocket.ts`, Routes | Runtime |
| `backend/src/index.ts` | Entrypoint | Application bootstrap & graceful shutdown | Server, 6 Consumers, Producer, Scheduler | Runtime |
| `backend/src/scripts/cleanDb.ts` | Script | Fast database table truncate script | `prisma.ts` | Maintenance |
| `backend/src/scripts/createTopics.ts` | Script | Kafka topic provisioning script | `kafkajs`, `topics.ts` | Setup |
| `backend/src/scripts/healthcheck.ts` | Script | Infrastructure connectivity verification script | All clients | Testing |
| `backend/src/scripts/runDemo.ts` | Script | Interactive beat-by-beat demo driver (ingest, escalation, payment beats) | `fetch`, `partnerevents`, `readline` | Demo |
| `backend/src/scripts/simulateWebhookPayment.ts` | Script | Razorpay payment webhook simulation script | `fetch`, `crypto`, `prisma.ts` | Testing |
| `frontend/lib/api.ts` | Frontend | Axios client functions | `axios`, `types` | Runtime |
| `frontend/lib/socket.ts` | Frontend | Socket.IO connection & `useLiveStream` hook | `socket.io-client` | Runtime |
| `frontend/app/layout.tsx` | Frontend | Root layout with navigation shell | React, `Nav.tsx` | Runtime |
| `frontend/app/page.tsx` | Frontend | Overview & Operations Center | React, Components | Runtime |
| `frontend/app/entities/page.tsx` | Frontend | Filterable, paginated entities table page | React, `EntityTable.tsx` | Runtime |
| `frontend/app/entities/[id]/page.tsx`| Frontend | Entity detail, audit timeline & grounded AI assistant | React, `AuditTimeline.tsx`, `AuditQueryPanel.tsx` | Runtime |
| `frontend/app/metrics/page.tsx` | Frontend | Deep metrics, unit economics & system-wide AI assistant | React, Recharts, `AuditQueryPanel.tsx` | Runtime |
| `frontend/app/policy/page.tsx` | Frontend | Policy rules, compliance log & Audit Integrity Verifier | React, `PolicyTable.tsx`, `AuditChainVerifier.tsx` | Runtime |
| `frontend/components/AuditChainVerifier.tsx` | Frontend | Cryptographic audit chain verification component | React, Lucide, API | Runtime |
| `frontend/components/AuditQueryPanel.tsx` | Frontend | Grounded natural-language audit trail assistant | React, Next Link, API | Runtime |

---

## 17. Operational Runbook & Known Discrepancies

### 17.1 Daily Operations & Diagnostic Commands

#### 1. Starting Infrastructure & Applications
```bash
# 1. Start all containerized backing services (PG with pgvector, Redis, Redpanda, Mailhog)
docker compose up -d postgres redis redpanda mailhog

# 2. Setup backend
cd backend
npm install
npx prisma migrate dev
npm run create-topics
npm run seed                  # Seeds AuditChainHead genesis and 50 test customers/invoices/carts

# 3. Start live backend pipeline (runs continuously with 6 consumers)
npm run dev

# 4. In a separate terminal, start frontend
cd ../frontend
npm install
npm run dev                   # Runs Next.js on http://localhost:3000

# 5. Optional: Run the curated demo beats (requires backend + consumers running)
cd ../backend
npm run demo

# 6. Optional: Simulate incoming Razorpay payment webhook
npm run test:webhook
```

#### 2. Viewing Logs & Infrastructure Health
```bash
# Check service health
cd backend && npm run healthcheck

# Inspect Mailhog inbox
open http://localhost:8025

# Inspect Kafka topics via Redpanda
docker exec -it $(docker ps -qf "ancestor=docker.redpanda.com/redpandadata/redpanda:latest") rpk topic list
```

---

### 17.2 Implementation Realities & Known Simplifications
1. **Continuous Stream Model**: The project operates on a continuous Kafka stream with rolling window analytics (`1h | 24h | 7d | all`). There is no discrete `batchId` or run table in the core domain.
2. **LLM Client Boundary**: The project uses the `openai` SDK pointing to OpenAI-compatible endpoints (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`) such as OpenRouter or Google Gemini's OpenAI-compatible endpoint, featuring automatic structured JSON schema detection with fallback to plain JSON prompting.
3. **Optional Voyage AI Dependency**: When `VOYAGE_API_KEY` is not provided, the core recovery pipeline continues operating normally without crashing; historical case retrieval gracefully returns empty context and audit Q&A falls back to recent audit entries.
4. **Database-Backed Scoped State**: Attempt counters, cooldown timestamps, and last contact dates are persisted in PostgreSQL (`EntityWorkflowState` and `EntityCauseState`), providing durability across application restarts.
5. **Currency Model**: Stored as major-unit `Float` (rupees) rather than integer paise to avoid conversion overhead.
6. **No Authentication**: The dashboard and REST endpoints are unauthenticated for development and demo agility.

---

## 18. Final System Blueprint

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     RazorRecovery Monorepo                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  ┌─────────────────────────┐                   ┌──────────────────────────────────────────────┐  │
│  │   Upstream / Ingestion   │                   │             Next.js 16 Frontend              │  │
│  │                         │                   │                                              │  │
│  │ • Webhook Ingestion     │                   │ • Overview (/): Hero, Incoming, Live Feed    │  │
│  │ • Failure Simulator     │                   │ • Entities (/entities): Server filter/sort   │  │
│  │ • Follow-Up Scheduler   │                   │ • Detail (/entities/[id]): Audit + AI Assist │  │
│  │ • Webhook Payment Test  │                   │ • Metrics (/metrics): Unit Econ + AI Assist  │  │
│  └───────────┬─────────────┘                   │ • Policy (/policy): Rules, DNC & Chain Verify│  │
│              │                                 └──────────────────────▲───────────────────────┘  │
│              ▼                                                        │                          │
│  ┌─────────────────────────┐                                          │ REST API & WebSockets    │
│  │   Kafka (Redpanda)      │                                          │                          │
│  │                         │                   ┌──────────────────────┴───────────────────────┐  │
│  │ • revenue.events.raw    │                   │           Express + Socket.IO API            │  │
│  │ • revenue.events.enr    │                   │                                              │  │
│  │ • revenue.diagnoses     │◄─────────────────►│ • /entities, /entities/:id/audit             │  │
│  │ • revenue.decisions     │                   │ • /metrics/summary, /metrics/trend           │  │
│  │ • revenue.actions       │                   │ • /policy, /webhooks/razorpay, /audit/verify │  │
│  │ • revenue.audit         │                   │ • /query (Grounded Natural-Language Q&A)     │  │
│  └───────────┬─────────────┘                   └──────────────────────┬───────────────────────┘  │
│              │                                                        │                          │
│              ▼                                                        ▼                          │
│  ┌─────────────────────────┐                   ┌──────────────────────────────────────────────┐  │
│  │   6 Pipeline Consumers  │                   │          State & Storage Engines             │  │
│  │                         │                   │                                              │  │
│  │ 1. Detection (RiskScore)│◄─────────────────►│ • PostgreSQL 16 + pgvector (Prisma ORM):    │  │
│  │ 2. Diagnosis (Rule/LLM) │                   │   Customer, Invoice, Cart, Subscription,     │  │
│  │ 3. Decision (Policy+RAG)│                   │   RevenueEvent, Diagnosis, Decision, Action, │  │
│  │ 4. Executor (Dispatch)  │                   │   AuditEntry, AuditChainHead, AuditEmbedding,│  │
│  │ 5. Audit (State+WS+Head)│                   │   LedgerEntry (Append-Only Rules),           │  │
│  │ 6. Embedding (Voyage AI)│                   │   EntityWorkflowState, EntityCauseState,     │  │
│  └───────────┬─────────────┘                   │   Ticket                                     │  │
│              │                                 │ • Redis 7:                                   │  │
│              ▼                                 │   Deduplication SETNX (1h TTL),              │  │
│  ┌─────────────────────────┐                   │   Metrics Cache (5s TTL),                    │  │
│  │ AI & Channel Adapters   │                   │   Rolling Max Risk Reference (24h TTL),      │  │
│  │                         │                   │   Fast-Cooldown / Fast-Recovered Locks,      │  │
│  │ • Razorpay Test Mode    │                   │   DNC In-Memory Customer Set                 │  │
│  │ • SMTP (Mailhog)        │                   └──────────────────────────────────────────────┘  │
│  │ • Mock Ticket Table     │                                                                     │
│  │ • Voyage AI (voyage-3)  │                                                                     │
│  │ • LLM API (OpenAI/Gem)  │                                                                     │
│  └─────────────────────────┘                                                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

This specification provides the exhaustive blueprint required to reconstruct **RazorRecovery** from 0% to 100% with identical architecture, functionality, schemas, integrations, and operational behavior.
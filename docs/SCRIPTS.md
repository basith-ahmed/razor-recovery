# RazorRecovery Scripts Reference

This document provides a quick reference for all the runnable scripts in the project.

## Backend Scripts

Run these commands from inside the `backend/` directory.

- **`npm run dev`** — Starts the backend API server and its embedded background workers in watch mode for local development.
- **`npm run build`** — Compiles the TypeScript backend into JavaScript within the `dist/` directory.
- **`npm run test`** — Runs the backend Jest unit and integration test suite.
- **`npm run migrate`** — Applies any pending Prisma schema changes to the PostgreSQL database.
- **`npm run generate`** — Regenerates the Prisma TypeScript client based on the current `schema.prisma`.
- **`npm run studio`** — Opens Prisma's web-based database UI on `localhost:5555` for visually inspecting rows.
- **`npm run seed`** — Seeds the database with the initial batch of simulated customers and entities.
- **`npm run clean`** — Rapidly truncates all database tables without dropping the schema or destroying the Docker volume.
- **`npm run reset`** — Fast-cleans the database and immediately re-runs the seed script to provide a completely fresh starting state.
- **`npm run create-topics`** — Idempotently initializes the required Kafka topics for the event stream.
- **`npm run start-consumers`** — Starts a standalone Kafka consumer worker process (useful if decoupling workers from the API).
- **`npm run healthcheck`** — Probes the backend and its infrastructure dependencies to verify everything is up and running.
- **`npm run test:integrations`** — Runs a quick smoke test against external third-party services (Razorpay, SMTP, LLM, Voyage).
- **`npm run demo`** — Enter-driven demo: injects the curated 11-step event sequence through the real ingest API, one step per keypress.
- **`npm run test:webhook`** — Simulates an incoming Razorpay settlement webhook for an entity to verify end-to-end webhook recovery.
- **`npm run test:promise-payment`** — Simulates a customer payment against a promise-linked payment link.
- **`npm run pay:ticket`** — Simulates a customer payment for a ticket-linked payment link.
- **`npm run pay:escalation`** — Alias of `pay:ticket` (same script, clearer name for the escalation flow).
- **`npm run tamper`** — Mutates an audit row to demonstrate hash-chain detection via `GET /audit/verify`.

## Frontend Scripts

Run these commands from inside the `frontend/` directory.

- **`npm run dev`** — Starts the Next.js frontend application in development mode with hot-reloading.
- **`npm run build`** — Creates an optimized production build of the Next.js frontend.
- **`npm run start`** — Starts the frontend in production mode (requires `npm run build` first).
- **`npm run lint`** — Runs ESLint to check for code quality and formatting issues in the frontend codebase.

## Infrastructure

Run these commands from the repository root directory.

- **`docker compose up -d`** — Starts the required local infrastructure (Postgres, Redis, Redpanda, MailHog) in the background.
- **`docker compose down`** — Stops the local infrastructure containers without deleting the database data.
- **`docker compose down -v`** — Stops the infrastructure and permanently deletes all persistent volume data (prefer `npm run reset` in the backend for much faster data resets).

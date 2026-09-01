import { prisma } from "../config/prisma";

const FIRST_NAMES = [
  "Aarav",
  "Diya",
  "Ishaan",
  "Kavya",
  "Arjun",
  "Meera",
  "Rohan",
  "Ananya",
  "Vihaan",
  "Nisha",
];
const LAST_NAMES = [
  "Sharma",
  "Patel",
  "Reddy",
  "Gupta",
  "Iyer",
  "Khan",
  "Das",
  "Mehta",
  "Nair",
  "Singh",
];

function randomFrom<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function amount(min: number, max: number): number {
  return Number((min + Math.random() * (max - min)).toFixed(2));
}

/**
 * Creates realistic demo customers. Existing data is intentionally preserved.
 *
 * Business entities (carts, invoices, subscriptions) are NOT seeded here:
 * under the partner-ingestion architecture they are upserted by the ingest
 * service when simulated partner events arrive, exactly like a connected
 * company's systems would create them.
 */
export async function seedEntities(counts: {
  customers: number;
}): Promise<void> {
  if (!Number.isInteger(counts.customers) || counts.customers < 1) {
    throw new Error("seedEntities requires a positive integer customer count.");
  }

  for (let index = 0; index < counts.customers; index += 1) {
    const firstName = randomFrom(FIRST_NAMES);
    const lastName = randomFrom(LAST_NAMES);
    await prisma.customer.create({
      data: {
        name: `${firstName} ${lastName}`,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${crypto.randomUUID().slice(0, 8)}@example.test`,
        phone: `+91${Math.floor(6000000000 + Math.random() * 3999999999)}`,
        // Deterministic fixtures guarantee a meaningful compliance demo at any size.
        dncFlag: index % 25 === 0,
        riskTier: randomFrom(["low", "standard", "standard", "high"]),
        lifetimeValue: amount(2000, 250000),
      },
    });
  }
}

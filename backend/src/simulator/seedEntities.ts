import { Prisma } from "@prisma/client";
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
const CART_ITEMS = [
  "Pro plan",
  "Analytics add-on",
  "Team seats",
  "Annual renewal",
];

function randomFrom<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function amount(min: number, max: number): number {
  return Number((min + Math.random() * (max - min)).toFixed(2));
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** Creates realistic demo entities. Existing data is intentionally preserved. */
export async function seedEntities(counts: {
  customers: number;
}): Promise<void> {
  if (!Number.isInteger(counts.customers) || counts.customers < 1) {
    throw new Error("seedEntities requires a positive integer customer count.");
  }

  for (let index = 0; index < counts.customers; index += 1) {
    const firstName = randomFrom(FIRST_NAMES);
    const lastName = randomFrom(LAST_NAMES);
    const customer = await prisma.customer.create({
      data: {
        name: `${firstName} ${lastName}`,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${crypto.randomUUID().slice(0, 8)}@example.test`,
        phone: `+91${Math.floor(6000000000 + Math.random() * 3999999999)}`,
        // Deterministic fixtures guarantee a meaningful compliance demo at any size.
        dncFlag: index % 20 === 0,
        riskTier: randomFrom(["low", "standard", "high"]),
        lifetimeValue: amount(500, 150000),
      },
    });

    // Each category is present across the set, while individual customers retain a realistic mix.
    const hasInvoice = index % 4 !== 3;
    const hasCart = index % 3 !== 2;
    const hasSubscription = index % 3 === 0 || index % 10 === 0;

    if (hasInvoice) {
      await prisma.invoice.create({
        data: {
          customerId: customer.id,
          amount: amount(300, 30000),
          dueDate: daysFromNow(Math.floor(Math.random() * 75) - 45),
          status: "open",
          // A deliberate 5% fixture set, not probability alone.
          disputeFlag: index % 20 === 0,
        },
      });
    }

    if (hasCart) {
      const item = randomFrom(CART_ITEMS);
      await prisma.cart.create({
        data: {
          customerId: customer.id,
          amount: amount(250, 25000),
          abandonedAt: new Date(
            Date.now() - Math.floor(Math.random() * 96) * 60 * 60 * 1000,
          ),
          items: [
            {
              sku: item.toLowerCase().replace(/ /g, "-"),
              name: item,
              quantity: 1,
            },
          ] as Prisma.InputJsonValue,
        },
      });
    }

    if (hasSubscription) {
      await prisma.subscription.create({
        data: {
          customerId: customer.id,
          razorpaySubscriptionId: `sub_sim_${crypto.randomUUID().replace(/-/g, "")}`,
          mrr: amount(499, 15000),
          nextBillDate: daysFromNow(Math.floor(Math.random() * 30) + 1),
          status: "active",
        },
      });
    }
  }
}

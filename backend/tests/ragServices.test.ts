jest.mock("../src/config/prisma", () => ({
  prisma: {
    auditEntry: { findUniqueOrThrow: jest.fn() },
    $executeRawUnsafe: jest.fn(),
    $queryRawUnsafe: jest.fn(),
  },
}));
jest.mock("../src/config/voyage", () => ({ embed: jest.fn() }));

import { prisma } from "../src/config/prisma";
import { embed } from "../src/config/voyage";
import { indexAuditEntry } from "../src/services/embeddingService";
import { findSimilarCases } from "../src/services/retrievalService";

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;
const mockedEmbed = embed as jest.MockedFunction<typeof embed>;

describe("Phase 15 RAG services", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedEmbed.mockResolvedValue(Array(1024).fill(0.01));
  });

  it("indexes a recovered webhook case using its RevenueEvent diagnosis and decision", async () => {
    mockedPrisma.auditEntry.findUniqueOrThrow.mockResolvedValue({
      id: "audit-1",
      outcome: "recovered",
      timestamp: new Date("2026-08-10T00:00:00.000Z"),
      diagnosisSnapshot: null,
      decisionSnapshot: null,
      event: {
        entityType: "INVOICE",
        amount: 3000,
        occurredAt: new Date("2026-08-08T00:00:00.000Z"),
        diagnosis: { causeLabel: "invoice_overdue" },
        decision: { chosenAction: "send_payment_link" },
      },
    } as never);

    await indexAuditEntry("audit-1");

    expect(mockedEmbed).toHaveBeenCalledWith(
      "cause=invoice_overdue, entity_type=INVOICE, amount_bucket=2000_to_10000, action=send_payment_link, outcome=recovered, days_to_recover=2",
      "document",
    );
    expect(mockedPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("does not embed a non-terminal audit entry", async () => {
    mockedPrisma.auditEntry.findUniqueOrThrow.mockResolvedValue({ outcome: "pending" } as never);

    await indexAuditEntry("audit-pending");

    expect(mockedEmbed).not.toHaveBeenCalled();
    expect(mockedPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("maps pgvector neighbors into prompt-safe similar-case values", async () => {
    mockedPrisma.$queryRawUnsafe.mockResolvedValue([
      {
        diagnosisSnapshot: { causeLabel: "expired_card" },
        decisionSnapshot: { chosenAction: "send_payment_link" },
        outcome: "recovered",
        daysToRecover: 1,
      },
    ] as never);

    await expect(findSimilarCases("expired_card", "INVOICE", 1200)).resolves.toEqual([
      {
        causeLabel: "expired_card",
        chosenAction: "send_payment_link",
        outcome: "recovered",
        daysToRecover: 1,
      },
    ]);
    expect(mockedEmbed).toHaveBeenCalledWith(expect.stringContaining("entity_type=INVOICE"), "query");
  });
});

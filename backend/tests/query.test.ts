jest.mock("../src/config/openai", () => ({ requestText: jest.fn() }));
jest.mock("../src/config/voyage", () => ({ embed: jest.fn() }));

import { AddressInfo } from "net";
import { server } from "../src/api/server";
import { prisma } from "../src/config/prisma";
import { requestText } from "../src/config/openai";
import { embed } from "../src/config/voyage";
import { extractCitations, queryAuditTrail } from "../src/services/queryService";

const mockedRequestText = requestText as jest.MockedFunction<typeof requestText>;
const mockedEmbed = embed as jest.MockedFunction<typeof embed>;

describe("Phase 16 — Natural-Language Audit Query Interface", () => {
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("extractCitations", () => {
    it("extracts single entity citation", () => {
      const text = "Customer [entity:c123-abc] was escalated due to an active dispute.";
      expect(extractCitations(text)).toEqual(["c123-abc"]);
    });

    it("extracts multiple distinct entity citations without duplicates", () => {
      const text =
        "Cases [entity:ent-1] and [entity:ent-2] were retried. Later, [entity:ent-1] was recovered.";
      expect(extractCitations(text)).toEqual(["ent-1", "ent-2"]);
    });

    it("returns empty array when text contains no citations", () => {
      const text = "I do not have enough information in the provided audit records to answer this question.";
      expect(extractCitations(text)).toEqual([]);
    });
  });

  describe("queryAuditTrail", () => {
    it("queries audit trail for a specific entityId with grounding", async () => {
      const mockEntries = [
        {
          id: "audit-1",
          entityId: "ent-456",
          eventId: "evt-101",
          actor: "system",
          outcome: "escalated",
          timestamp: new Date("2026-08-29T10:00:00Z"),
          inputSnapshot: { eventType: "INVOICE_OVERDUE", amount: 5000, currency: "INR" },
          diagnosisSnapshot: { causeLabel: "dispute", reasoning: "Customer disputed charge" },
          decisionSnapshot: { chosenAction: "escalate_to_human", reasoning: "Dispute requires human review" },
          actionSnapshot: { actionType: "escalate_to_human", result: "success", integration: "ZENDESK" },
          event: null,
        },
      ];

      jest.spyOn(prisma.auditEntry, "findMany").mockResolvedValueOnce(mockEntries as any);
      mockedRequestText.mockResolvedValueOnce(
        "Entity [entity:ent-456] was escalated to a human because a billing dispute was detected.",
      );

      const result = await queryAuditTrail({
        question: "Why was this customer escalated?",
        entityId: "ent-456",
      });

      expect(prisma.auditEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ entityId: "ent-456" }, { eventId: "ent-456" }] },
        }),
      );
      expect(result.answer).toContain("[entity:ent-456]");
      expect(result.citedEntityIds).toEqual(["ent-456"]);
    });

    it("performs cross-entity vector retrieval when entityId is omitted", async () => {
      mockedEmbed.mockResolvedValueOnce([0.1, 0.2, 0.3]);
      const mockVectorRows = [
        {
          id: "audit-2",
          entityId: "ent-789",
          eventId: "evt-202",
          actor: "system",
          outcome: "recovered",
          timestamp: new Date("2026-08-29T11:00:00Z"),
          inputSnapshot: { eventType: "INVOICE_OVERDUE", amount: 1500, currency: "INR" },
          diagnosisSnapshot: { causeLabel: "insufficient_funds" },
          decisionSnapshot: { chosenAction: "send_payment_link" },
          actionSnapshot: { actionType: "send_payment_link", result: "success", integration: "RAZORPAY" },
        },
      ];
      jest.spyOn(prisma, "$queryRawUnsafe").mockResolvedValueOnce(mockVectorRows as any);

      mockedRequestText.mockResolvedValueOnce(
        "For insufficient funds cases like [entity:ent-789], the system sent a payment link which recovered the funds.",
      );

      const result = await queryAuditTrail({
        question: "What actions recover insufficient funds?",
      });

      expect(mockedEmbed).toHaveBeenCalledWith("What actions recover insufficient funds?", "query");
      expect(result.citedEntityIds).toEqual(["ent-789"]);
    });

    it("returns 'not enough information' answer when records do not contain data", async () => {
      jest.spyOn(prisma.auditEntry, "findMany").mockResolvedValueOnce([]);
      mockedRequestText.mockResolvedValueOnce(
        "The provided audit records do not contain any information about entity-999999.",
      );

      const result = await queryAuditTrail({
        question: "What happened to entity-999999?",
        entityId: "entity-999999",
      });

      expect(result.citedEntityIds).toEqual([]);
      expect(result.answer).toContain("do not contain any information");
    });
  });

  describe("POST /query API Route", () => {
    it("returns 400 if question is missing or blank", async () => {
      const res = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Field 'question' is required");
    });

    it("returns 200 with answer and citations for valid query", async () => {
      jest.spyOn(prisma.auditEntry, "findMany").mockResolvedValueOnce([]);
      mockedRequestText.mockResolvedValueOnce(
        "Based on audit logs for [entity:ent-abc], payment was retried successfully.",
      );

      const res = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "Status of ent-abc?",
          entityId: "ent-abc",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.answer).toBeDefined();
      expect(data.citedEntityIds).toEqual(["ent-abc"]);
    });
  });
});

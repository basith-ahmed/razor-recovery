import { Request, Response } from "express";
import crypto from "crypto";
import { handleRazorpayWebhook } from "../src/api/webhooks/razorpayWebhook";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";

const mockTx = {
  entityWorkflowState: { upsert: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
  auditEntry: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) },
  diagnosis: { findUnique: jest.fn().mockResolvedValue(null) },
  decision: { findUnique: jest.fn().mockResolvedValue(null) },
  entityCauseState: { deleteMany: jest.fn() },
  ledgerEntry: {
    create: jest.fn(),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  },
  promiseToPay: {
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    findFirst: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({}),
  },
  ticket: {
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
  },
  ticketNote: {
    create: jest.fn().mockResolvedValue({}),
  },
  auditChainHead: {
    findUnique: jest.fn().mockResolvedValue({ id: 1, hash: "head-hash" }),
    update: jest.fn(),
    upsert: jest.fn(),
  },
  $queryRaw: jest.fn().mockResolvedValue([{ max_id: 1 }]),
};

jest.mock("../src/config/prisma", () => ({
  prisma: {
    $transaction: jest.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
    entityWorkflowState: { upsert: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
    action: { findFirst: jest.fn().mockResolvedValue(null) },
    promiseToPay: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    ticket: { findFirst: jest.fn().mockResolvedValue(null) },
    revenueEvent: {
      findFirst: jest.fn().mockResolvedValue({
        id: "event-1",
        entityId: "entity-123",
        customerId: "cust-1",
        amount: 500,
        currency: "INR",
      }),
    },
  },
}));

jest.mock("../src/kafka/producer", () => ({
  publish: jest.fn(),
}));

jest.mock("../src/api/websocket", () => ({
  emitLiveUpdate: jest.fn(),
}));

describe("Razorpay Webhook", () => {
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
      json: jest.fn(),
    };
  });

  it("rejects request with missing signature", async () => {
    const req: Partial<Request> = {
      headers: {},
      body: { event: "payment.captured" },
    };

    await handleRazorpayWebhook(req as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects request with invalid signature", async () => {
    const rawBody = JSON.stringify({ event: "payment.captured" });
    const req: Partial<Request> = {
      headers: { "x-razorpay-signature": "invalid-signature" },
      body: JSON.parse(rawBody),
      ...({ rawBody } as object),
    };

    await handleRazorpayWebhook(req as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("processes payment capture and cleanly resets entity attempt counter", async () => {
    const bodyObj = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_webhook_test_1",
            notes: { entityId: "entity-123", customerId: "cust-123" },
          },
        },
      },
    };
    const rawBody = JSON.stringify(bodyObj);
    const validSignature = crypto
      .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    const req: Partial<Request> = {
      headers: { "x-razorpay-signature": validSignature },
      body: bodyObj,
      ...({ rawBody } as object),
    };

    await handleRazorpayWebhook(req as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(200);

      expect(mockTx.entityWorkflowState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { entityId: "entity-123" },
          update: expect.objectContaining({
            state: "RECOVERED",
            attemptCount: 0,
            lastContactedAt: null,
            cooldownUntil: null,
          }),
        }),
      );
    });

    it("settles a standalone promised payment with a chained audit entry", async () => {
      (prisma.revenueEvent.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (prisma.promiseToPay.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: "ptp-standalone-1",
          entityId: "entity-ptp-9",
          customerId: "cust-1",
          eventId: "event-1",
          promisedAmount: 750,
          currency: "INR",
          createdAt: new Date(),
        },
      ]);

      const bodyObj = {
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_ptp_webhook_1",
              payment_link_id: "plink_ptp_standalone",
            },
          },
        },
      };
      const rawBody = JSON.stringify(bodyObj);
      const validSignature = crypto
        .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");

      const req: Partial<Request> = {
        headers: { "x-razorpay-signature": validSignature },
        body: bodyObj,
        ...({ rawBody } as object),
      };

      await handleRazorpayWebhook(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ok", processed: true, count: 1 })
      );
      expect(mockTx.promiseToPay.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ptp-standalone-1" },
          data: { status: "kept" },
        })
      );
      expect(mockTx.entityCauseState.deleteMany).toHaveBeenCalledWith({
        where: { entityId: "entity-ptp-9" },
      });
      expect(mockTx.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: "RECOVERED", amount: 750 }),
        })
      );
      expect(mockTx.auditEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventId: "event-1",
            entityId: "entity-ptp-9",
            actor: "razorpay_webhook",
            outcome: "recovered",
            actionSnapshot: expect.objectContaining({
              actionType: "webhook_capture",
              integration: "RAZORPAY",
            }),
          }),
        })
      );
      const { publish } = require("../src/kafka/producer") as { publish: jest.Mock };
      expect(publish).toHaveBeenCalled();
    });
  });

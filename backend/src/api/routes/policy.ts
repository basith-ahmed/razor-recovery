import { Router, Request, Response } from "express";
import policyJson from "../../domain/policy.json";
import { redis } from "../../config/redis";
import { prisma } from "../../config/prisma";

export const policyRouter = Router();

// GET /policy — live policy.json, DNC list from Redis/DB, and compliance log
policyRouter.get("/", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    // Fetch DNC list from Redis
    const redisDncIds = await redis.smembers("razorrecovery:dnc:set");

    // Fetch DNC customers from Postgres
    const dbDncCustomers = await prisma.customer.findMany({
      where: { dncFlag: true },
      select: { id: true, name: true, email: true },
    });

    const dncSet = new Map<string, { id: string; name?: string; email?: string }>();
    for (const c of dbDncCustomers) {
      dncSet.set(c.id, c);
    }
    for (const id of redisDncIds) {
      if (!dncSet.has(id)) {
        dncSet.set(id, { id });
      }
    }
    const dncList = Array.from(dncSet.values());

    // Fetch policy-blocked compliance audit entries
    const [total, entries] = await Promise.all([
      prisma.auditEntry.count({
        where: { outcome: { in: ["skipped", "escalated"] } },
      }),
      prisma.auditEntry.findMany({
        where: { outcome: { in: ["skipped", "escalated"] } },
        orderBy: { timestamp: "desc" },
        skip,
        take: limit,
        include: {
          event: {
            include: { customer: true },
          },
        },
      }),
    ]);

    return res.status(200).json({
      policy: policyJson,
      dncList,
      complianceLog: {
        entries,
        total,
        page,
        limit,
      },
    });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Failed to fetch policy configuration";
    console.error("[policyRouter] Error fetching policy configuration:", error);
    return res.status(500).json({ error: errMessage });
  }
});

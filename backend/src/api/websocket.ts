import http from "http";
import { Server } from "socket.io";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { computeLiveMetrics } from "../services/metricsService";

let ioInstance: Server | null = null;

export function initWebSocket(server: http.Server): Server {
  ioInstance = new Server(server, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
    },
  });

  // Single global live channel — every connected client receives every
  // broadcast. There is no per-run room and no subscribe handshake, because
  // the pipeline itself has no run scope.
  ioInstance.on("connection", (socket) => {
    // console.log(`[websocket] Client connected: ${socket.id}`);

    computeLiveMetrics("all")
      .then((metrics) => socket.emit("metrics:update", metrics))
      .catch((err) =>
        console.error("[websocket] Error emitting initial metrics:", err),
      );

    socket.on("disconnect", () => {
      // console.log(`[websocket] Client disconnected: ${socket.id}`);
    });
  });

  return ioInstance;
}

export function getIO(): Server | null {
  return ioInstance;
}

/**
 * Emits live WebSocket events for the global channel: a new activity feed row
 * and the refreshed metrics summary.
 */
export async function emitLiveUpdate(eventId?: string): Promise<void> {
  if (!ioInstance) return;

  try {
    // 1. Emit "activity:new"
    const latestAudit = eventId
      ? await prisma.auditEntry.findFirst({
          where: { eventId },
          orderBy: { timestamp: "desc" },
          include: {
            event: {
              include: { customer: true, diagnosis: true, action: true },
            },
          },
        })
      : await prisma.auditEntry.findFirst({
          orderBy: { timestamp: "desc" },
          include: {
            event: {
              include: { customer: true, diagnosis: true, action: true },
            },
          },
        });

    if (latestAudit && latestAudit.event) {
      ioInstance.emit("activity:new", {
        entityId: latestAudit.entityId,
        timestamp: latestAudit.timestamp.toISOString(),
        customerId: latestAudit.event.customerId,
        customerName: latestAudit.event.customer?.name ?? "Unknown Customer",
        eventType: latestAudit.event.eventType,
        cause: latestAudit.event.diagnosis?.causeLabel ?? "unknown",
        action: latestAudit.event.action?.actionType ?? "none",
        actionResult: latestAudit.event.action?.result ?? null,
        outcome: latestAudit.outcome,
      });
    }

    // 2. Emit "metrics:update" (re-emitted after every processed event so the
    // hero counters animate live)
    const fullMetrics = await computeLiveMetrics("all");
    ioInstance.emit("metrics:update", fullMetrics);
  } catch (err) {
    console.error("[websocket] Error emitting live update:", err);
  }
}

/**
 * Broadcasts a raw event the moment it enters the pipeline (detection stage),
 * so the frontend can show live ingestion separately from processed outcomes.
 */
export function emitIncomingEvent(payload: {
  eventId: string;
  entityId: string;
  customerId: string;
  customerName: string;
  eventType: string;
  amount: number;
  currency: string;
  occurredAt: string;
  riskScore?: number;
  /** True for scheduler-synthesized events (cooldown expiry, deferred retry). */
  synthesized?: boolean;
  followUpType?: string;
}): void {
  ioInstance?.emit("event:incoming", payload);
}

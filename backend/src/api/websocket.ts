import http from "http";
import { Server } from "socket.io";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { getFullMetricsSummary } from "../services/metricsService";

let ioInstance: Server | null = null;

export function initWebSocket(server: http.Server): Server {
  ioInstance = new Server(server, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
    },
  });

  ioInstance.on("connection", (socket) => {
    console.log(`[websocket] Client connected: ${socket.id}`);

    socket.on("subscribe", async (data: string | { batchId: string }) => {
      const batchId = typeof data === "string" ? data : data?.batchId;
      if (!batchId) return;

      socket.join(batchId);
      console.log(`[websocket] Socket ${socket.id} subscribed to batch room: ${batchId}`);

      try {
        const initialMetrics = await getFullMetricsSummary(batchId);
        socket.emit("metrics:update", initialMetrics);
      } catch (err) {
        console.error(`[websocket] Error emitting initial metrics for batch ${batchId}:`, err);
      }
    });

    socket.on("disconnect", () => {
      console.log(`[websocket] Client disconnected: ${socket.id}`);
    });
  });

  return ioInstance;
}

export function getIO(): Server | null {
  return ioInstance;
}

/**
 * Emits live WebSocket events for progress, new activity feed items, and updated metrics summary.
 */
export async function emitLiveUpdate(
  batchId: string,
  eventId?: string,
): Promise<void> {
  if (!ioInstance) return;

  try {
    const total = await prisma.revenueEvent.count({ where: { batchId } });
    const processedAudits = await prisma.auditEntry.findMany({
      where: { event: { batchId } },
      select: { eventId: true },
      distinct: ["eventId"],
    });
    const processed = processedAudits.length;

    // 1. Emit "batch:progress"
    ioInstance.to(batchId).emit("batch:progress", {
      batchId,
      processed,
      total,
    });

    // 2. Emit "activity:new"
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
          where: { event: { batchId } },
          orderBy: { timestamp: "desc" },
          include: {
            event: {
              include: { customer: true, diagnosis: true, action: true },
            },
          },
        });

    if (latestAudit && latestAudit.event) {
      ioInstance.to(batchId).emit("activity:new", {
        entityId: latestAudit.entityId,
        timestamp: latestAudit.timestamp.toISOString(),
        customerName: latestAudit.event.customer?.name ?? "Unknown Customer",
        eventType: latestAudit.event.eventType,
        cause: latestAudit.event.diagnosis?.causeLabel ?? "unknown",
        action: latestAudit.event.action?.actionType ?? "none",
        outcome: latestAudit.outcome,
      });
    }

    // 3. Emit "metrics:update"
    const fullMetrics = await getFullMetricsSummary(batchId);
    ioInstance.to(batchId).emit("metrics:update", fullMetrics);
  } catch (err) {
    console.error(`[websocket] Error emitting live update for batch ${batchId}:`, err);
  }
}

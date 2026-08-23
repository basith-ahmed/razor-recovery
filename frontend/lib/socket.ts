"use client";

import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { ActivityItem, MetricsSummary } from "../types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export interface BatchProgress {
  batchId: string;
  processed: number;
  total: number;
}

export function useLiveBatch(batchId?: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([]);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(WS_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      if (batchId) {
        socket.emit("subscribe", batchId);
      }
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("batch:progress", (data: BatchProgress) => {
      setProgress(data);
    });

    socket.on("activity:new", (item: ActivityItem) => {
      setActivityFeed((prev) => [item, ...prev].slice(0, 200));
    });

    socket.on("metrics:update", (data: MetricsSummary) => {
      setMetrics(data);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("batch:progress");
      socket.off("activity:new");
      socket.off("metrics:update");
      socket.disconnect();
    };
  }, [batchId]);

  useEffect(() => {
    if (socketRef.current && isConnected && batchId) {
      socketRef.current.emit("subscribe", batchId);
    }
  }, [batchId, isConnected]);

  return {
    isConnected,
    progress,
    activityFeed,
    metrics,
  };
}

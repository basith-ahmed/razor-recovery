"use client";

import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { ActivityItem, MetricsSummary } from "../types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export interface StreamProgress {
  runId: string;
  sent: number;
  total: number;
}

/**
 * Live global channel hook — no parameter and no subscribe step. Every
 * connected client receives every broadcast because the pipeline itself has
 * no run scope.
 */
export function useLiveStream() {
  const [isConnected, setIsConnected] = useState(false);
  const [injectionProgress, setInjectionProgress] = useState<StreamProgress | null>(null);
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
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    // DEMO-ONLY signal; a client only cares while an injection is in flight
    socket.on("stream:progress", (data: StreamProgress) => {
      setInjectionProgress(data);
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
      socket.off("stream:progress");
      socket.off("activity:new");
      socket.off("metrics:update");
      socket.disconnect();
    };
  }, []);

  return {
    isConnected,
    injectionProgress,
    activityFeed,
    metrics,
  };
}

"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ActivityItem, IncomingEventItem, MetricsSummary } from "../types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export interface StreamProgress {
  runId: string;
  sent: number;
  total: number;
}

/**
 * Module-level singleton socket: one connection per browser tab for the
 * whole session. Page navigations only attach/detach event listeners — they
 * never tear the connection down, so the global live channel survives
 * client-side route changes.
 */
let socketInstance: Socket | null = null;

function getSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io(WS_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
    });
  }
  return socketInstance;
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
  const [incomingEvents, setIncomingEvents] = useState<IncomingEventItem[]>([]);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    const onIncomingEvent = (item: IncomingEventItem) =>
      setIncomingEvents((prev) => [item, ...prev].slice(0, 200));
    const onStreamProgress = (data: StreamProgress) => setInjectionProgress(data);
    const onActivityNew = (item: ActivityItem) =>
      setActivityFeed((prev) => [item, ...prev].slice(0, 200));
    const onMetricsUpdate = (data: MetricsSummary) => setMetrics(data);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    // Raw events the moment they enter the pipeline (detection stage)
    socket.on("event:incoming", onIncomingEvent);
    // DEMO-ONLY signal; a client only cares while an injection is in flight
    socket.on("stream:progress", onStreamProgress);
    socket.on("activity:new", onActivityNew);
    socket.on("metrics:update", onMetricsUpdate);

    if (socket.connected) setIsConnected(true);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("event:incoming", onIncomingEvent);
      socket.off("stream:progress", onStreamProgress);
      socket.off("activity:new", onActivityNew);
      socket.off("metrics:update", onMetricsUpdate);
      // Deliberately NOT disconnecting: the singleton connection is shared
      // across pages and lives for the whole tab session.
    };
  }, []);

  return {
    isConnected,
    injectionProgress,
    activityFeed,
    incomingEvents,
    metrics,
  };
}

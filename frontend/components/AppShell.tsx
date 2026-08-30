"use client";

import { useState } from "react";
import { Nav } from "./Nav";
import { Sidebar } from "./Sidebar";
import { GlobalFloatingAIBar } from "./GlobalFloatingAIBar";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top bar — fixed, full-width */}
      <Nav onMenuToggle={() => setSidebarOpen((o) => !o)} />

      {/* Body: sidebar + main content */}
      <div className="flex flex-1 pt-14">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main content area */}
        <main className="flex-1 min-w-0">
          <div className="max-w-7xl mx-auto px-6 py-6 pb-28">
            {children}
          </div>
        </main>
      </div>

      {/* Centrally-managed page-aware floating AI bar */}
      <GlobalFloatingAIBar />
    </div>
  );
}

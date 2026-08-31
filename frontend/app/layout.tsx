import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "../components/AppShell";

export const metadata: Metadata = {
  title: "RazorRecovery",
  description: "Real-time AI revenue recovery and dunning orchestration platform powered by Razorpay",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-canvas-soft text-ink antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

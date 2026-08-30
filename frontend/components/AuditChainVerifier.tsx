"use client";

import { useState } from "react";
import Link from "next/link";
import { verifyAuditChain } from "../lib/api";
import { AuditVerifyResult } from "../types";

export function AuditChainVerifier() {
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<AuditVerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(null);

  const handleVerify = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await verifyAuditChain();
      setResult(res);
      setLastVerifiedAt(new Date().toLocaleTimeString("en-IN"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to verify audit chain";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
        <div>
          <h3 className="text-[16px] font-bold text-ink tracking-[-0.125px]">
            Audit Integrity & Cryptographic Hash Chain
          </h3>
          <p className="text-xs text-ink-muted mt-0.5">
            Verify SHA-256 tamper-evident sequential hash chain across all recorded audit entries.
          </p>
        </div>

        <button
          onClick={handleVerify}
          disabled={loading}
          className="inline-flex items-center justify-center px-4 py-1.5 text-xs font-medium text-white bg-primary hover:bg-primary-active active:scale-[0.98] disabled:opacity-50 rounded-full transition-all shadow-sm shrink-0"
        >
          {loading ? "Verifying Chain..." : "Verify Audit Integrity"}
        </button>
      </div>

      {error && (
        <div className="bg-accent-orange/10 border border-accent-orange/25 text-accent-orange-deep text-xs p-3 rounded-[8px] mb-3">
          Error verifying chain: {error}
        </div>
      )}

      {result && (
        <div className="mt-3">
          {result.valid ? (
            <div className="bg-accent-green/10 border border-accent-green/25 text-accent-green text-xs p-3 rounded-[8px] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">✓</span>
                <span className="text-ink-secondary">
                  <strong className="text-accent-green">{result.entriesChecked}</strong> entries verified. Cryptographic hash chain is intact and valid.
                </span>
              </div>
              {lastVerifiedAt && (
                <span className="text-[11px] text-accent-green">Verified at {lastVerifiedAt}</span>
              )}
            </div>
          ) : (
            <div className="bg-accent-orange/10 border border-accent-orange/25 text-accent-orange-deep text-xs p-3 rounded-[8px] space-y-1">
              <div className="flex items-center gap-2 font-bold text-accent-orange">
                <span className="text-sm">✗</span>
                <span>Audit Chain Integrity Violation Detected!</span>
              </div>
              <p className="text-xs text-ink-secondary">
                Tampering or hash mismatch detected at sequence{" "}
                <strong className="text-accent-orange-deep font-semibold">#{result.brokenAtSequence}</strong>
                {result.brokenAtEntryId && (
                  <>
                    {" "}(Entry ID:{" "}
                    <Link
                      href={`/entities/${result.brokenAtEntryId}`}
                      className="underline text-primary hover:text-primary-active"
                    >
                      {result.brokenAtEntryId}
                    </Link>
                    )
                  </>
                )}. Checked {result.entriesChecked} valid entries prior to breach.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

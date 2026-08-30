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
    <div className="bg-white border border-slate-200 rounded p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Audit Integrity & Cryptographic Hash Chain
          </h3>
          <p className="text-xs text-slate-500">
            Verify SHA-256 tamper-evident sequential hash chain across all recorded audit entries.
          </p>
        </div>

        <button
          onClick={handleVerify}
          disabled={loading}
          className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded"
        >
          {loading ? "Verifying Chain..." : "Verify Audit Integrity"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2.5 rounded mb-3">
          Error verifying chain: {error}
        </div>
      )}

      {result && (
        <div className="mt-3">
          {result.valid ? (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs p-2.5 rounded flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">✓</span>
                <span>
                  <strong>{result.entriesChecked}</strong> entries verified. Cryptographic hash chain is intact and valid.
                </span>
              </div>
              {lastVerifiedAt && (
                <span className="text-[11px] text-emerald-600">Verified at {lastVerifiedAt}</span>
              )}
            </div>
          ) : (
            <div className="bg-red-50 border border-red-200 text-red-800 text-xs p-2.5 rounded space-y-1">
              <div className="flex items-center gap-2 font-bold">
                <span className="text-sm">✗</span>
                <span>Audit Chain Integrity Violation Detected!</span>
              </div>
              <p className="text-xs text-red-700">
                Tampering or hash mismatch detected at sequence{" "}
                <strong className="font-mono">#{result.brokenAtSequence}</strong>
                {result.brokenAtEntryId && (
                  <>
                    {" "}(Entry ID:{" "}
                    <Link
                      href={`/entities/${result.brokenAtEntryId}`}
                      className="underline font-mono text-red-900 hover:text-red-600"
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

"use client";

import { useState } from "react";
import Link from "next/link";
import { verifyAuditChain } from "../lib/api";
import { AuditVerifyResult } from "../types";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";

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
          <div className="flex items-center gap-2">
            <h3 className="text-[16px] font-bold text-ink tracking-[-0.125px]">
              Audit Integrity & Cryptographic Hash Chain
            </h3>
            {result && (
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                  result.valid
                    ? "bg-accent-green/10 text-accent-green border border-accent-green/20"
                    : "bg-accent-orange/10 text-accent-orange-deep border border-accent-orange/20"
                }`}
              >
                {result.valid ? "Verified Valid" : "Tamper Detected"}
              </span>
            )}
          </div>
          <p className="text-xs text-ink-muted mt-0.5">
            Cryptographically verify SHA-256 sequential block hashes across all recorded audit entries in PostgreSQL.
          </p>
        </div>

        <button
          onClick={handleVerify}
          disabled={loading}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-primary hover:bg-primary-active active:scale-[0.98] disabled:opacity-60 rounded-full transition-all shadow-sm shrink-0 cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Verifying Ledger...</span>
            </>
          ) : (
            <>
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Verify Audit Integrity</span>
            </>
          )}
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
            <div className="bg-accent-green/10 border border-accent-green/25 text-accent-green text-xs p-3.5 rounded-[8px] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-accent-green shrink-0" />
                <span className="text-ink-secondary">
                  <strong className="text-accent-green">{result.entriesChecked}</strong> of{" "}
                  <strong>{result.totalEntries ?? result.entriesChecked}</strong> audit entries verified. SHA-256 cryptographic hash chain is intact and valid.
                </span>
              </div>
              {lastVerifiedAt && (
                <span className="text-[11px] text-accent-green font-medium shrink-0">
                  Checked at {lastVerifiedAt}
                </span>
              )}
            </div>
          ) : (
            <div className="bg-accent-orange/10 border border-accent-orange/25 text-accent-orange-deep text-xs p-3.5 rounded-[8px] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-accent-orange">
                  <ShieldAlert className="w-4 h-4 text-accent-orange-deep" />
                  <span>Audit Chain Integrity Violation Detected!</span>
                </div>
                {lastVerifiedAt && (
                  <span className="text-[11px] text-accent-orange-deep font-semibold">
                    Checked at {lastVerifiedAt}
                  </span>
                )}
              </div>

              <div className="text-xs text-ink-secondary space-y-1">
                <p>
                  Tampering or hash mismatch detected at Sequence{" "}
                  <strong className="text-accent-orange-deep font-bold">#{result.brokenAtSequence}</strong>.
                  {result.brokenReason === "content_hash_mismatch"
                    ? " Stored SHA-256 hash does not match the recomputed hash of the row payload (data was directly modified in database)."
                    : " Sequential prevHash link to prior block is broken."}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted mt-1 bg-white/60 p-2 rounded border border-accent-orange/15">
                  {result.brokenAtEntityId && (
                    <span>
                      Entity:{" "}
                      <Link
                        href={`/entities/${result.brokenAtEntityId}`}
                        className="font-mono text-primary font-semibold hover:underline"
                      >
                        {result.brokenAtEntityId}
                      </Link>
                    </span>
                  )}
                  {result.brokenAtEntryId && (
                    <span>
                      Audit Entry:{" "}
                      <span className="font-mono text-ink">{result.brokenAtEntryId}</span>
                    </span>
                  )}
                  <span>
                    Valid entries before breach:{" "}
                    <strong>{result.entriesChecked}</strong>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

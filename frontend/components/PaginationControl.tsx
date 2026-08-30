import React from "react";

interface PaginationControlProps {
  page: number;
  totalPages: number;
  total?: number;
  limit?: number;
  onPageChange: (newPage: number) => void;
  onLimitChange?: (newLimit: number) => void;
  limitOptions?: number[];
  disabled?: boolean;
  className?: string;
}

export function PaginationControl({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  onLimitChange,
  limitOptions = [10, 20, 50, 100],
  disabled = false,
  className = "",
}: PaginationControlProps) {
  const safeTotalPages = Math.max(1, totalPages || 1);
  const startItem = total !== undefined && limit ? Math.min((page - 1) * limit + 1, total) : undefined;
  const endItem = total !== undefined && limit ? Math.min(page * limit, total) : undefined;

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 ${className}`}
    >
      {/* Left side: Item range & Per-page selector */}
      <div className="flex items-center gap-4">
        {total !== undefined && startItem !== undefined && endItem !== undefined ? (
          <span>
            Showing <strong className="text-slate-900">{total === 0 ? 0 : startItem}</strong> to{" "}
            <strong className="text-slate-900">{endItem}</strong> of{" "}
            <strong className="text-slate-900">{total}</strong> item{total !== 1 ? "s" : ""}
          </span>
        ) : (
          <span>
            Page <strong className="text-slate-900">{page}</strong> of{" "}
            <strong className="text-slate-900">{safeTotalPages}</strong>
          </span>
        )}

        {onLimitChange && limit && (
          <div className="flex items-center gap-1.5 pl-3 border-l border-slate-200">
            <span>Per page:</span>
            <select
              value={limit}
              disabled={disabled}
              onChange={(e) => onLimitChange(parseInt(e.target.value, 10))}
              className="bg-slate-50 border border-slate-300 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
            >
              {limitOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Right side: Navigation buttons */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-slate-600 mr-1">
          {page} / {safeTotalPages}
        </span>

        <button
          type="button"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 text-slate-700 text-xs px-2.5 py-1 rounded font-medium disabled:cursor-not-allowed"
        >
          Previous
        </button>

        <button
          type="button"
          disabled={disabled || page >= safeTotalPages}
          onClick={() => onPageChange(Math.min(safeTotalPages, page + 1))}
          className="bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 text-slate-700 text-xs px-2.5 py-1 rounded font-medium disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}

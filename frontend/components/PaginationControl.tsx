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
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-ink-muted ${className}`}
    >
      {/* Left side: Item range & Per-page selector */}
      <div className="flex items-center gap-4">
        {total !== undefined && startItem !== undefined && endItem !== undefined ? (
          <span>
            Showing <strong className="text-ink font-semibold">{total === 0 ? 0 : startItem}</strong> to{" "}
            <strong className="text-ink font-semibold">{endItem}</strong> of{" "}
            <strong className="text-ink font-semibold">{total}</strong> item{total !== 1 ? "s" : ""}
          </span>
        ) : (
          <span>
            Page <strong className="text-ink font-semibold">{page}</strong> of{" "}
            <strong className="text-ink font-semibold">{safeTotalPages}</strong>
          </span>
        )}

        {onLimitChange && limit && (
          <div className="flex items-center gap-1.5 pl-3 border-l border-hairline">
            <span>Per page:</span>
            <select
              value={limit}
              disabled={disabled}
              onChange={(e) => onLimitChange(parseInt(e.target.value, 10))}
              className="bg-white border border-hairline-input rounded-[4px] px-2 py-1 text-xs text-ink focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all"
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
        <span className="text-xs text-ink-muted mr-1 font-medium">
          {page} / {safeTotalPages}
        </span>

        <button
          type="button"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="bg-white border border-hairline hover:bg-canvas-soft disabled:opacity-40 text-ink text-xs px-3 py-1.5 rounded-[8px] font-medium disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          Previous
        </button>

        <button
          type="button"
          disabled={disabled || page >= safeTotalPages}
          onClick={() => onPageChange(Math.min(safeTotalPages, page + 1))}
          className="bg-white border border-hairline hover:bg-canvas-soft disabled:opacity-40 text-ink text-xs px-3 py-1.5 rounded-[8px] font-medium disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          Next
        </button>
      </div>
    </div>
  );
}

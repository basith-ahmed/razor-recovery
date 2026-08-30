import React from "react";

interface PaginationControlProps {
  page: number;
  totalPages: number;
  total?: number;
  limit?: number;
  onPageChange: (newPage: number) => void;
  disabled?: boolean;
}

export function PaginationControl({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  disabled = false,
}: PaginationControlProps) {
  if (totalPages <= 1 && (!total || total === 0)) return null;

  const startItem = total && limit ? (page - 1) * limit + 1 : undefined;
  const endItem = total && limit ? Math.min(page * limit, total) : undefined;

  return (
    <div className="flex items-center justify-between pt-3 border-t border-slate-200 text-xs text-slate-500">
      <div>
        {startItem !== undefined && endItem !== undefined && total !== undefined ? (
          <span>
            Showing <strong className="text-slate-800">{startItem}</strong> to{" "}
            <strong className="text-slate-800">{endItem}</strong> of{" "}
            <strong className="text-slate-800">{total}</strong> items
          </span>
        ) : (
          <span>
            Page <strong className="text-slate-800">{page}</strong> of{" "}
            <strong className="text-slate-800">{totalPages}</strong>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-2 py-1 border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40 font-medium"
        >
          Previous
        </button>
        <span className="font-mono text-slate-700">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="px-2 py-1 border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40 font-medium"
        >
          Next
        </button>
      </div>
    </div>
  );
}

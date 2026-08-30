"use client";

import { useState, useEffect } from "react";
import { listEntities } from "../../lib/api";
import { EntityItem, EntityFilters } from "../../types";
import { EntityTable } from "../../components/EntityTable";
import { useLiveStream } from "../../lib/socket";

export default function EntitiesPage() {
  const [entities, setEntities] = useState<EntityItem[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [filters, setFilters] = useState<EntityFilters>({ page: 1, limit: 20 });
  const [loading, setLoading] = useState<boolean>(true);

  const { activityFeed } = useLiveStream();

  useEffect(() => {
    let ignore = false;
    listEntities(filters)
      .then((data) => {
        if (!ignore) {
          setEntities(data.items);
          setPagination({
            total: data.total,
            page: data.page,
            limit: data.limit,
            totalPages: data.totalPages,
          });
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error("Failed to fetch entities:", err);
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [filters, activityFeed]);

  const handleFilterChange = (newFilters: Partial<EntityFilters>) => {
    setLoading(true);
    setFilters((prev) => {
      const isPaginationOnly = ("page" in newFilters || "limit" in newFilters) && Object.keys(newFilters).every((k) => k === "page" || k === "limit");
      const nextFilters = { ...prev, ...newFilters };
      if (!isPaginationOnly && !("page" in newFilters)) {
        nextFilters.page = 1;
      }
      return nextFilters;
    });
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Revenue Entities</h1>
          <p className="text-sm text-slate-500">
            Query and inspect failed payment & recovery entities with real-time server-side filtering and pagination.
          </p>
        </div>
        <div className="text-xs font-mono bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded">
          Total Found: {pagination.total}
        </div>
      </div>

      <EntityTable
        entities={entities}
        filters={filters}
        pagination={pagination}
        onFilterChange={handleFilterChange}
        loading={loading}
      />
    </div>
  );
}

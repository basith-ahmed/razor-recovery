"use client";

import { useState, useEffect } from "react";
import { listEntities } from "../../lib/api";
import { EntityItem, EntityFilters } from "../../types";
import { EntityTable } from "../../components/EntityTable";

export default function EntitiesPage() {
  const [entities, setEntities] = useState<EntityItem[]>([]);
  const [filters, setFilters] = useState<EntityFilters>({});
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let ignore = false;
    listEntities(filters)
      .then((data) => {
        if (!ignore) {
          setEntities(data);
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
  }, [filters]);

  const handleFilterChange = (newFilters: Partial<EntityFilters>) => {
    setLoading(true);
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Revenue Entities</h1>
          <p className="text-sm text-slate-400">
            Query and inspect failed payment & recovery entities with real-time server-side filtering.
          </p>
        </div>
        <div className="text-xs font-mono bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-md">
          Total Found: {entities.length}
        </div>
      </div>

      <EntityTable
        entities={entities}
        filters={filters}
        onFilterChange={handleFilterChange}
        loading={loading}
      />
    </div>
  );
}

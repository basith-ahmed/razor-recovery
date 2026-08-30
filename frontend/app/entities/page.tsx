"use client";

import { useState, useEffect } from "react";
import { listEntities, getMetricsSummary } from "../../lib/api";
import { EntityItem, EntityFilters, MetricsSummary } from "../../types";
import { EntityTable } from "../../components/EntityTable";
import { useLiveStream } from "../../lib/socket";
import { PageHeader } from "../../components/PageHeader";
import { formatCurrency } from "../../lib/formatters";

export default function EntitiesPage() {
  const [entities, setEntities] = useState<EntityItem[]>([]);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [filters, setFilters] = useState<EntityFilters>({ page: 1, limit: 20 });
  const [loading, setLoading] = useState<boolean>(true);

  const { activityFeed } = useLiveStream();

  useEffect(() => {
    let ignore = false;
    Promise.all([
      listEntities(filters),
      getMetricsSummary("all"),
    ])
      .then(([entitiesData, metricsData]) => {
        if (!ignore) {
          setEntities(entitiesData.items);
          setPagination({
            total: entitiesData.total,
            page: entitiesData.page,
            limit: entitiesData.limit,
            totalPages: entitiesData.totalPages,
          });
          setMetrics(metricsData);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error("Failed to fetch entities or metrics:", err);
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
    <div className="pb-24">
      <PageHeader
        title="Revenue Entities"
        description="Query and inspect failed payment & recovery entities with real-time server-side filtering and pagination."
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
          <div className="text-xs text-ink-muted font-medium">Total Entities Flagged</div>
          <div className="text-2xl font-bold text-ink mt-1 tracking-heading-3">{pagination.total}</div>
        </div>

        <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
          <div className="text-xs text-ink-muted font-medium">Amount Under Recovery</div>
          <div className="text-2xl font-bold text-ink mt-1 tracking-heading-3">
            {formatCurrency(metrics?.amountAtRisk ?? 0)}
          </div>
        </div>

        <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
          <div className="text-xs text-ink-muted font-medium">Amount Recovered</div>
          <div className="text-2xl font-bold text-accent-green mt-1 tracking-heading-3">
            {formatCurrency(metrics?.amountRecovered ?? 0)}
          </div>
        </div>

        <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
          <div className="text-xs text-ink-muted font-medium">Recovery Rate</div>
          <div className="text-2xl font-bold text-primary mt-1 tracking-heading-3">
            {((metrics?.recoveryRate ?? 0) * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Entity Table Card */}
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

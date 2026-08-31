import React, { useState, useMemo, useRef, useEffect } from "react";
import { CustomerEntityLookupItem } from "../types";
import { formatCurrency, formatDateTime } from "../lib/formatters";
import { Badge } from "./Badge";

interface EntitySearchComboboxProps {
  entities: CustomerEntityLookupItem[];
  selectedEntityId: string;
  onSelectEntity: (entityId: string) => void;
  disabled?: boolean;
  loading?: boolean;
  hasCustomerSelected: boolean;
}

export function EntitySearchCombobox({
  entities,
  selectedEntityId,
  onSelectEntity,
  disabled = false,
  loading = false,
  hasCustomerSelected,
}: EntitySearchComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedEntity = useMemo(
    () => entities.find((e) => e.entityId === selectedEntityId),
    [entities, selectedEntityId],
  );

  const filteredEntities = useMemo(() => {
    if (!searchQuery.trim()) return entities;
    const q = searchQuery.toLowerCase();
    return entities.filter(
      (e) =>
        e.entityId.toLowerCase().includes(q) ||
        e.entityType.toLowerCase().includes(q) ||
        (e.eventType && e.eventType.toLowerCase().includes(q)) ||
        (e.state && e.state.toLowerCase().includes(q)) ||
        String(e.amount).includes(q),
    );
  }, [entities, searchQuery]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!hasCustomerSelected) {
    return (
      <div className="p-2.5 bg-canvas-soft border border-hairline rounded-[8px] text-xs text-ink-muted">
        Select a customer first to view and attach associated entities.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-2.5 bg-canvas-soft border border-hairline rounded-[8px] text-xs text-ink-muted animate-pulse flex items-center justify-between">
        <span>Loading customer entities...</span>
        <div className="w-4 h-4 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      {selectedEntity ? (
        <div className="flex items-center justify-between p-2.5 bg-primary/5 border border-primary/20 rounded-[8px]">
          <div className="min-w-0 pr-2 space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-ink truncate">
                {selectedEntity.entityId}
              </span>
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-white border border-hairline text-ink-muted">
                {selectedEntity.entityType}
              </span>
              {selectedEntity.state && (
                <Badge type="state" value={selectedEntity.state} />
              )}
            </div>
            <div className="text-[11px] text-ink-secondary flex items-center gap-2">
              <span className="font-semibold text-primary">
                {formatCurrency(selectedEntity.amount, selectedEntity.currency)}
              </span>
              {selectedEntity.eventType && (
                <span className="text-ink-muted">• {selectedEntity.eventType}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelectEntity("")}
            className="text-xs text-primary hover:text-primary-active font-medium px-2.5 py-1 bg-white border border-primary/30 rounded-[6px] shrink-0 transition-colors shadow-xs cursor-pointer"
          >
            Change
          </button>
        </div>
      ) : (
        <div>
          <div className="relative">
            <input
              type="text"
              disabled={disabled}
              placeholder={
                entities.length === 0
                  ? "No active entities found (standalone reference will be used)"
                  : "Search entity by ID, type, or amount..."
              }
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              className="w-full text-xs border border-hairline-input rounded-[4px] px-3 py-2 text-ink placeholder:text-ink-faint focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-xs text-ink-faint hover:text-ink transition-colors cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {isOpen && (
            <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-hairline rounded-[8px] shadow-notion-elevated divide-y divide-hairline/60">
              <button
                type="button"
                onClick={() => {
                  onSelectEntity("");
                  setIsOpen(false);
                  setSearchQuery("");
                }}
                className="w-full text-left px-3 py-2 hover:bg-canvas-soft flex items-center justify-between transition-colors bg-canvas-soft/30 cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-ink-muted italic">
                    None (Standalone Promise Reference)
                  </div>
                  <div className="text-[11px] text-ink-faint">
                    Generate a new standalone reference without linking an existing entity
                  </div>
                </div>
              </button>

              {filteredEntities.length === 0 ? (
                <div className="p-3 text-center text-xs text-ink-muted">
                  {entities.length === 0
                    ? "No unrecovered entities found for this customer."
                    : "No matching entities found."}
                </div>
              ) : (
                filteredEntities.map((e) => (
                  <button
                    key={e.entityId}
                    type="button"
                    onClick={() => {
                      onSelectEntity(e.entityId);
                      setIsOpen(false);
                      setSearchQuery("");
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-canvas-soft flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-ink truncate">
                          {e.entityId}
                        </span>
                        <span className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded bg-canvas-soft text-ink-muted border border-hairline">
                          {e.entityType}
                        </span>
                      </div>
                      <div className="text-[11px] text-ink-muted truncate">
                        {e.eventType || e.state || "Active"}
                        {e.occurredAt && ` • ${formatDateTime(e.occurredAt)}`}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-ink">
                        {formatCurrency(e.amount, e.currency)}
                      </div>
                      {e.state && (
                        <span className="text-[10px] text-accent-orange font-medium">
                          {e.state}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

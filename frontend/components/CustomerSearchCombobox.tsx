import React, { useState, useMemo, useRef, useEffect } from "react";
import { CustomerLookupItem } from "../types";

interface CustomerSearchComboboxProps {
  customers: CustomerLookupItem[];
  selectedCustomerId: string;
  onSelectCustomer: (customerId: string) => void;
  disabled?: boolean;
}

export function CustomerSearchCombobox({
  customers,
  selectedCustomerId,
  onSelectCustomer,
  disabled = false,
}: CustomerSearchComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId),
    [customers, selectedCustomerId],
  );

  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return customers;
    const q = searchQuery.toLowerCase();
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
    );
  }, [customers, searchQuery]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      {selectedCustomer ? (
        <div className="flex items-center justify-between p-2.5 bg-primary/5 border border-primary/20 rounded-[8px]">
          <div className="min-w-0 pr-2">
            <div className="text-xs font-semibold text-ink truncate">
              {selectedCustomer.name}
            </div>
            <div className="text-xs text-ink-muted truncate">{selectedCustomer.email}</div>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelectCustomer("")}
            className="text-xs text-primary hover:text-primary-active font-medium px-2.5 py-1 bg-white border border-primary/30 rounded-[6px] shrink-0 transition-colors shadow-xs"
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
              placeholder="Type customer name or email to search..."
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
                className="absolute right-2.5 top-2.5 text-xs text-ink-faint hover:text-ink transition-colors"
              >
                ✕
              </button>
            )}
          </div>

          {isOpen && (
            <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-hairline rounded-[8px] shadow-notion-elevated divide-y divide-hairline/60">
              {filteredCustomers.length === 0 ? (
                <div className="p-3 text-center text-xs text-ink-muted">
                  No matching customers found.
                </div>
              ) : (
                filteredCustomers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      onSelectCustomer(c.id);
                      setIsOpen(false);
                      setSearchQuery("");
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-canvas-soft flex items-center justify-between transition-colors"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-xs font-semibold text-ink truncate">{c.name}</div>
                      <div className="text-[11px] text-ink-muted truncate">{c.email}</div>
                    </div>
                    {c.riskTier && (
                      <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-canvas-soft text-ink-muted border border-hairline shrink-0 font-medium">
                        {c.riskTier}
                      </span>
                    )}
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

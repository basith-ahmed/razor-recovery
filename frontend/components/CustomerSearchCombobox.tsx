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
        <div className="flex items-center justify-between p-2 bg-blue-50 border border-blue-200 rounded">
          <div className="min-w-0 pr-2">
            <div className="text-sm font-semibold text-slate-900 truncate">
              {selectedCustomer.name}
            </div>
            <div className="text-xs text-slate-500 truncate">{selectedCustomer.email}</div>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelectCustomer("")}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 bg-white border border-blue-200 rounded shrink-0"
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
              className="w-full text-sm border border-slate-300 rounded px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-hidden focus:border-blue-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>

          {isOpen && (
            <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-slate-200 rounded divide-y divide-slate-100">
              {filteredCustomers.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-500">
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
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-sm font-medium text-slate-900 truncate">{c.name}</div>
                      <div className="text-xs text-slate-500 truncate">{c.email}</div>
                    </div>
                    {c.riskTier && (
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
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

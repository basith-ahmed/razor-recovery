"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Layers,
  Clock,
  AlertTriangle,
  BarChart3,
  ShieldCheck,
} from "lucide-react";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const NAV_GROUPS = [
  {
    label: "Operations",
    items: [
      {
        href: "/",
        label: "Overview",
        icon: <LayoutDashboard className="w-4 h-4" />,
        exact: true,
      },
      {
        href: "/entities",
        label: "Entities",
        icon: <Layers className="w-4 h-4" />,
        exact: false,
      },
    ],
  },
  {
    label: "Workflows",
    items: [
      {
        href: "/promises",
        label: "Promises to Pay",
        icon: <Clock className="w-4 h-4" />,
        exact: false,
      },
      {
        href: "/tickets",
        label: "Escalations",
        icon: <AlertTriangle className="w-4 h-4" />,
        exact: false,
      },
    ],
  },
  {
    label: "Analytics",
    items: [
      {
        href: "/metrics",
        label: "Metrics",
        icon: <BarChart3 className="w-4 h-4" />,
        exact: false,
      },
    ],
  },
  {
    label: "Configuration",
    items: [
      {
        href: "/policy",
        label: "Policy & Compliance",
        icon: <ShieldCheck className="w-4 h-4" />,
        exact: false,
      },
    ],
  },
];

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string, exact: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 backdrop-blur-[2px] lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`
          fixed top-14 bottom-0 left-0 z-30 w-56 bg-white border-r border-hairline flex flex-col
          transition-transform duration-200
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0 lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:shrink-0
        `}
      >
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-5">
              <div className="px-2 mb-1.5 text-[11px] font-semibold text-ink-muted uppercase tracking-eyebrow">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href, item.exact);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        className={`
                          flex items-center gap-2.5 px-2.5 py-2 rounded-[8px] text-xs font-medium transition-colors
                          ${active
                            ? "bg-primary/10 text-primary border border-primary/20 font-semibold"
                            : "text-ink-secondary hover:bg-canvas-soft hover:text-ink border border-transparent"
                          }
                        `}
                      >
                        <span className={active ? "text-primary" : "text-ink-muted"}>
                          {item.icon}
                        </span>
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-hairline">
          <div className="text-[11px] text-ink-faint px-2 font-medium">
            RazorRecovery · v1.0
          </div>
        </div>
      </aside>
    </>
  );
}

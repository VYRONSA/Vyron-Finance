"use client";

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/ui/brand-mark";
import { NotificationBell } from "@/components/financial/notification-bell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import {
  IconAlertTriangle,
  IconArchive,
  IconBank,
  IconBanknote,
  IconBarChart,
  IconBell,
  IconBookOpen,
  IconBuilding,
  IconChevronDown,
  IconChevronLeft,
  IconClock,
  IconFileText,
  IconGrid,
  IconHelpCircle,
  IconImport,
  IconListChecks,
  IconReceipt,
  IconReconcile,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconSliders,
  IconSparkles,
  IconUsers,
} from "@/components/ui/icons";

type ModuleLink = { label: string; href?: string; icon: ComponentType<{ className?: string }> };

// Groups and items match the approved reference exactly. Items with no
// `href` have no built page yet — per the "stop building placeholders"
// instruction they're rendered inert (not a Link, no navigation) rather
// than pointed at a route that would 404. See MIGRATION_ROADMAP.md.
const NAV_GROUPS: { label: string; items: ModuleLink[] }[] = [
  {
    label: "Executive",
    items: [
      { label: "Dashboard", href: "dashboard", icon: IconGrid },
      { label: "Bank Accounts", href: "bank-accounts", icon: IconBank },
      { label: "Import Centre", href: "import-centre", icon: IconImport },
      { label: "Cashbook", href: "cashbook", icon: IconBanknote },
      { label: "Transaction Explorer", href: "transactions", icon: IconListChecks },
      { label: "Automation Rules", href: "banking-rules", icon: IconSliders },
      { label: "Banking Exceptions", href: "banking-exceptions", icon: IconAlertTriangle },
      { label: "Matching", href: "matching", icon: IconReconcile },
      { label: "Suppliers", href: "suppliers", icon: IconUsers },
      { label: "Customers", href: "customers", icon: IconBuilding },
      { label: "Sales", href: "sales", icon: IconBanknote },
      { label: "Purchasing", href: "purchasing", icon: IconArchive },
      { label: "Inventory", href: "inventory", icon: IconSliders },
      { label: "Reports", href: "reports", icon: IconBarChart },
    ],
  },
  {
    label: "Automation",
    items: [
      { label: "Automation Dashboard", href: "automation-dashboard", icon: IconGrid },
      { label: "Recurring Templates", href: "recurring-templates", icon: IconRefresh },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "General Ledger", href: "general-ledger", icon: IconBookOpen },
      { label: "Journals", href: "general-ledger?tab=journals", icon: IconFileText },
      { label: "VAT", href: "vat", icon: IconReceipt },
      { label: "Reconciliation", href: "supplier-reconciliation", icon: IconReconcile },
      { label: "Auditor Workspace", href: "auditor", icon: IconShieldCheck },
      { label: "Fixed Assets", href: "assets", icon: IconArchive },
      { label: "AI Copilot", href: "copilot", icon: IconSparkles },
      { label: "Financial Statements", href: "financial-statements", icon: IconFileText },
      { label: "Communications", href: "communications", icon: IconBell },
      { label: "Billing", href: "billing", icon: IconBanknote },
      { label: "Opening Balances", href: "opening-balances", icon: IconClock },
      { label: "Settings", href: "settings", icon: IconSettings },
    ],
  },
];

export function FinancialWorkspaceShell({
  children,
  companyId,
  companyName,
  userEmail,
  previewMode,
}: {
  children: ReactNode;
  companyId: string;
  companyName: string;
  userEmail?: string;
  previewMode?: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const isActive = (href?: string) => {
    if (!href) return false;
    // Strip any query string (e.g. "general-ledger?tab=journals") — a
    // nav item that deep-links into a tab on a page should still
    // highlight when that page is active, `usePathname()` never includes
    // the query string to compare against.
    const hrefPath = href.split("?")[0];
    return pathname === `/company/${companyId}/${hrefPath}` || pathname.startsWith(`/company/${companyId}/${hrefPath}/`);
  };
  const initials = (userEmail ?? companyName).slice(0, 2).toUpperCase();

  // UI-005 — "the sidebar must never visually move... full-height blue
  // application frame." A `sticky` sidebar (last round's fix) still
  // *unsticks* once a long page has scrolled far enough that the
  // sidebar would overrun the bottom of its own containing row — the
  // exact "blue shell ends, page continues beneath it" symptom
  // reported. Sticky was the wrong tool: it makes an element stay put
  // *within document scroll*, not stay put *instead of* document
  // scroll. Real native-app sidebars (Slack, Linear, Notion) don't
  // scroll the document at all — the whole shell is pinned to the
  // viewport and only specific *panes inside it* scroll. `<main>`'s own
  // scroll position doesn't reset on route change the way the browser
  // naturally resets document scroll, so this effect does that
  // explicitly on every navigation.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    // `h-screen overflow-hidden` — the outermost frame is locked to
    // exactly the viewport size and never scrolls itself; every
    // scrollable region below is a deliberate, bounded exception
    // (`<nav>`, `<main>`), not the document. This is what actually
    // guarantees UI-003's "workspace must never scroll horizontally"
    // and UI-005's "sidebar must never visually move" at the same
    // time — both are the same underlying fix, a real fixed frame
    // instead of relying on sticky/overflow tricks layered on top of
    // ordinary document scroll.
    <div className="flex h-screen flex-col overflow-hidden bg-vf-workspace-bg">
      {previewMode && (
        <div className="shrink-0 border-b border-vf-red-500/25 bg-vf-red-500/10 px-4 py-2 text-center text-xs font-medium text-vf-red-600">
          Preview Mode — no Supabase project is configured yet, so this workspace is showing mock
          data with authentication disabled. See ARCHITECTURE.md.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "hidden h-full shrink-0 flex-col bg-gradient-to-b from-vf-red-600 to-vf-red-900 px-3 py-5 transition-[width] lg:flex",
            collapsed ? "w-[72px]" : "w-64",
          )}
        >
          {/* UI-006 — restrained on purpose: one flat icon frame (a
              ring, not a stack of glows), a stacked two-weight wordmark,
              and a precise tagline. `BrandMark` (src/components/ui/
              brand-mark.tsx) now renders the approved VYRON ecosystem
              compass-star reference — the same mark every future VYRON
              product shares, not something invented independently here. */}
          <Link href="/" className="group mb-1 flex flex-col items-start gap-3 px-1 pt-1" title="VYRON FINANCE — Financial Workspace">
            <span
              className={cn(
                "flex shrink-0 items-center justify-center rounded-xl bg-vf-charcoal ring-1 ring-white/[0.09] transition-transform duration-200 group-hover:scale-[1.03]",
                collapsed ? "h-10 w-10" : "h-12 w-12",
              )}
            >
              <BrandMark className={collapsed ? "h-6 w-6" : "h-7 w-7"} />
            </span>
            {!collapsed && (
              <div className="flex flex-col">
                <span className="font-display text-xl leading-[1.1] font-semibold tracking-tight text-vf-on-dark">VYRON</span>
                <span className="font-display text-xl leading-[1.1] font-light tracking-[0.06em] text-vf-red-300">FINANCE</span>
                <span className="mt-2.5 text-[0.6rem] leading-tight font-medium tracking-[0.16em] text-vf-on-dark-faint uppercase">
                  Enterprise Financial
                  <br />
                  Intelligence Platform
                </span>
              </div>
            )}
          </Link>
          <div className={cn("mt-5 mb-2 h-px bg-white/10", collapsed && "mx-1")} />

          <nav className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overflow-x-hidden pt-1">
            {NAV_GROUPS.map((group, groupIndex) => (
              <div key={group.label}>
                {!collapsed && (
                  <p
                    className={cn(
                      "px-3 pb-2 text-[0.65rem] font-semibold tracking-[0.14em] text-vf-on-dark-faint/80 uppercase",
                      groupIndex > 0 && "border-t border-white/[0.06] pt-4",
                    )}
                  >
                    {group.label}
                  </p>
                )}
                <div className="flex flex-col gap-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    const content = (
                      <>
                        <Icon className="h-4 w-4 shrink-0" />
                        {!collapsed && item.label}
                      </>
                    );
                    const itemClass = cn(
                      "flex items-center gap-2.5 rounded-vf-sm px-3 py-2.5 text-sm font-medium transition",
                      collapsed && "justify-center",
                      active
                        ? "bg-white/16 text-vf-on-dark shadow-[inset_3px_0_0_var(--color-vf-red-300)]"
                        : "text-vf-on-dark-soft hover:bg-white/8 hover:text-vf-on-dark",
                    );
                    return item.href ? (
                      <Link key={item.label} href={`/company/${companyId}/${item.href}`} className={itemClass} title={collapsed ? item.label : undefined}>
                        {content}
                      </Link>
                    ) : (
                      <span key={item.label} className={itemClass} aria-disabled title={collapsed ? item.label : undefined}>
                        {content}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "mt-4 flex items-center gap-2 rounded-vf-sm px-3 py-2 text-xs font-medium text-vf-on-dark-faint transition hover:bg-white/8 hover:text-vf-on-dark",
              collapsed && "justify-center",
            )}
          >
            <IconChevronLeft className={cn("h-3.5 w-3.5 transition-transform", collapsed && "rotate-180")} />
            {!collapsed && "Collapse"}
          </button>
        </aside>

        {/* `min-w-0` on both flex items below is the actual fix for
            VR-022 (Transaction Explorer's table pushing the whole page
            wider instead of scrolling internally) — a classic flexbox
            gotcha: a flex item's default `min-width` is `auto`, which
            lets it grow to fit its widest descendant (here, any page's
            wide data table) rather than respecting the row's available
            width, so the overflow propagates all the way up to the
            document instead of being caught by any `overflow-x-auto`
            container further down. Fixed once, here, in the one shell
            every page in this workspace renders inside — not per-page —
            so this can't recur on a page that happens to render a wide
            table later. `min-h-0` is the same fix on the height axis —
            needed now that `<main>` below has its own bounded scroll
            (UI-005) instead of the document scrolling. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="z-10 flex shrink-0 items-center justify-between gap-4 border-b border-vf-paper-border bg-vf-paper px-6 py-3">
            <Link
              href="/platform"
              className="flex items-center gap-1.5 text-sm transition hover:text-vf-red-600"
              title="Switch company — return to Platform Overview"
            >
              <span className="font-medium text-vf-ink">{companyName}</span>
              <IconChevronDown className="h-3.5 w-3.5 text-vf-ink-faint" />
              <span className="ml-1 hidden text-vf-ink-faint sm:inline">/ Financial Workspace</span>
            </Link>

            <div className="flex flex-1 items-center justify-end gap-3">
              <div className="relative hidden max-w-xs flex-1 sm:block">
                <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-vf-ink-faint" />
                <input
                  type="search"
                  placeholder="Search — coming soon"
                  disabled
                  title="Workspace-wide search is not available yet"
                  className="w-full rounded-full border border-vf-paper-border bg-vf-paper-alt py-1.5 pr-3 pl-9 text-sm text-vf-ink-faint outline-none disabled:cursor-not-allowed"
                />
              </div>
              <NotificationBell companyId={companyId} previewMode={previewMode} />
              <span
                className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-full text-vf-ink-faint"
                role="img"
                aria-label="Help — documentation coming soon"
                title="Help documentation is coming soon"
              >
                <IconHelpCircle className="h-4.5 w-4.5" />
              </span>
              <span className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-vf-red-500 to-vf-red-800 text-xs font-semibold text-vf-on-dark">
                  {initials}
                </span>
                {userEmail && <SignOutButton className="text-xs font-medium text-vf-ink-soft transition hover:text-vf-red-600" />}
              </span>
            </div>
          </header>

          <main ref={mainRef} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 2xl:px-10">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

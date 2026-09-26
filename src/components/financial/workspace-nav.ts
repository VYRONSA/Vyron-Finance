import type { ComponentType } from "react";
import {
  IconAlertTriangle,
  IconArchive,
  IconBank,
  IconBanknote,
  IconBarChart,
  IconBell,
  IconBookOpen,
  IconBuilding,
  IconClock,
  IconFileText,
  IconGrid,
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
  IconTarget,
  IconUsers,
} from "@/components/ui/icons";

/**
 * Phase 5G — the ONE navigation model.
 *
 * This list and the helpers below were lifted verbatim out of
 * `workspace-shell.tsx` so the desktop sidebar and the tablet/mobile
 * drawer render from the same source. The requirement was explicit:
 * one navigation model, not two systems that drift apart. No route,
 * label, icon or ordering changed in the move.
 */

// `exact` — highlight only on the page itself, not its sub-pages (the
// Reporting Centre home would otherwise light up on every category).
export type ModuleLink = { label: string; href?: string; icon: ComponentType<{ className?: string }>; exact?: boolean };
/** A parent entry inside a section: it has no page of its own, it opens
 * to show its children (only one parent open at a time). */
export type NavParent = { label: string; icon: ComponentType<{ className?: string }>; children: ModuleLink[] };
export type NavEntry = ModuleLink | NavParent;
export type NavGroup = { label: string; items: NavEntry[] };

export function isNavParent(entry: NavEntry): entry is NavParent {
  return "children" in entry;
}

/** Every real link in a section, parents expanded — for the icons-only
 * strip, active-state checks and "is every destination reachable". */
export function groupLinks(group: NavGroup): ModuleLink[] {
  return group.items.flatMap((e) => (isNavParent(e) ? e.children : [e]));
}

// Groups and items match the approved reference exactly. Items with no
// `href` have no built page yet — per the "stop building placeholders"
// instruction they're rendered inert (not a Link, no navigation) rather
// than pointed at a route that would 404. See MIGRATION_ROADMAP.md.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Executive",
    // Main destinations only; related pages sit under a parent that opens
    // on click (Banking, Transactions, Contacts). Same routes as before.
    items: [
      { label: "Dashboard", href: "dashboard", icon: IconGrid },
      { label: "PRECISIA Intelligence", href: "intelligence", icon: IconSparkles },
      {
        label: "Banking",
        icon: IconBank,
        children: [
          { label: "Bank Accounts", href: "bank-accounts", icon: IconBank },
          { label: "Import Centre", href: "import-centre", icon: IconImport },
          { label: "Cashbook", href: "cashbook", icon: IconBanknote },
          { label: "Banking Exceptions", href: "banking-exceptions", icon: IconAlertTriangle },
          { label: "Matching", href: "matching", icon: IconReconcile },
        ],
      },
      {
        label: "Transactions",
        icon: IconListChecks,
        children: [
          { label: "Transaction Explorer", href: "transactions", icon: IconListChecks },
          { label: "Find & Recode", href: "transactions/find-and-recode", icon: IconSearch },
        ],
      },
      {
        label: "Contacts",
        icon: IconUsers,
        children: [
          { label: "Suppliers", href: "suppliers", icon: IconUsers },
          { label: "Customers", href: "customers", icon: IconBuilding },
        ],
      },
      { label: "Sales", href: "sales", icon: IconBanknote },
      { label: "Purchasing", href: "purchasing", icon: IconArchive },
      { label: "Inventory", href: "inventory", icon: IconSliders },
    ],
  },
  {
    // The Reporting Centre — a first-class area with one entry per
    // reporting domain, all sharing one report shell, filters, exports
    // and drill-down (see src/server/report-centre). The original
    // Reports page (budgets, forecasting, executive alerts, report
    // designer) lives on here, unchanged, as "Budgets & Forecasts".
    label: "Reporting",
    items: [
      { label: "Reporting Centre", href: "reporting", icon: IconBarChart, exact: true },
      { label: "Management", href: "reporting/management", icon: IconSparkles },
      { label: "Financial", href: "reporting/financial", icon: IconFileText },
      { label: "Customers", href: "reporting/customers", icon: IconBuilding },
      { label: "Suppliers", href: "reporting/suppliers", icon: IconUsers },
      { label: "Sales", href: "reporting/sales", icon: IconBanknote },
      { label: "Purchasing", href: "reporting/purchasing", icon: IconArchive },
      { label: "Banking", href: "reporting/banking", icon: IconBank },
      { label: "VAT & Tax", href: "reporting/vat", icon: IconReceipt },
      { label: "General Ledger", href: "reporting/general-ledger", icon: IconBookOpen },
      { label: "Inventory", href: "reporting/inventory", icon: IconSliders },
      { label: "Audit & Compliance", href: "reporting/audit", icon: IconShieldCheck },
      { label: "Document Centre", href: "reporting/documents", icon: IconArchive },
      { label: "Budgets & Forecasts", href: "reports", icon: IconTarget },
    ],
  },
  {
    label: "Automation",
    items: [
      { label: "Automation Dashboard", href: "automation-dashboard", icon: IconGrid },
      { label: "Automation Rules", href: "banking-rules", icon: IconSliders },
      { label: "Recurring Templates", href: "recurring-templates", icon: IconRefresh },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "General Ledger", href: "general-ledger", icon: IconBookOpen },
      { label: "Journals", href: "general-ledger?tab=journals", icon: IconFileText },
      { label: "My Drafts", href: "drafts", icon: IconClock },
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

/** Is this nav item the page currently open?
 *
 * Moved verbatim from the shell. The query string is stripped because a
 * nav item that deep-links into a tab ("general-ledger?tab=journals")
 * must still highlight when that page is open — `usePathname()` never
 * includes a query string to compare against. */
export function isNavItemActive(pathname: string, companyId: string, href?: string, exact = false): boolean {
  if (!href) return false;
  const hrefPath = href.split("?")[0];
  return pathname === `/company/${companyId}/${hrefPath}` || (!exact && pathname.startsWith(`/company/${companyId}/${hrefPath}/`));
}

/** Phase 5G — which group the open page belongs to, so the sidebar can
 * open that section automatically.
 *
 * Deliberately returns the group of the MOST SPECIFIC match rather than
 * the first: "Reporting Centre" (`reporting`, exact) and "Financial"
 * (`reporting/financial`) both sit in the same group here, but a longer
 * href always describes the page better, and future groups may share a
 * prefix. `null` when the route is not in the nav at all (a detail page
 * such as a single supplier), in which case the shell leaves whatever
 * section the user had open alone. */
export function activeNavGroup(pathname: string, companyId: string, groups: NavGroup[] = NAV_GROUPS): string | null {
  let best: { label: string; length: number } | null = null;
  for (const group of groups) {
    for (const item of groupLinks(group)) {
      if (!isNavItemActive(pathname, companyId, item.href, item.exact)) continue;
      const length = (item.href ?? "").split("?")[0]!.length;
      if (!best || length > best.length) best = { label: group.label, length };
    }
  }
  return best?.label ?? null;
}

/** Which parent entry holds the open page (so it opens automatically), or
 * null when the page is a top-level item or outside the nav. Most specific
 * match wins, as in `activeNavGroup`. */
export function activeNavParent(pathname: string, companyId: string, groups: NavGroup[] = NAV_GROUPS): string | null {
  let best: { label: string; length: number } | null = null;
  for (const group of groups) {
    for (const entry of group.items) {
      const candidates = isNavParent(entry) ? entry.children.map((c) => ({ parent: entry.label, link: c })) : [{ parent: null, link: entry }];
      for (const { parent, link } of candidates) {
        if (!isNavItemActive(pathname, companyId, link.href, link.exact)) continue;
        const length = (link.href ?? "").split("?")[0]!.length;
        if (!best || length > best.length) best = { label: parent ?? "", length };
      }
    }
  }
  return best?.label ? best.label : null;
}

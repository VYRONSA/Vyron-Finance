/**
 * Master Implementation Tracker — Programme 2, Root Cause RC-7. Shared
 * option-building for the GL Account `Combobox` (`src/components/ui/
 * combobox.tsx`, already built for Transaction Explorer's redesign —
 * this just applies it to the other free-text GL fields RC-7 covers)
 * so every picker presents accounts the same way.
 */

import type { ComboboxOption } from "@/components/ui/combobox";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatTreatment } from "@/server/company-management/types";
import type { Customer } from "@/server/customer-management/types";
import type { Supplier } from "@/server/accounting/types";
import type { StockItem } from "@/server/inventory/types";

export function glAccountOptions(accounts: ChartOfAccount[]): ComboboxOption<string>[] {
  return accounts
    .filter((a) => a.isActive)
    .map((a) => ({
      value: a.accountCode,
      label: `${a.accountCode} — ${a.description}`,
      sublabel: a.accountType,
      searchText: `${a.accountCode} ${a.description} ${a.accountType}`,
    }));
}

/** Matches `transaction-grid.tsx`'s `VatCodeCell` option shape exactly,
 * so a VAT code looks the same wherever it's picked. */
export function vatCodeOptions(vatTreatments: VatTreatment[]): ComboboxOption<string>[] {
  return vatTreatments
    .filter((v) => v.isActive)
    .map((v) => ({
      value: v.code,
      label: v.code,
      sublabel: `${v.rate}% · ${v.name}`,
      searchText: `${v.code} ${v.name} ${v.rate}`,
    }));
}

/** Finding #167 (RC-7 slice) — same searchable-picker treatment applied
 * to Customer/Supplier/Stock Item selection in Sales/Purchasing/Inventory
 * document lines, which were still plain unfiltered `<Select>`/`.map()`.
 * `customerOptions` still expects callers to do their own active-only
 * filtering first (finding #200's fix; Customer active-filtering is
 * unchanged and out of scope here — see Phase 38's own report for why). */
export function customerOptions(customers: Customer[]): ComboboxOption<number>[] {
  return customers.map((c) => ({
    value: c.id,
    label: c.name,
    sublabel: c.customerCode,
    searchText: `${c.customerCode} ${c.name}`,
  }));
}

/** Phase 38 — this used to match `customerOptions` above (build options
 * from whatever list the caller passes in, trusting every caller to
 * pre-filter to Active first). Four real call sites didn't — Inactive
 * suppliers (including the intentionally-deactivated duplicate records
 * from Phase 33/36) were selectable in Transaction Explorer, Find &
 * Recode, Supplier Reconciliation, and Opening Balances. Filtering here,
 * matching `glAccountOptions`/`vatCodeOptions`/`stockItemOptions` above —
 * every one of this file's OTHER option-builders already filters to
 * Active internally; `supplierOptions` was the one inconsistent case.
 * Bills/Purchase Orders/Supplier Payments/Requisitions/GRNs already
 * pre-filter before calling this (see e.g. `bills-tab.tsx`) — filtering
 * again here is redundant but harmless for them, and now makes it safe
 * for any caller, present or future, that doesn't. */
export function supplierOptions(suppliers: Supplier[]): ComboboxOption<number>[] {
  return suppliers
    .filter((s) => s.status === "Active")
    .map((s) => ({
      value: s.id,
      label: s.name,
      sublabel: s.supplierCode,
      searchText: `${s.supplierCode} ${s.name} ${s.alternativeNames.join(" ")}`,
    }));
}

export function stockItemOptions(stockItems: StockItem[]): ComboboxOption<number>[] {
  return stockItems
    .filter((i) => i.status === "Active")
    .map((i) => ({
      value: i.id,
      label: `${i.stockCode} — ${i.description}`,
      sublabel: i.category || undefined,
      searchText: `${i.stockCode} ${i.description} ${i.barcode} ${i.category}`,
    }));
}

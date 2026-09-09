/**
 * Domain types for the Opening Balances Management Centre — Pilot
 * Review Round 1, Phase 1. One entry per opening-balance line, across
 * every supported category, posted through the same one Posting Engine
 * every other module uses (never a hidden numeric column of its own).
 */

export const OPENING_BALANCE_CATEGORIES = [
  "GeneralLedger", "BankAccount", "Customer", "Supplier", "Inventory", "FixedAsset", "VATControl", "Loan",
] as const;
export type OpeningBalanceCategory = (typeof OPENING_BALANCE_CATEGORIES)[number];

/** Inventory and FixedAsset are schema-ready (a row can be created with
 * either category) but have no dedicated capture workflow in the
 * Opening Balances Centre UI yet — see Pilot Review Round 1's
 * completion report for the honest scope disclosure. */
export const OPENING_BALANCE_UI_CATEGORIES = [
  "GeneralLedger", "BankAccount", "Customer", "Supplier", "VATControl", "Loan",
] as const satisfies readonly OpeningBalanceCategory[];

export type OpeningBalanceStatus = "draft" | "posted";

export type OpeningBalanceEntry = {
  id: number;
  companyId: string;
  category: OpeningBalanceCategory;
  accountCode: string | null;
  bankAccountId: number | null;
  customerId: number | null;
  supplierId: number | null;
  description: string;
  amount: number;
  reference: string;
  balanceDate: string;
  status: OpeningBalanceStatus;
  journalId: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type NewOpeningBalanceEntry = {
  category: OpeningBalanceCategory;
  accountCode?: string | null;
  bankAccountId?: number | null;
  customerId?: number | null;
  supplierId?: number | null;
  description: string;
  amount: number;
  reference?: string;
  balanceDate?: string;
};

export type EditOpeningBalanceEntry = Partial<{
  description: string;
  amount: number;
  reference: string;
  balanceDate: string;
}>;

/** Whether editing opening balances for this company currently requires
 * the post-go-live governance gate (mandatory reason, `OpeningBalance`
 * approval permission, full audit trail) or is still freely editable
 * during implementation. `companies.status !== 'onboarding'` is used as
 * the practical proxy — no dedicated go-live flag exists on `Company`
 * yet; see the Round 1 completion report for this disclosed limitation. */
export type OpeningBalanceGovernance = {
  requiresGovernance: boolean;
  reasonRequired: boolean;
};

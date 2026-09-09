/**
 * Domain types for the platform's ONE Rule Engine — built for Banking
 * (Migration Roadmap Module 6), extended for every automation domain by
 * the Recurring Transactions & Autonomous Automation Platform (Module 7).
 * Genuinely new when first built: no rule-matching table existed anywhere
 * in this codebase before Module 6 (confirmed by research — `posting_rules`
 * is an unrelated event-type -> DR/CR templating engine). See
 * `supabase/migrations/0013_banking_automation.sql` and
 * `0014_automation_platform.sql` (adds the `domain` column, widens
 * `rule_type`/`field`/`action_type` from Banking-only fixed enums to
 * free text validated per-domain in the service layer — see
 * `automation-rule-domains.ts`).
 */

export type RuleDomain =
  | "Banking" | "Sales" | "Purchasing" | "Inventory" | "GeneralLedger"
  | "VAT" | "Reporting" | "CustomerCommunications" | "SupplierCommunications";

export const RULE_DOMAINS: RuleDomain[] = [
  "Banking", "Sales", "Purchasing", "Inventory", "GeneralLedger", "VAT",
  "Reporting", "CustomerCommunications", "SupplierCommunications",
];

/** Banking's own 12 rule types — the PRB named these individually for
 * Banking specifically; other domains only got a domain NAME (not a list
 * of sub-types), so they use one generic rule type each — see
 * `automation-rule-domains.ts::DOMAIN_RULE_TYPES`. */
export type BankingRuleType =
  | "Merchant"
  | "Supplier"
  | "Customer"
  | "GL"
  | "VAT"
  | "Payment"
  | "BankFee"
  | "Transfer"
  | "Payroll"
  | "Loan"
  | "Interest"
  | "Recurring";

export const BANKING_RULE_TYPES: BankingRuleType[] = [
  "Merchant", "Supplier", "Customer", "GL", "VAT", "Payment",
  "BankFee", "Transfer", "Payroll", "Loan", "Interest", "Recurring",
];

/** Banking's own default condition fields — kept as the named export UI
 * code already imports; other domains have their own vocabulary (see
 * `automation-rule-domains.ts::DOMAIN_CONDITION_FIELDS`). The DB column
 * itself is free text (Module 7 dropped the Banking-only CHECK). */
export type ConditionField = string;

export const CONDITION_FIELDS: ConditionField[] = [
  "beneficiary", "description", "reference", "notes", "bank_account", "gl_account", "amount", "debit", "credit",
];

export type ConditionOperator =
  | "contains" | "equals" | "starts_with" | "ends_with" | "regex"
  | "greater_than" | "less_than" | "between";

export const CONDITION_OPERATORS: ConditionOperator[] = [
  "contains", "equals", "starts_with", "ends_with", "regex", "greater_than", "less_than", "between",
];

export type BankingRuleCondition = {
  id: number;
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
  value2: string | null;
};

/** Banking's own default action types — see
 * `automation-rule-domains.ts::DOMAIN_ACTION_TYPES` for other domains'
 * vocabularies; the DB column is free text (Module 7 dropped the
 * Banking-only CHECK). */
export type ActionType = string;

export const ACTION_TYPES: ActionType[] = [
  "set_merchant", "set_supplier", "set_customer", "set_gl_account", "set_vat_code", "flag_for_review",
];

export type BankingRuleAction = {
  id: number;
  actionType: ActionType;
  targetId: number | null;
  targetText: string | null;
};

export type BankingRule = {
  id: number;
  companyId: string;
  domain: RuleDomain;
  ruleType: string;
  name: string;
  description: string;
  priority: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  conditions: BankingRuleCondition[];
  actions: BankingRuleAction[];
};

export type BankingRuleVersion = {
  id: number;
  ruleId: number;
  version: number;
  snapshot: unknown;
  createdAt: string;
  createdBy: string;
};

export type BankingRuleApplication = {
  id: number;
  ruleId: number;
  bankTransactionId: number;
  appliedAt: string;
};

/** Exception Intelligence review (see this file's own change history) —
 * only 4 of these 8 have a real producer anywhere in the codebase today:
 * `UnknownMerchant`/`PossibleDuplicate`/`LargeUnusualPayment` are raised
 * automatically by `rule-processing-service.ts`; `UnbalancedAllocation`
 * only via a manually-authored Banking Rule's `flag_for_review` action
 * (which — unlike VAT's own rule engine — ignores the action's own
 * `targetText` for type selection and always raises this one type).
 *
 * `MissingSupplier`, `MissingInvoice`, `UnexpectedVAT`, and
 * `PeriodConflict` are deliberately dormant, not merely unfinished:
 *   - `MissingSupplier`/`MissingInvoice` would need "this beneficiary has
 *     no matched supplier/bill" as their trigger, but `matched_supplier_id`/
 *     `matched_bill_id` are written by the Matching Engine — a separate,
 *     manually-triggered process (Supplier Reconciliation's "Generate
 *     Supplier Allocation Reports") that does NOT run automatically
 *     before or as part of import, sync, or the Rule Engine. A null match
 *     at Rule-Engine time is therefore at least as likely to mean
 *     "Matching hasn't run yet" as "genuinely missing" — raising either
 *     exception from that signal would produce systematic false
 *     positives for any company that simply hasn't run Matching.
 *   - `UnexpectedVAT`/`PeriodConflict` would require treating a bank
 *     transaction's own VAT/date fields as authoritative, but Find &
 *     Recode's own VAT-recode inspection already established that a bank
 *     transaction's VAT code is informational only (never read by
 *     journal posting or VAT Return computation) — building a real
 *     conflict/period check belongs on VAT documents (invoices/bills),
 *     where it already exists in a more precise form: see
 *     `VatExceptionType`'s own `VatRateConflict` in `server/vat/types.ts`.
 * No code should raise any of these 4 until a real, non-speculative
 * trigger condition is confirmed. */
export type ExceptionType =
  | "UnknownMerchant" | "MissingSupplier" | "PossibleDuplicate"
  | "UnbalancedAllocation" | "MissingInvoice" | "UnexpectedVAT"
  | "PeriodConflict" | "LargeUnusualPayment";

/** Human-readable label for each exception type — "Important UX Rule":
 * show "Possible Duplicate", never the raw `PossibleDuplicate` enum
 * value. Framework-free (no React) so it's safe to import from both UI
 * components and the pure Financial Intelligence Engine. */
export const EXCEPTION_LABEL: Record<ExceptionType, string> = {
  UnknownMerchant: "Unknown Merchant",
  MissingSupplier: "Missing Supplier",
  PossibleDuplicate: "Possible Duplicate",
  UnbalancedAllocation: "Unbalanced Allocation",
  MissingInvoice: "Missing Invoice",
  UnexpectedVAT: "Unexpected VAT",
  PeriodConflict: "Period Conflict",
  LargeUnusualPayment: "Large Unusual Payment",
};

export type ExceptionStatus = "Open" | "Resolved" | "Dismissed";

export type BankingException = {
  id: number;
  companyId: string;
  bankTransactionId: number;
  exceptionType: ExceptionType;
  reason: string;
  evidence: string;
  recommendedAction: string;
  status: ExceptionStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
};

export type Merchant = {
  id: number;
  companyId: string;
  name: string;
  aliases: string[];
  defaultSupplierId: number | null;
  defaultCustomerId: number | null;
  defaultGlAccount: string;
  defaultVatCode: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

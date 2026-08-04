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

export type ExceptionType =
  | "UnknownMerchant" | "MissingSupplier" | "PossibleDuplicate"
  | "UnbalancedAllocation" | "MissingInvoice" | "UnexpectedVAT"
  | "PeriodConflict" | "LargeUnusualPayment";

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

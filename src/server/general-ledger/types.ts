/**
 * Domain types for the General Ledger & Accounting Engine (Module 10) —
 * Chart of Accounts, Posting Rules, the GL itself (gl_transactions), and
 * Posting Batches. See supabase/migrations/0007_general_ledger.sql.
 *
 * Chart of Accounts nesting, a database-driven Posting Rules engine, and
 * Posting Batches have no reference-app equivalent — genuinely new
 * capability for this port (see that migration's header comment). Journal
 * types (Draft/Submitted/Approved/Rejected/Posted/Cancelled workflow)
 * remain in `server/accounting/types.ts`, where they already lived from
 * Transaction Explorer — extended there, not duplicated here.
 */

export type AccountType =
  | "Asset"
  | "Liability"
  | "Equity"
  | "Income"
  | "Cost of Sales"
  | "Expense"
  | "Other Income"
  | "Other Expense";

export type NormalBalance = "Debit" | "Credit";

export type ChartOfAccount = {
  id: number;
  companyId: string;
  accountCode: string;
  description: string;
  accountType: AccountType;
  category: string;
  normalBalance: NormalBalance;
  parentAccountId: number | null;
  reportingGroup: string;
  financialStatementGroup: string;
  taxTreatment: string;
  branchId: number | null;
  departmentId: number | null;
  costCentreId: number | null;
  /** Financial Reporting & Executive Intelligence Platform (Module 9) —
   * the 4th Management Reporting dimension, real, mirroring Branch/
   * Department/Cost Centre exactly ("One Business Object"). */
  projectId: number | null;
  isControlAccount: boolean;
  isActive: boolean;
  notes: string;
  createdAt: string;
};

/** Client-assembled adjacency-list tree — see `buildAccountTree()` in
 * `chart-of-accounts-service.ts`. Never persisted; always derived. */
export type ChartOfAccountNode = ChartOfAccount & { children: ChartOfAccountNode[] };

export type PostingRuleSide = "Debit" | "Credit";
export type PostingRuleAmountSource = "gross" | "net" | "vat";

export type PostingRuleLine = {
  id: number;
  postingRuleId: number;
  lineOrder: number;
  side: PostingRuleSide;
  role: string;
  fixedAccountCode: string | null;
  amountSource: PostingRuleAmountSource;
};

export type PostingRule = {
  id: number;
  companyId: string;
  eventType: string;
  description: string;
  isActive: boolean;
  createdAt: string;
  lines: PostingRuleLine[];
};

export type PostingBatch = {
  id: number;
  companyId: string;
  batchNumber: string;
  postingDate: string;
  journalCount: number;
  transactionCount: number;
  postedBy: string;
  createdAt: string;
};

export type GlTransaction = {
  id: number;
  companyId: string;
  journalId: number;
  journalLineId: number;
  accountId: number;
  postingDate: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  financialYearLabel: string;
  financialPeriod: number;
  postedAt: string;
  postedBy: string;
};

/** A `GlTransaction` with its account/journal identity joined in — what
 * GL Inquiry actually displays; never persisted on its own. */
export type GlTransactionWithContext = GlTransaction & {
  accountCode: string;
  accountDescription: string;
  journalNumber: string;
  sourceType: string;
};

// Trial Balance — live/instant, computed via `fn_trial_balance()`
// (see 0007_general_ledger.sql) for the same 100,000+-row-safe reason as
// Transaction Explorer's `fn_transaction_explorer_summary`.

export type TrialBalanceRow = {
  accountId: number;
  accountCode: string;
  description: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  totalDebit: number;
  totalCredit: number;
  /** Net presentation columns — standard trial-balance display: whichever
   * side the account's net movement falls on, independent of its
   * `normalBalance` (a contra account legitimately nets the other way). */
  debitBalance: number;
  creditBalance: number;
};

export type TrialBalance = {
  asOfDate: string | null;
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
};

// GL Inquiry filters — date/account/reference/branch/department/cost
// centre/source module/search, keyset-paginated like Transaction
// Explorer's grid (see that module's own `fn_transaction_explorer_summary`
// header comment for why OFFSET pagination isn't an option at this scale).

export type GlInquiryFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  accountId: number | null;
  reference: string | null;
  search: string | null;
  branchId: number | null;
  departmentId: number | null;
  costCentreId: number | null;
  sourceType: string | null;
};

/** Opaque to callers — encodes the posting-date + id keyset cursor. See
 * `gl-inquiry-service.ts::encodeGlCursor`. */
export type GlInquiryCursor = { postingDate: string; id: number };

export type GlInquiryPage = {
  transactions: GlTransactionWithContext[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Parallel to `transactions` (same order/index) — only populated when
   * `filters.accountId` is set, since a running balance is only
   * meaningful for a single account. See
   * `gl-inquiry-service.ts::listGlTransactions` for the known same-date
   * pagination-boundary approximation. */
  runningBalances: number[] | null;
};

// Account Activity — opening/movements/closing for one account over a
// date range, ported from the reference's
// `general_ledger.get_account_transactions` sign-by-normal-balance logic.

export type MonthlyActivityBucket = {
  month: string; // "YYYY-MM"
  debit: number;
  credit: number;
  netMovement: number;
};

export type AccountActivity = {
  account: ChartOfAccount;
  dateFrom: string;
  dateTo: string;
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  transactions: GlTransaction[];
  monthlyTrend: MonthlyActivityBucket[];
};

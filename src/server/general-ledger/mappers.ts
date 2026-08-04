/**
 * Row <-> domain type mappers for the General Ledger module (see
 * supabase/migrations/0007_general_ledger.sql).
 */

import type {
  AccountType,
  ChartOfAccount,
  GlTransaction,
  GlTransactionWithContext,
  NormalBalance,
  PostingBatch,
  PostingRule,
  PostingRuleAmountSource,
  PostingRuleLine,
  PostingRuleSide,
  TrialBalanceRow,
} from "./types";

export type ChartOfAccountRow = {
  id: number;
  company_id: string;
  account_code: string;
  description: string;
  account_type: string;
  category: string;
  normal_balance: string;
  parent_account_id: number | null;
  reporting_group: string;
  financial_statement_group: string;
  tax_treatment: string;
  branch_id: number | null;
  department_id: number | null;
  cost_centre_id: number | null;
  project_id: number | null;
  is_control_account: boolean;
  is_active: boolean;
  notes: string;
  created_at: string;
};

export function chartOfAccountFromRow(row: ChartOfAccountRow): ChartOfAccount {
  return {
    id: row.id,
    companyId: row.company_id,
    accountCode: row.account_code,
    description: row.description,
    accountType: row.account_type as AccountType,
    category: row.category,
    normalBalance: row.normal_balance as NormalBalance,
    parentAccountId: row.parent_account_id,
    reportingGroup: row.reporting_group,
    financialStatementGroup: row.financial_statement_group,
    taxTreatment: row.tax_treatment,
    branchId: row.branch_id,
    departmentId: row.department_id,
    costCentreId: row.cost_centre_id,
    projectId: row.project_id,
    isControlAccount: row.is_control_account,
    isActive: row.is_active,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export type PostingRuleLineRow = {
  id: number;
  posting_rule_id: number;
  line_order: number;
  side: string;
  role: string;
  fixed_account_code: string | null;
  amount_source: string;
};

export function postingRuleLineFromRow(row: PostingRuleLineRow): PostingRuleLine {
  return {
    id: row.id,
    postingRuleId: row.posting_rule_id,
    lineOrder: row.line_order,
    side: row.side as PostingRuleSide,
    role: row.role,
    fixedAccountCode: row.fixed_account_code,
    amountSource: row.amount_source as PostingRuleAmountSource,
  };
}

export type PostingRuleRow = {
  id: number;
  company_id: string;
  event_type: string;
  description: string;
  is_active: boolean;
  created_at: string;
  posting_rule_lines?: PostingRuleLineRow[];
};

export function postingRuleFromRow(row: PostingRuleRow): PostingRule {
  return {
    id: row.id,
    companyId: row.company_id,
    eventType: row.event_type,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
    lines: (row.posting_rule_lines ?? [])
      .slice()
      .sort((a, b) => a.line_order - b.line_order)
      .map(postingRuleLineFromRow),
  };
}

export type PostingBatchRow = {
  id: number;
  company_id: string;
  batch_number: string;
  posting_date: string;
  journal_count: number;
  transaction_count: number;
  posted_by: string;
  created_at: string;
};

export function postingBatchFromRow(row: PostingBatchRow): PostingBatch {
  return {
    id: row.id,
    companyId: row.company_id,
    batchNumber: row.batch_number,
    postingDate: row.posting_date,
    journalCount: row.journal_count,
    transactionCount: row.transaction_count,
    postedBy: row.posted_by,
    createdAt: row.created_at,
  };
}

export type GlTransactionRow = {
  id: number;
  company_id: string;
  journal_id: number;
  journal_line_id: number;
  account_id: number;
  posting_date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  financial_year_label: string;
  financial_period: number;
  posted_at: string;
  posted_by: string;
};

export function glTransactionFromRow(row: GlTransactionRow): GlTransaction {
  return {
    id: row.id,
    companyId: row.company_id,
    journalId: row.journal_id,
    journalLineId: row.journal_line_id,
    accountId: row.account_id,
    postingDate: row.posting_date,
    reference: row.reference,
    description: row.description,
    debit: Number(row.debit),
    credit: Number(row.credit),
    financialYearLabel: row.financial_year_label,
    financialPeriod: row.financial_period,
    postedAt: row.posted_at,
    postedBy: row.posted_by,
  };
}

export type GlTransactionWithContextRow = GlTransactionRow & {
  chart_of_accounts: { account_code: string; description: string };
  ae_journals: { journal_number: string; source_type: string };
};

export function glTransactionWithContextFromRow(row: GlTransactionWithContextRow): GlTransactionWithContext {
  return {
    ...glTransactionFromRow(row),
    accountCode: row.chart_of_accounts.account_code,
    accountDescription: row.chart_of_accounts.description,
    journalNumber: row.ae_journals.journal_number,
    sourceType: row.ae_journals.source_type,
  };
}

export type TrialBalanceRpcRow = {
  account_id: number;
  account_code: string;
  description: string;
  account_type: string;
  normal_balance: string;
  total_debit: number;
  total_credit: number;
};

/** Net presentation: whichever side the account's movement nets to —
 * independent of `normalBalance` (a contra account legitimately nets the
 * other way), matching standard trial-balance display convention. */
export function trialBalanceRowFromRpcRow(row: TrialBalanceRpcRow): TrialBalanceRow {
  const totalDebit = Number(row.total_debit);
  const totalCredit = Number(row.total_credit);
  const net = Math.round((totalDebit - totalCredit) * 100) / 100;
  return {
    accountId: row.account_id,
    accountCode: row.account_code,
    description: row.description,
    accountType: row.account_type as AccountType,
    normalBalance: row.normal_balance as NormalBalance,
    totalDebit,
    totalCredit,
    debitBalance: net >= 0 ? net : 0,
    creditBalance: net < 0 ? -net : 0,
  };
}

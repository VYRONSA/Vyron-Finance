/**
 * VYRON Financial Intelligence Engine — Phase 10.
 *
 * Pure, framework-independent (no React, no Supabase, no I/O). Every
 * function here takes real values another existing service already
 * computed and turns them into zero or more `Finding`s. Nothing here
 * recalculates an accounting figure, detects a new pattern, or invents a
 * threshold — see FINDINGS_INVENTORY.md alongside this file for the full
 * audit of what already exists and exactly what each rule below reuses.
 *
 * Two kinds of rule:
 *   1. Genuinely new findings (Data Quality, Banking-exceptions-as-
 *      findings, Transactions, Customer/Supplier overdue, VAT) — each a
 *      presence/threshold check over an already-computed real value.
 *   2. Normalizers that wrap an already-independently-computed signal
 *      (`findingsFromExecutiveAlerts`) into the common `Finding` shape —
 *      the exact same technique `executive-intelligence-service.ts::
 *      normalizeFinancialIntelligence` already uses at a smaller scope.
 */

import type { Finding, FindingCategory, FindingSeverity } from "./types";
import { FINDING_SEVERITY_ORDER } from "./types";
import { EXCEPTION_LABEL, type BankingException, type ExceptionType } from "@/server/banking-rules/types";
import type { ExecutiveAlert, ExecutiveAlertType } from "@/server/reporting/types";
import type { AgingBuckets } from "@/server/shared/aging";
import type { VatDashboardSummary } from "@/server/services/vat-summary-service";
import type { FinancialIntelligenceReport } from "@/server/services/financial-intelligence-service";
import type { RecurringTransactionPattern } from "./recurring-transaction-detector";
import { CUSTOMER_CONCENTRATION_HIGH_THRESHOLD, type CustomerConcentrationRisk } from "./customer-concentration-detector";
import type { RepeatedCorrectionPattern } from "./repeated-correction-detector";
import type { AssetFinding, AssetFindingType } from "@/server/assets/types";
import { FINDING_PENALTY } from "@/server/services/asset-dashboard-summary-service";
import type { AuditFinding } from "@/server/audit/types";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------
// Data Quality / Setup — "VYRON should be able to tell the user when
// its own financial picture is incomplete" (brief, section 13). Every
// input here is a plain boolean the caller already knows from a real,
// already-fetched list — this rule does no counting or thresholding of
// its own beyond "is this empty."
// ---------------------------------------------------------------------

export type DataQualityInput = {
  companyId: string;
  hasBankAccount: boolean;
  hasBankTransactionsImported: boolean;
  hasOpeningBalanceEntries: boolean;
  hasCustomers: boolean;
  hasSuppliers: boolean;
  hasFinancialYearConfigured: boolean;
  /** Phase 13. Optional — omitted means "unknown", never treated as a
   * problem (only an explicit `false` raises a finding; the safest
   * default when a caller hasn't fetched this yet is silence, not a
   * false claim). VAT configuration was deliberately NOT added here:
   * there is no reliable existing signal for whether a company should
   * be VAT-registered (the wizard's own `vatRegistered` field is never
   * persisted to `Company` — confirmed by inspection), so flagging
   * "no VAT treatments" would be a coin-flip false positive for any
   * non-VAT-registered business. See FINDINGS_INVENTORY.md. */
  hasChartOfAccounts?: boolean;
};

export function findDataQualityFindings(input: DataQualityInput): Finding[] {
  const { companyId } = input;
  const findings: Finding[] = [];

  if (!input.hasFinancialYearConfigured) {
    findings.push({
      id: "data-quality-no-financial-year",
      category: "DataQuality",
      severity: "Medium",
      title: "Accounting isn't fully configured yet",
      description: "No financial year has been set up for this company.",
      evidence: "0 financial years found.",
      recommendedAction: "Configure the financial year",
      actionHref: `/company/${companyId}/settings`,
      source: "Deterministic",
    });
  }

  if (!input.hasBankAccount) {
    findings.push({
      id: "data-quality-no-bank-account",
      category: "DataQuality",
      severity: "Medium",
      title: "No bank account has been added yet",
      description: "Bank accounts are required before statements can be imported or transactions matched.",
      evidence: "0 bank accounts found.",
      recommendedAction: "Add a bank account",
      actionHref: `/company/${companyId}/bank-accounts/new`,
      source: "Deterministic",
    });
  } else if (!input.hasBankTransactionsImported) {
    findings.push({
      id: "data-quality-no-bank-transactions",
      category: "DataQuality",
      severity: "Medium",
      title: "No bank transactions have been imported yet",
      description: "A bank account exists, but no statement has been imported against it.",
      evidence: "0 import batches found.",
      recommendedAction: "Import a bank statement",
      actionHref: `/company/${companyId}/import-centre`,
      source: "Deterministic",
    });
  }

  if (!input.hasOpeningBalanceEntries) {
    findings.push({
      id: "data-quality-no-opening-balances",
      category: "DataQuality",
      severity: "Medium",
      title: "Opening balances haven't been entered yet",
      description: "No opening balance entries exist for this company.",
      evidence: "0 opening balance entries found.",
      recommendedAction: "Enter opening balances",
      actionHref: `/company/${companyId}/opening-balances`,
      source: "Deterministic",
    });
  }

  if (!input.hasCustomers) {
    findings.push({
      id: "data-quality-no-customers",
      category: "DataQuality",
      severity: "Medium",
      title: "No customers have been added yet",
      description: "This company has no customer records yet.",
      evidence: "0 customers found.",
      recommendedAction: "Add a customer",
      actionHref: `/company/${companyId}/customers`,
      source: "Deterministic",
    });
  }

  if (!input.hasSuppliers) {
    findings.push({
      id: "data-quality-no-suppliers",
      category: "DataQuality",
      severity: "Medium",
      title: "No suppliers have been added yet",
      description: "This company has no supplier records yet.",
      evidence: "0 suppliers found.",
      recommendedAction: "Add a supplier",
      actionHref: `/company/${companyId}/suppliers`,
      source: "Deterministic",
    });
  }

  if (input.hasChartOfAccounts === false) {
    findings.push({
      id: "data-quality-no-chart-of-accounts",
      category: "DataQuality",
      severity: "Medium",
      title: "Chart of Accounts hasn't been configured yet",
      description: "This company has no General Ledger accounts set up yet.",
      evidence: "0 Chart of Accounts entries found.",
      recommendedAction: "Configure the Chart of Accounts",
      actionHref: `/company/${companyId}/general-ledger`,
      source: "Deterministic",
    });
  }

  return findings;
}

// ---------------------------------------------------------------------
// Banking — real open Banking Exceptions grouped by type (one Finding
// per type, not per row, so 8 duplicate payments don't flood the list),
// plus real reconciliation-outstanding counts. No new detection: every
// exception here was already raised by `banking-intelligence.ts` /
// `rule-processing-service.ts`.
// ---------------------------------------------------------------------

const EXCEPTION_SEVERITY: Record<ExceptionType, FindingSeverity> = {
  PossibleDuplicate: "High",
  LargeUnusualPayment: "High",
  UnbalancedAllocation: "High",
  UnexpectedVAT: "Medium",
  MissingSupplier: "Medium",
  UnknownMerchant: "Medium",
  MissingInvoice: "Medium",
  PeriodConflict: "Medium",
};

export type BankingIntelligenceInput = {
  companyId: string;
  openExceptions: BankingException[];
  accountsNeedingReconciliation: number;
};

export function findBankingFindings(input: BankingIntelligenceInput): Finding[] {
  const { companyId } = input;
  const findings: Finding[] = [];

  const byType = new Map<ExceptionType, BankingException[]>();
  for (const exc of input.openExceptions) {
    const list = byType.get(exc.exceptionType) ?? [];
    list.push(exc);
    byType.set(exc.exceptionType, list);
  }

  for (const [type, exceptions] of byType) {
    const label = EXCEPTION_LABEL[type];
    findings.push({
      id: `banking-exception-${type}`,
      category: "Banking",
      severity: EXCEPTION_SEVERITY[type],
      title: `${exceptions.length} ${label.toLowerCase()}${exceptions.length === 1 ? "" : "s"} detected`,
      description:
        type === "PossibleDuplicate"
          ? "VYRON has flagged these as possible duplicate payments — review before allocating."
          : type === "LargeUnusualPayment"
            ? "VYRON has flagged these as unusually large or unusual payments — review before allocating."
            : `${exceptions.length} open ${label} exception(s) require review.`,
      evidence: `${exceptions.length} open ${label} exception(s): ${exceptions
        .slice(0, 3)
        .map((e) => e.reason)
        .join("; ")}${exceptions.length > 3 ? `; +${exceptions.length - 3} more` : ""}.`,
      recommendedAction: "Review Banking Exceptions",
      actionHref: `/company/${companyId}/banking-exceptions`,
      source: "ExistingIntelligenceSignal",
    });
  }

  if (input.accountsNeedingReconciliation > 0) {
    findings.push({
      id: "banking-reconciliation-outstanding",
      category: "Banking",
      severity: input.accountsNeedingReconciliation >= 3 ? "High" : "Medium",
      title: "Bank reconciliation outstanding",
      description: `${input.accountsNeedingReconciliation} bank account(s) have reconciliation outstanding (never reconciled, or over 30 days since the last one).`,
      evidence: `${input.accountsNeedingReconciliation} account(s) needing reconciliation.`,
      recommendedAction: "Reconcile Statement",
      actionHref: `/company/${companyId}/cashbook`,
      source: "Derived",
    });
  }

  return findings;
}

// ---------------------------------------------------------------------
// Transactions — real Transaction Explorer summary counts.
// ---------------------------------------------------------------------

export type TransactionIntelligenceInput = {
  companyId: string;
  awaitingReviewCount: number;
  unallocatedCount: number;
};

export function findTransactionFindings(input: TransactionIntelligenceInput): Finding[] {
  const { companyId } = input;
  const findings: Finding[] = [];

  if (input.awaitingReviewCount > 0) {
    findings.push({
      id: "transactions-awaiting-review",
      category: "Transactions",
      severity: input.awaitingReviewCount >= 10 ? "High" : "Medium",
      title: `${input.awaitingReviewCount} transaction${input.awaitingReviewCount === 1 ? "" : "s"} require review`,
      description: "These transactions were suggested by the Matching Engine but haven't been confirmed yet.",
      evidence: `${input.awaitingReviewCount} transaction(s) with status Suggested and no review decision.`,
      recommendedAction: "Review Transactions",
      actionHref: `/company/${companyId}/transactions`,
      source: "Derived",
    });
  }

  if (input.unallocatedCount > 0) {
    findings.push({
      id: "transactions-unallocated",
      category: "Transactions",
      severity: input.unallocatedCount >= 20 ? "High" : "Medium",
      title: `${input.unallocatedCount} transaction${input.unallocatedCount === 1 ? "" : "s"} unallocated`,
      description: "These transactions have no GL account, supplier, or customer assigned yet.",
      evidence: `${input.unallocatedCount} transaction(s) with status Unallocated.`,
      recommendedAction: "Review Transactions",
      actionHref: `/company/${companyId}/transactions`,
      source: "Derived",
    });
  }

  return findings;
}

// ---------------------------------------------------------------------
// Recurring Transactions — Phase 25B. Wraps already-computed
// `RecurringTransactionPattern`s (from `recurring-transaction-detector.ts`,
// a pure module operating on raw transaction history) into `Finding`s;
// this function itself detects nothing. Recurring is not inherently
// risky — every pattern found here is advisory (`Low`), matching the
// brief's own "recurring != automatically risky" instruction. A `Medium`
// or higher severity would require an associated anomaly signal, which no
// existing detector currently supplies for a recurring stream specifically
// — left as documented future work, not invented here.
// ---------------------------------------------------------------------

export type RecurringTransactionIntelligenceInput = {
  companyId: string;
  recurringPatterns: RecurringTransactionPattern[] | undefined;
};

export function findRecurringTransactionFindings(input: RecurringTransactionIntelligenceInput): Finding[] {
  const { companyId, recurringPatterns } = input;
  if (!recurringPatterns) return [];
  return recurringPatterns.map((p) => {
    const latestTransactionId = p.transactionIds[p.transactionIds.length - 1];
    const noun = p.direction === "Debit" ? "payment" : "receipt";
    return {
      id: `recurring-${p.direction.toLowerCase()}-${latestTransactionId}`,
      category: "Transactions",
      severity: "Low",
      title: `${p.periodicity} ${noun} to ${p.beneficiary}`,
      description: `${p.occurrenceCount} ${noun}s to ${p.beneficiary} at roughly ${p.periodicity.toLowerCase()} intervals, most recently on ${p.latestDate}.`,
      evidence: `${p.occurrenceCount} occurrence(s) since ${p.firstDate}, typical amount ${money(p.typicalAmount)}, latest ${p.latestDate}.`,
      recommendedAction: "Review Transactions",
      actionHref: `/company/${companyId}/transactions`,
      source: "Deterministic",
      companyId,
    };
  });
}

// ---------------------------------------------------------------------
// Repeated Correction — Phase 25D. Wraps already-computed
// `RepeatedCorrectionPattern`s (from `repeated-correction-detector.ts`,
// reusing `transaction-explorer-service.ts::REPEATED_ALLOCATION_THRESHOLD`
// — the same threshold that already powers the inline "create a Banking
// Rule?" prompt) into `Finding`s; this function itself detects nothing.
// Purely advisory — Low severity always, per the brief's own "evidence of
// an automation opportunity, not an accounting risk." Never creates,
// modifies, or applies a Banking Rule; only suggests considering one.
// ---------------------------------------------------------------------

export type RepeatedCorrectionIntelligenceInput = {
  companyId: string;
  repeatedCorrectionPatterns: RepeatedCorrectionPattern[] | undefined;
};

export function findRepeatedCorrectionFindings(input: RepeatedCorrectionIntelligenceInput): Finding[] {
  const { companyId, repeatedCorrectionPatterns } = input;
  if (!repeatedCorrectionPatterns) return [];
  return repeatedCorrectionPatterns.map((p) => {
    const latestTransactionId = p.transactionIds[p.transactionIds.length - 1];
    return {
      id: `repeated-correction-${latestTransactionId}`,
      category: "Transactions",
      severity: "Low",
      title: "Repeated manual correction detected",
      description: `${p.beneficiary} has been manually allocated to ${p.glAccount} ${p.occurrenceCount} times. Consider creating a Banking Rule.`,
      evidence: `${p.occurrenceCount} manual allocation(s) of "${p.beneficiary}" to ${p.glAccount}, most recently on ${p.latestDate ?? "an unknown date"}.`,
      recommendedAction: "Review Banking Rules",
      actionHref: `/company/${companyId}/banking-rules`,
      source: "Deterministic",
      companyId,
    };
  });
}

// ---------------------------------------------------------------------
// Customers / Suppliers — real aging buckets Customer/Supplier
// Management already computes. "Overdue" reuses the exact boundary the
// Scoring Engine's own `BusinessRiskInputs.overdueDebtorsCount` comment
// already documents as this codebase's convention ("debtors aged past
// 90 days" — the `days120Plus` bucket, despite its name; see
// `server/shared/aging.ts`). No new threshold invented.
// ---------------------------------------------------------------------

export function findCustomerFindings(input: { companyId: string; debtorsAging: AgingBuckets }): Finding[] {
  const overdue = input.debtorsAging.days120Plus;
  if (overdue <= 0) return [];
  return [
    {
      id: "customers-overdue-balance",
      category: "Customers",
      severity: "High",
      title: "Customer balance overdue",
      description: "One or more customers have an outstanding balance more than 90 days overdue.",
      evidence: `${money(overdue)} overdue by more than 90 days.`,
      recommendedAction: "Review Customer Aging",
      actionHref: `/company/${input.companyId}/customers`,
      source: "Derived",
    },
  ];
}

export function findSupplierFindings(input: { companyId: string; creditorsAging: AgingBuckets }): Finding[] {
  const overdue = input.creditorsAging.days120Plus;
  if (overdue <= 0) return [];
  return [
    {
      id: "suppliers-overdue-balance",
      category: "Suppliers",
      severity: "High",
      title: "Supplier balance overdue",
      description: "One or more suppliers have an outstanding balance more than 90 days overdue.",
      evidence: `${money(overdue)} overdue by more than 90 days.`,
      recommendedAction: "Review Supplier Aging",
      actionHref: `/company/${input.companyId}/suppliers`,
      source: "Derived",
    },
  ];
}

// ---------------------------------------------------------------------
// Customer Revenue Concentration — Phase 25C. Wraps an already-computed
// `CustomerConcentrationRisk` (from `customer-concentration-detector.ts`,
// the customer-side mirror of `executive-intelligence-service.ts::
// detectSupplierRisk`'s share-of-total check) into a `Finding`; this
// function itself detects nothing. Severity mirrors detectSupplierRisk's
// own 40%/60% share bands exactly — no new severity model.
// ---------------------------------------------------------------------

export function findCustomerConcentrationFindings(input: { companyId: string; customerConcentration: CustomerConcentrationRisk | null | undefined }): Finding[] {
  const { companyId, customerConcentration } = input;
  if (!customerConcentration) return [];
  const { customerName, sharePercent, customerRevenue, totalRevenue } = customerConcentration;

  return [
    {
      id: "customer-revenue-concentration",
      category: "Customers",
      severity: sharePercent >= CUSTOMER_CONCENTRATION_HIGH_THRESHOLD * 100 ? "High" : "Medium",
      title: "Customer revenue concentration",
      description: `${customerName} accounts for ${sharePercent}% of total posted revenue — a concentration risk if this relationship changes.`,
      evidence: `${money(customerRevenue)} of ${money(totalRevenue)} total posted revenue (${sharePercent}%).`,
      recommendedAction: "Review Customers",
      actionHref: `/company/${companyId}/customers`,
      source: "Deterministic",
      companyId,
    },
  ];
}

// ---------------------------------------------------------------------
// VAT — real `VatDashboardSummary` fields only. No new tax calculation.
// ---------------------------------------------------------------------

export function findVatFindings(input: { companyId: string; vatSummary: VatDashboardSummary }): Finding[] {
  const { companyId, vatSummary } = input;
  const findings: Finding[] = [];

  if (vatSummary.vatPayable > 0) {
    findings.push({
      id: "vat-liability-exists",
      category: "VAT",
      severity: "Medium",
      title: "VAT liability exists",
      description: "The latest VAT return shows a net amount payable to the tax authority.",
      evidence: `${money(vatSummary.vatPayable)} VAT payable on the latest return.`,
      recommendedAction: "Review VAT",
      actionHref: `/company/${companyId}/vat`,
      source: "Derived",
    });
  }

  if (vatSummary.draftReturnCount > 0) {
    findings.push({
      id: "vat-return-draft",
      category: "VAT",
      severity: "Medium",
      title: `${vatSummary.draftReturnCount} VAT return${vatSummary.draftReturnCount === 1 ? "" : "s"} awaiting completion`,
      description: "One or more VAT returns are still in Draft status.",
      evidence: `${vatSummary.draftReturnCount} VAT return(s) with status Draft.`,
      recommendedAction: "Review VAT",
      actionHref: `/company/${companyId}/vat`,
      source: "Derived",
    });
  }

  if (vatSummary.openExceptionCount > 0) {
    findings.push({
      id: "vat-exceptions-open",
      category: "VAT",
      severity: vatSummary.openExceptionCount >= 5 ? "Critical" : "Medium",
      title: `${vatSummary.openExceptionCount} VAT exception${vatSummary.openExceptionCount === 1 ? "" : "s"} require review`,
      description: "Open VAT exceptions reduce the VAT Compliance Score and should be resolved before filing.",
      evidence: `${vatSummary.openExceptionCount} open VAT exception(s). Compliance score: ${vatSummary.complianceScorePercent}%.`,
      recommendedAction: "Review VAT",
      actionHref: `/company/${companyId}/vat`,
      source: "Derived",
    });
  }

  return findings;
}

// ---------------------------------------------------------------------
// General Ledger (Phase 13) — wraps the EXISTING, already-computed
// `FinancialIntelligenceReport` (financial-intelligence-service.ts:
// findPossibleDuplicateJournals, findMissingPostings — both already
// real, GL-transaction-level detectors) into the common Finding shape.
// `largestMovements` and `unusualGrowth` are deliberately NOT surfaced
// as findings: a large posting or a period-over-period swing isn't
// inherently a problem the way a stuck/duplicate posting is — treating
// every period's single largest transaction as a "finding" would be
// noise, not intelligence. `report` is optional: only pass it when the
// caller has actually fetched it (an expensive GL scan) — omitting it
// means "not evaluated," never "clean."
// ---------------------------------------------------------------------

export function findGeneralLedgerFindings(input: { companyId: string; report: FinancialIntelligenceReport | undefined }): Finding[] {
  const { companyId, report } = input;
  if (!report) return [];
  const findings: Finding[] = [];

  for (const dup of report.possibleDuplicateJournals) {
    findings.push({
      id: `gl-duplicate-journal-${dup.accountId}-${dup.postingDate}-${dup.side}-${dup.amount}`,
      category: "GeneralLedger",
      severity: dup.occurrences.length >= 3 ? "High" : "Medium",
      title: `${dup.occurrences.length} journals posted the same amount to ${dup.accountCode}`,
      description: dup.reasoning,
      evidence: `${dup.occurrences.length} journal(s) — ${dup.occurrences.map((o) => o.journalNumber).join(", ")} — posted ${dup.side.toLowerCase()} ${money(dup.amount)} to ${dup.accountCode} on ${dup.postingDate}.`,
      recommendedAction: "Review Financial Reports",
      actionHref: `/company/${companyId}/general-ledger?tab=journals`,
      source: "ExistingIntelligenceSignal",
    });
  }

  for (const missing of report.missingPostings) {
    findings.push({
      id: `gl-missing-posting-${missing.journalId}`,
      category: "GeneralLedger",
      severity: missing.ageDays >= 21 ? "High" : "Medium",
      title: `Journal ${missing.journalNumber} stuck as ${missing.status}`,
      description: missing.reasoning,
      evidence: `${missing.journalNumber} — ${missing.status} for ${missing.ageDays} day(s).`,
      recommendedAction: "Review Financial Reports",
      actionHref: `/company/${companyId}/general-ledger?tab=journals`,
      source: "ExistingIntelligenceSignal",
    });
  }

  return findings;
}

// ---------------------------------------------------------------------
// Cash Flow (Phase 13) — a negative total cash balance is a plain fact,
// not an invented threshold (zero is the literal boundary between
// having and not having money). "Significant cash movements" and
// "banking activity requiring review" are already covered without a
// new rule: DecliningCash (wrapped Executive Alert, below) and
// findBankingFindings already own those signals — duplicating them
// here would be a second calculation of the same thing.
// ---------------------------------------------------------------------

export function findCashFlowFindings(input: { companyId: string; totalCash: number | undefined }): Finding[] {
  const { companyId, totalCash } = input;
  if (totalCash === undefined || totalCash >= 0) return [];
  return [
    {
      id: "cashflow-negative-balance",
      category: "CashFlow",
      severity: "Critical",
      title: "Cash balance is negative",
      description: "Total cash across this company's active bank accounts is below zero.",
      evidence: `Total cash: ${money(totalCash)}.`,
      recommendedAction: "Go to Banking",
      actionHref: `/company/${companyId}/bank-accounts`,
      source: "Derived",
    },
  ];
}

// ---------------------------------------------------------------------
// Profitability (Phase 13) — a net loss for the period is a plain fact
// read directly from the real Income Statement (financial-statements-
// service.ts), not a judgment call about whether "profit is bad." No
// trend/comparison claim is made here — see findingsFromExecutiveAlerts'
// MarginReduction wrapping for the real period-over-period signal.
// ---------------------------------------------------------------------

export function findProfitabilityFindings(input: { companyId: string; netProfit: number | undefined }): Finding[] {
  const { companyId, netProfit } = input;
  if (netProfit === undefined || netProfit >= 0) return [];
  return [
    {
      id: "profitability-net-loss",
      category: "Profitability",
      severity: "High",
      title: "Net loss this period",
      description: "The Income Statement shows a net loss for the current period.",
      evidence: `Net Profit: ${money(netProfit)}.`,
      recommendedAction: "Review Financial Reports",
      actionHref: `/company/${companyId}/reports`,
      source: "Derived",
    },
  ];
}

// ---------------------------------------------------------------------
// Fixed Assets (Phase 13) — wraps the EXISTING, already-persisted
// `AssetFinding` records (asset-intelligence-service.ts) into the
// common Finding shape. Severity is derived from the SAME
// `FINDING_PENALTY` weight table `asset-dashboard-summary-service.ts`
// already uses for its own Asset Health Score — not a new weighting
// invented for this file.
// ---------------------------------------------------------------------

function assetFindingSeverity(findingType: AssetFindingType): FindingSeverity {
  const penalty = FINDING_PENALTY[findingType] ?? 3;
  if (penalty >= 6) return "High";
  if (penalty >= 4) return "Medium";
  return "Low";
}

export function findingsFromAssetFindings(findings: AssetFinding[] | undefined): Finding[] {
  if (!findings) return [];
  return findings.map((f) => ({
    id: `asset-finding-${f.id}`,
    category: "Operations",
    severity: assetFindingSeverity(f.findingType),
    title: f.reason,
    description: f.reason,
    evidence: f.evidence,
    recommendedAction: f.suggestedAction || null,
    actionHref: f.suggestedAction ? `/company/${f.companyId}/assets` : null,
    source: "ExistingIntelligenceSignal",
    companyId: f.companyId,
    createdAt: f.createdAt,
  }));
}

// ---------------------------------------------------------------------
// Audit (Phase 13) — wraps the EXISTING, already-persisted
// `AuditFinding` records (audit-finding-service.ts). `severity` is
// copied verbatim — `AuditFindingSeverity` is the exact same
// Low/Medium/High/Critical scale as `FindingSeverity`, confirmed by
// inspection (see FINDINGS_INVENTORY.md); no mapping needed.
// ---------------------------------------------------------------------

export function findingsFromAuditFindings(findings: AuditFinding[] | undefined): Finding[] {
  if (!findings) return [];
  return findings.map((f) => ({
    id: `audit-finding-${f.id}`,
    category: "Compliance",
    severity: f.severity,
    title: f.reason,
    description: f.reason,
    evidence: f.evidence,
    recommendedAction: f.suggestedProcedure || null,
    actionHref: f.suggestedProcedure ? `/company/${f.companyId}/auditor` : null,
    source: "ExistingIntelligenceSignal",
    companyId: f.companyId,
    createdAt: f.createdAt,
  }));
}

// ---------------------------------------------------------------------
// Executive Alerts normalizer — wraps the EXISTING, already-persisted
// `ExecutiveAlert` records (10 real detectors in
// executive-intelligence-service.ts) into the common Finding shape.
// Severity is copied verbatim (`ExecutiveAlertPriority` IS
// `FindingSeverity` — same type). Nothing is recalculated.
// ---------------------------------------------------------------------

const ALERT_TYPE_CATEGORY: Record<ExecutiveAlertType, FindingCategory> = {
  DecliningCash: "CashFlow",
  IncreasingDebtors: "Customers",
  SlowPayingCustomers: "Customers",
  SupplierRisk: "Suppliers",
  MarginReduction: "Profitability",
  InventoryProblems: "Operations",
  ComplianceIssues: "Compliance",
  AutomationFailures: "Operations",
  LargeUnusualTransactions: "Transactions",
  DuplicateTrends: "Transactions",
};

function alertActionHref(alertType: ExecutiveAlertType, companyId: string): string {
  switch (alertType) {
    case "DecliningCash":
    case "MarginReduction":
      return `/company/${companyId}/reports`;
    case "IncreasingDebtors":
    case "SlowPayingCustomers":
      return `/company/${companyId}/customers`;
    case "SupplierRisk":
      return `/company/${companyId}/suppliers`;
    case "InventoryProblems":
      return `/company/${companyId}/inventory`;
    case "ComplianceIssues":
      return `/company/${companyId}/vat`;
    case "AutomationFailures":
      return `/company/${companyId}/automation-dashboard`;
    case "LargeUnusualTransactions":
    case "DuplicateTrends":
      return `/company/${companyId}/transactions`;
    default:
      return `/company/${companyId}/dashboard`;
  }
}

export function findingsFromExecutiveAlerts(alerts: ExecutiveAlert[]): Finding[] {
  return alerts.map((alert) => ({
    id: `exec-alert-${alert.id}`,
    category: ALERT_TYPE_CATEGORY[alert.alertType],
    severity: alert.priority,
    title: alert.reason,
    description: alert.reason,
    evidence: alert.evidence,
    recommendedAction: alert.recommendedAction,
    actionHref: alertActionHref(alert.alertType, alert.companyId),
    source: "ExistingIntelligenceSignal",
    companyId: alert.companyId,
    createdAt: alert.createdAt,
  }));
}

// ---------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------

export type FinancialIntelligenceInput = DataQualityInput &
  BankingIntelligenceInput &
  TransactionIntelligenceInput & {
    debtorsAging: AgingBuckets;
    creditorsAging: AgingBuckets;
    vatSummary: VatDashboardSummary;
    openExecutiveAlerts: ExecutiveAlert[];
    /** Phase 13 — all optional. Omitting one means "not evaluated for
     * this call," never "clean" — each rule function treats `undefined`
     * as no findings from that source, not a fabricated all-clear. */
    financialIntelligenceReport?: FinancialIntelligenceReport;
    totalCash?: number;
    netProfit?: number;
    openAssetFindings?: AssetFinding[];
    openAuditFindings?: AuditFinding[];
    /** Phase 25B — already-computed by `recurring-transaction-detector.ts`
     * (a pure module over raw transaction history); this engine only
     * wraps the result into `Finding`s, per the "not itself a new
     * detector" convention every other Phase 13 optional field above
     * already follows. */
    recurringPatterns?: RecurringTransactionPattern[];
    /** Phase 25C — already-computed by `customer-concentration-detector.ts`
     * (a pure module over already-loaded `Customer[]`/`SalesInvoice[]`);
     * this engine only wraps the result into a `Finding`, same convention
     * as `recurringPatterns` above. `null` means "evaluated, no
     * concentration found"; `undefined` means "not evaluated." */
    customerConcentration?: CustomerConcentrationRisk | null;
    /** Phase 25D — already-computed by `repeated-correction-detector.ts`
     * (a pure module over already-loaded `BankTransactionRecord[]`); this
     * engine only wraps the result into `Finding`s, same convention as
     * `recurringPatterns` above. */
    repeatedCorrectionPatterns?: RepeatedCorrectionPattern[];
  };

export type FinancialIntelligenceSummary = {
  findings: Finding[];
  countBySeverity: Record<FindingSeverity, number>;
  /** Phase 13 — echoed straight through from the input (not recomputed)
   * so a consumer like VYRON Ask's "What is happening with my cash?" /
   * "How is profitability looking?" can report the real underlying
   * number alongside the findings, without a second fetch of the same
   * figure. `undefined` when the caller didn't supply it. */
  totalCash?: number;
  netProfit?: number;
};

/** "Company -> Financial Intelligence -> Findings -> Severity ->
 * Recommended Actions" (brief, section 8). Pure — aggregates every rule
 * above, never recalculates any of their inputs. Findings are sorted
 * most-severe-first, matching the Executive Dashboard's own presentation
 * order. */
export function buildFinancialIntelligenceSummary(input: FinancialIntelligenceInput): FinancialIntelligenceSummary {
  const { companyId } = input;

  const findings: Finding[] = [
    ...findDataQualityFindings(input),
    ...findBankingFindings(input),
    ...findTransactionFindings(input),
    ...findRecurringTransactionFindings({ companyId, recurringPatterns: input.recurringPatterns }),
    ...findRepeatedCorrectionFindings({ companyId, repeatedCorrectionPatterns: input.repeatedCorrectionPatterns }),
    ...findCustomerFindings({ companyId, debtorsAging: input.debtorsAging }),
    ...findSupplierFindings({ companyId, creditorsAging: input.creditorsAging }),
    ...findCustomerConcentrationFindings({ companyId, customerConcentration: input.customerConcentration }),
    ...findVatFindings({ companyId, vatSummary: input.vatSummary }),
    ...findGeneralLedgerFindings({ companyId, report: input.financialIntelligenceReport }),
    ...findCashFlowFindings({ companyId, totalCash: input.totalCash }),
    ...findProfitabilityFindings({ companyId, netProfit: input.netProfit }),
    ...findingsFromAssetFindings(input.openAssetFindings),
    ...findingsFromAuditFindings(input.openAuditFindings),
    ...findingsFromExecutiveAlerts(input.openExecutiveAlerts),
  ];

  findings.sort((a, b) => FINDING_SEVERITY_ORDER.indexOf(a.severity) - FINDING_SEVERITY_ORDER.indexOf(b.severity));

  const countBySeverity: Record<FindingSeverity, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const f of findings) countBySeverity[f.severity] += 1;

  return { findings, countBySeverity, totalCash: input.totalCash, netProfit: input.netProfit };
}

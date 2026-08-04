/**
 * Pure Reporting Package assembler — no Supabase, no new calculation.
 * "Each package should reuse existing report generators and narrative
 * engines." The service layer fetches every real statement/note/
 * narrative/audit-summary piece once; this file only decides WHICH of
 * those already-computed pieces a given package type bundles, and
 * assembles the resulting snapshot — never recomputing a figure.
 */

import type { IncomeStatement } from "./income-statement-engine";
import type { BalanceSheet } from "./balance-sheet-engine";
import type { CashFlowStatement } from "./cash-flow-engine";
import type { StatementOfChangesInEquity } from "./equity-engine";
import type { DisclosureNoteResult } from "@/server/disclosures/disclosure-engine";
import type { ReportingPackageType } from "@/server/disclosures/types";
import type { Narrative } from "@/server/copilot/narrative-engine";

export type PackageSections = {
  includeEquityStatement: boolean;
  includeAllDisclosures: boolean;
  includeTrialBalanceSummary: boolean;
  includeAuditSummary: boolean;
};

/** Pure rule table — no data, just "what does this pack contain." A
 * Management Pack stays lean (the 3 core statements + a management
 * narrative); a Board Pack adds the Statement of Changes in Equity; an
 * Accountant Pack adds the Trial Balance summary and every disclosure
 * note; an Auditor Pack adds the Audit Readiness/open-findings summary
 * on top of the Accountant Pack's full set. */
export function determinePackageSections(packageType: ReportingPackageType): PackageSections {
  switch (packageType) {
    case "ManagementPack":
      return { includeEquityStatement: false, includeAllDisclosures: false, includeTrialBalanceSummary: false, includeAuditSummary: false };
    case "BoardPack":
      return { includeEquityStatement: true, includeAllDisclosures: false, includeTrialBalanceSummary: false, includeAuditSummary: false };
    case "AccountantPack":
      return { includeEquityStatement: true, includeAllDisclosures: true, includeTrialBalanceSummary: true, includeAuditSummary: false };
    case "AuditorPack":
      return { includeEquityStatement: true, includeAllDisclosures: true, includeTrialBalanceSummary: true, includeAuditSummary: true };
  }
}

/** The subset of disclosure note types a lean (Management/Board) pack
 * shows — the real, data-driven notes only; the pure-placeholder notes
 * (Related Party/Commitments/Events After Reporting Date) are reserved
 * for the full Accountant/Auditor packs where completeness matters
 * most. */
const LEAN_NOTE_TYPES = ["FixedAssetNotes", "InventoryNotes", "VatNotes", "RevenueNotes", "ExpenseNotes"];

export type ReportingPackageContents = {
  packageType: ReportingPackageType;
  periodStart: string;
  periodEnd: string;
  financialYearLabel: string;
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  cashFlowStatement: CashFlowStatement;
  statementOfChangesInEquity: StatementOfChangesInEquity | null;
  disclosureNotes: DisclosureNoteResult[];
  narrative: Narrative | null;
  trialBalanceSummary: { totalDebit: number; totalCredit: number; accountCount: number } | null;
  auditSummary: { auditReadinessScore: number; openFindingsCount: number } | null;
};

export function buildReportingPackageContents(
  packageType: ReportingPackageType,
  periodStart: string,
  periodEnd: string,
  financialYearLabel: string,
  incomeStatement: IncomeStatement,
  balanceSheet: BalanceSheet,
  cashFlowStatement: CashFlowStatement,
  statementOfChangesInEquity: StatementOfChangesInEquity,
  allDisclosureNotes: DisclosureNoteResult[],
  narrative: Narrative | null,
  trialBalanceSummary: { totalDebit: number; totalCredit: number; accountCount: number },
  auditSummary: { auditReadinessScore: number; openFindingsCount: number },
): ReportingPackageContents {
  const sections = determinePackageSections(packageType);
  return {
    packageType,
    periodStart,
    periodEnd,
    financialYearLabel,
    incomeStatement,
    balanceSheet,
    cashFlowStatement,
    statementOfChangesInEquity: sections.includeEquityStatement ? statementOfChangesInEquity : null,
    disclosureNotes: sections.includeAllDisclosures ? allDisclosureNotes : allDisclosureNotes.filter((n) => LEAN_NOTE_TYPES.includes(n.noteType)),
    narrative,
    trialBalanceSummary: sections.includeTrialBalanceSummary ? trialBalanceSummary : null,
    auditSummary: sections.includeAuditSummary ? auditSummary : null,
  };
}

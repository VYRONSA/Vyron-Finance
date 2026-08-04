/**
 * Working Paper generation — pure functions, each producing a real,
 * traceable `content` structure from data the caller already fetched
 * (Trial Balance rows, GL transactions, Account Activity, Findings,
 * Risk Register). Nothing here recomputes a figure another engine
 * already owns: `buildAccountAnalysisPaper` wraps the existing
 * `AccountActivity` shape verbatim (from `account-activity-service.ts`),
 * `buildLeadSchedule` reuses the same `TrialBalanceRow[]` the Trial
 * Balance page itself renders.
 */

import type { AccountActivity, TrialBalanceRow } from "@/server/general-ledger/types";
import type { GlTransactionWithContext } from "@/server/general-ledger/types";
import type { AllocationStatus } from "@/server/accounting/types";
import type { AuditFinding, AuditRiskRegisterEntry } from "./types";

export type WorkingPaperResult = { title: string; content: Record<string, unknown> };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Lead Schedule — the Trial Balance grouped by account type with
 * subtotals, the standard audit cross-reference point into every
 * Supporting Schedule below it. */
export function buildLeadSchedule(rows: TrialBalanceRow[], asOfDate: string): WorkingPaperResult {
  const byType = new Map<string, TrialBalanceRow[]>();
  for (const row of rows) {
    byType.set(row.accountType, [...(byType.get(row.accountType) ?? []), row]);
  }
  const sections = [...byType.entries()].map(([accountType, typeRows]) => ({
    accountType,
    lines: typeRows.map((r) => ({ accountCode: r.accountCode, description: r.description, debitBalance: r.debitBalance, creditBalance: r.creditBalance })),
    subtotalDebit: round2(typeRows.reduce((s, r) => s + r.debitBalance, 0)),
    subtotalCredit: round2(typeRows.reduce((s, r) => s + r.creditBalance, 0)),
  }));
  return { title: `Lead Schedule — as of ${asOfDate}`, content: { asOfDate, sections } };
}

/** Supporting Schedule — every GL transaction behind one Lead Schedule
 * line, so a reviewer can trace subtotal -> line -> transaction. */
export function buildSupportingSchedule(accountCode: string, description: string, transactions: Pick<GlTransactionWithContext, "id" | "postingDate" | "reference" | "description" | "debit" | "credit" | "journalNumber">[]): WorkingPaperResult {
  const totalDebit = round2(transactions.reduce((s, t) => s + t.debit, 0));
  const totalCredit = round2(transactions.reduce((s, t) => s + t.credit, 0));
  return {
    title: `Supporting Schedule — ${accountCode} ${description}`,
    content: { accountCode, description, transactions, totalDebit, totalCredit, transactionCount: transactions.length },
  };
}

/** Reconciliation — bank allocation status summary, the same real
 * statuses (`Matched`/`Allocated`/`Suggested`/`Unallocated`) Supplier
 * Reconciliation and the Dashboard already use. */
export function buildReconciliationPaper(transactions: { allocationStatus: AllocationStatus; debit: number; credit: number }[], asOfDate: string): WorkingPaperResult {
  const byStatus: Record<AllocationStatus, { count: number; amount: number }> = {
    Matched: { count: 0, amount: 0 },
    Allocated: { count: 0, amount: 0 },
    Suggested: { count: 0, amount: 0 },
    Unallocated: { count: 0, amount: 0 },
  };
  for (const t of transactions) {
    byStatus[t.allocationStatus].count += 1;
    byStatus[t.allocationStatus].amount = round2(byStatus[t.allocationStatus].amount + t.debit + t.credit);
  }
  return { title: `Reconciliation — as of ${asOfDate}`, content: { asOfDate, byStatus, totalTransactions: transactions.length } };
}

/** Account Analysis — a thin wrapper around the existing
 * `AccountActivity` shape (opening/movements/closing/monthly trend) —
 * no recalculation, the same figures Account Activity's own page shows. */
export function buildAccountAnalysisPaper(activity: AccountActivity): WorkingPaperResult {
  return {
    title: `Account Analysis — ${activity.account.accountCode} ${activity.account.description}`,
    content: {
      accountCode: activity.account.accountCode,
      description: activity.account.description,
      dateFrom: activity.dateFrom,
      dateTo: activity.dateTo,
      openingBalance: activity.openingBalance,
      closingBalance: activity.closingBalance,
      totalDebit: activity.totalDebit,
      totalCredit: activity.totalCredit,
      monthlyTrend: activity.monthlyTrend,
    },
  };
}

/** Variance Report — Budget vs Actual, or period-over-period; the caller
 * supplies whichever comparison rows are relevant (reuses
 * `financial-statements-service.ts`/`budget-service.ts` data — no second
 * variance calculation). */
export function buildVarianceReportPaper(rows: { accountCode: string; description: string; expected: number; actual: number }[], label: string): WorkingPaperResult {
  const withVariance = rows.map((r) => {
    const variance = round2(r.actual - r.expected);
    const variancePercent = r.expected !== 0 ? round2((variance / Math.abs(r.expected)) * 100) : null;
    return { ...r, variance, variancePercent };
  });
  return { title: `Variance Report — ${label}`, content: { label, rows: withVariance } };
}

/** Risk Summary — the Risk Register cross-referenced against currently
 * open Findings for the same engagement, so planning-stage risks are
 * visibly connected to what fieldwork actually found. */
export function buildRiskSummaryPaper(risks: AuditRiskRegisterEntry[], findings: AuditFinding[]): WorkingPaperResult {
  const openFindings = findings.filter((f) => f.status === "Open");
  const bySeverity = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const f of openFindings) bySeverity[f.severity] += 1;
  return {
    title: "Risk Summary",
    content: {
      risks: risks.map((r) => ({ riskDescription: r.riskDescription, area: r.area, likelihood: r.likelihood, impact: r.impact, response: r.response })),
      openFindingsBySeverity: bySeverity,
      totalOpenFindings: openFindings.length,
    },
  };
}

/** Exception Report — every open Finding, grouped by category/type. */
export function buildExceptionReportPaper(findings: AuditFinding[]): WorkingPaperResult {
  const open = findings.filter((f) => f.status === "Open");
  const byType = new Map<string, number>();
  for (const f of open) byType.set(f.findingType, (byType.get(f.findingType) ?? 0) + 1);
  return {
    title: "Exception Report",
    content: {
      totalOpen: open.length,
      byType: Object.fromEntries(byType),
      findings: open.map((f) => ({ findingType: f.findingType, category: f.category, severity: f.severity, reason: f.reason, evidence: f.evidence, relatedType: f.relatedType, relatedId: f.relatedId })),
    },
  };
}

/** Sampling List — systematic sampling (a standard, real audit
 * technique: pick every Nth item from the population, starting at a
 * fixed offset) rather than pseudo-random selection, so the result is
 * deterministic and reproducible for a given population + sample size. */
export function buildSamplingListPaper(population: { id: number; label: string; amount: number }[], sampleSize: number): WorkingPaperResult {
  const size = Math.min(sampleSize, population.length);
  if (size <= 0 || population.length === 0) {
    return { title: "Sampling List", content: { populationSize: population.length, sampleSize: 0, method: "systematic", sample: [] } };
  }
  const interval = Math.max(1, Math.floor(population.length / size));
  const sample: { id: number; label: string; amount: number }[] = [];
  for (let i = 0; i < population.length && sample.length < size; i += interval) {
    sample.push(population[i]);
  }
  return {
    title: "Sampling List",
    content: { populationSize: population.length, sampleSize: sample.length, interval, method: "systematic", sample },
  };
}

export function buildAuditNotePaper(note: string, author: string, createdAt: string): WorkingPaperResult {
  return { title: "Audit Note", content: { note, author, createdAt } };
}

/**
 * Application Service for Working Papers — fetches real data through
 * existing services/repositories and hands it to the pure builders in
 * `working-paper-engine.ts`, then persists the result. One function per
 * paper type; every figure traces back to the same live data every
 * other workspace page already reads.
 */

import { getTrialBalance } from "@/server/services/trial-balance-service";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { getAccountActivity } from "@/server/services/account-activity-service";
import { listGlTransactionsInRange } from "@/server/repositories/gl-repository";
import { listTransactionsForExport } from "@/server/services/transaction-explorer-service";
import { getIncomeStatement } from "@/server/services/financial-statements-service";
import { listBudgets } from "@/server/services/budget-service";
import { listAuditRiskRegister } from "@/server/repositories/audit-planning-repository";
import { listAuditFindings } from "@/server/repositories/audit-finding-repository";
import * as paperRepo from "@/server/repositories/audit-working-paper-repository";
import {
  buildAccountAnalysisPaper,
  buildAuditNotePaper,
  buildExceptionReportPaper,
  buildLeadSchedule,
  buildReconciliationPaper,
  buildRiskSummaryPaper,
  buildSamplingListPaper,
  buildSupportingSchedule,
  buildVarianceReportPaper,
} from "@/server/audit/working-paper-engine";
import type { AuditWorkingPaper } from "@/server/audit/types";

export const listAuditWorkingPapers = paperRepo.listAuditWorkingPapers;

async function persist(companyId: string, engagementId: number | null, paperType: paperRepo.NewAuditWorkingPaper["paperType"], result: { title: string; content: Record<string, unknown> }, generatedBy: string): Promise<AuditWorkingPaper> {
  return paperRepo.createAuditWorkingPaper(companyId, { engagementId, paperType, title: result.title, content: result.content, generatedBy });
}

export async function generateLeadSchedule(companyId: string, engagementId: number | null, asOfDate: string, generatedBy: string): Promise<AuditWorkingPaper> {
  const trialBalance = await getTrialBalance(companyId, asOfDate);
  return persist(companyId, engagementId, "LeadSchedule", buildLeadSchedule(trialBalance.rows, asOfDate), generatedBy);
}

export async function generateSupportingSchedule(companyId: string, engagementId: number | null, accountId: number, dateFrom: string, dateTo: string, generatedBy: string): Promise<AuditWorkingPaper> {
  const [accounts, glResult] = await Promise.all([listChartOfAccounts(companyId), listGlTransactionsInRange(companyId, dateFrom, dateTo)]);
  const account = accounts.find((a) => a.id === accountId);
  const transactions = glResult.transactions.filter((t) => t.accountId === accountId);
  return persist(companyId, engagementId, "SupportingSchedule", buildSupportingSchedule(account?.accountCode ?? String(accountId), account?.description ?? "", transactions), generatedBy);
}

export async function generateReconciliation(companyId: string, engagementId: number | null, dateFrom: string, dateTo: string, generatedBy: string): Promise<AuditWorkingPaper> {
  const result = await listTransactionsForExport(companyId, {
    search: null, dateFrom, dateTo, minAmount: null, maxAmount: null, statuses: null, bankAccountId: null,
    importBatch: null, duplicateOnly: false, unknownSupplierOnly: false, sortBy: "transactionDate", sortDirection: "desc",
  });
  return persist(companyId, engagementId, "Reconciliation", buildReconciliationPaper(result.transactions, dateTo), generatedBy);
}

export async function generateAccountAnalysis(companyId: string, engagementId: number | null, accountId: number, dateFrom: string, dateTo: string, generatedBy: string): Promise<AuditWorkingPaper | null> {
  const activity = await getAccountActivity(companyId, accountId, dateFrom, dateTo);
  if (!activity) return null;
  return persist(companyId, engagementId, "AccountAnalysis", buildAccountAnalysisPaper(activity), generatedBy);
}

export async function generateVarianceReport(companyId: string, engagementId: number | null, financialYearLabel: string, periodStart: string, periodEnd: string, generatedBy: string): Promise<AuditWorkingPaper> {
  const [budgets, accounts, incomeStatement] = await Promise.all([listBudgets(companyId, financialYearLabel), listChartOfAccounts(companyId), getIncomeStatement(companyId, periodStart, periodEnd)]);
  const actualByAccountId = new Map([...incomeStatement.revenue.lines, ...incomeStatement.costOfSales.lines, ...incomeStatement.operatingExpenses.lines].map((l) => [l.accountId, l.amount]));
  const rows = budgets.map((b) => {
    const account = accounts.find((a) => a.id === b.accountId);
    return { accountCode: account?.accountCode ?? String(b.accountId), description: account?.description ?? "", expected: b.amount, actual: actualByAccountId.get(b.accountId) ?? 0 };
  });
  return persist(companyId, engagementId, "VarianceReport", buildVarianceReportPaper(rows, `${financialYearLabel} Budget vs Actual`), generatedBy);
}

export async function generateRiskSummary(companyId: string, engagementId: number, generatedBy: string): Promise<AuditWorkingPaper> {
  const [risks, findings] = await Promise.all([listAuditRiskRegister(companyId, engagementId), listAuditFindings(companyId, { engagementId })]);
  return persist(companyId, engagementId, "RiskSummary", buildRiskSummaryPaper(risks, findings), generatedBy);
}

export async function generateExceptionReport(companyId: string, engagementId: number | null, generatedBy: string): Promise<AuditWorkingPaper> {
  const findings = await listAuditFindings(companyId, engagementId ? { engagementId } : {});
  return persist(companyId, engagementId, "ExceptionReport", buildExceptionReportPaper(findings), generatedBy);
}

export async function generateSamplingList(companyId: string, engagementId: number | null, dateFrom: string, dateTo: string, sampleSize: number, generatedBy: string): Promise<AuditWorkingPaper> {
  const glResult = await listGlTransactionsInRange(companyId, dateFrom, dateTo);
  const population = glResult.transactions.map((t) => ({ id: t.id, label: `${t.journalNumber} — ${t.accountCode}`, amount: Math.max(t.debit, t.credit) }));
  return persist(companyId, engagementId, "SamplingList", buildSamplingListPaper(population, sampleSize), generatedBy);
}

export async function generateAuditNote(companyId: string, engagementId: number | null, note: string, generatedBy: string): Promise<AuditWorkingPaper> {
  return persist(companyId, engagementId, "AuditNote", buildAuditNotePaper(note, generatedBy, new Date().toISOString()), generatedBy);
}

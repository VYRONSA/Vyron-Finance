/**
 * Application Service for the AI Executive Copilot's Q&A — matches free
 * text to a supported question (`matchCopilotQuestion`), fetches the
 * real data that specific question needs from EXISTING services, and
 * hands it to the matching pure answer builder in
 * `copilot-assistant-engine.ts`. "This is a consumer of the existing
 * intelligence layer" — every fetch below calls a service another
 * module already built; nothing here re-derives a figure.
 */

import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { getTrialBalance } from "@/server/services/trial-balance-service";
import { getIncomeStatement, getBalanceSheet, getCashFlowStatement, dayBefore } from "@/server/services/financial-statements-service";
import { getCashflowForecast, getInventoryForecast } from "@/server/services/forecast-service";
import { getExecutiveIntelligence } from "@/server/services/executive-intelligence-service";
import { shiftPeriodBack } from "@/server/general-ledger/growth-analysis";
import { listGlTransactionsInRange } from "@/server/repositories/gl-repository";
import { listCustomers } from "@/server/services/customer-service";
import { getCustomerFinancialSummary } from "@/server/services/customer-financial-service";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listPurchaseBills } from "@/server/repositories/purchase-bill-repository";
import { listAuditFindings } from "@/server/services/audit-finding-service";
import { listAssetFindings } from "@/server/services/asset-intelligence-service";
import { getMatchingQueue } from "@/server/services/matching-queue-service";
import { getCompanyIntelligenceSummary } from "@/server/services/company-intelligence-service";
import { getCompany } from "@/server/services/company-service";
import { buildBusinessSituations } from "@/server/financial-intelligence/business-situation-engine";
import { buildEvidencePackage } from "@/server/ai/evidence-package";
import { askVyronAi, getDefaultAIProvider } from "@/server/ai/vyron-ai-engine";
import type { AIProvider, ConversationTurn } from "@/server/ai/types";
import {
  answerBankingWarnings,
  answerBiggestRisks,
  answerCashConcernWhy,
  answerCashFlowMovements,
  answerCashFlowPressure,
  answerCashStatus,
  answerCustomersPayingLate,
  answerDataQualityWarnings,
  answerDealWithFirst,
  answerGlIssues,
  answerHighestCreditRisk,
  answerInventoryIncrease,
  answerJournalsForBalance,
  answerMainRisks,
  answerMatchingReview,
  answerMissingData,
  answerNeedsAttention,
  answerNextActions,
  answerProfitDecrease,
  answerProfitabilityActions,
  answerProfitabilityStatus,
  answerRelatedWarnings,
  answerSituationsAttention,
  answerSupplierPaymentsAttention,
  answerSupplierRenegotiation,
  answerUnmatched,
  answerVatIssues,
  answerVyronAiUnavailable,
  answerWhatChanged,
  matchCopilotQuestion,
  toCopilotAnswerFromVyronAi,
  type CopilotAnswer,
  type CustomerRiskEntry,
  type RiskItem,
  type SupplierConcentrationEntry,
} from "@/server/copilot/copilot-assistant-engine";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Phase 15 — VYRON AI. `matchCopilotQuestion` already tries the fixed
 * deterministic catalog first (unchanged, see `dispatchDeterministicQuestion`
 * below); this only runs for genuinely open-ended free text that matches
 * none of it (brief, section 6: "hybrid architecture"). Builds the SAME
 * `EvidencePackage` shape for every question — `buildEvidencePackage`
 * itself decides what a caller may see, this function only supplies the
 * real, already-authorized inputs. Any failure (missing key, timeout,
 * malformed response, ...) degrades to `answerVyronAiUnavailable` rather
 * than throwing, so a VYRON AI outage never breaks the whole endpoint
 * (brief, section 7).
 */
async function askVyronAiOrFallback(companyId: string, freeText: string, periodEnd: string, conversation: ConversationTurn[], provider: AIProvider): Promise<CopilotAnswer> {
  try {
    const [company, summary] = await Promise.all([getCompany(companyId), getCompanyIntelligenceSummary(companyId, periodEnd)]);
    const situations = buildBusinessSituations(summary.findings);
    const evidence = buildEvidencePackage({ id: companyId, name: company?.name ?? "This company" }, freeText, periodEnd, summary, situations);
    const structured = await askVyronAi(provider, evidence, conversation);
    return toCopilotAnswerFromVyronAi(freeText, structured);
  } catch {
    return answerVyronAiUnavailable(freeText);
  }
}

export async function askCopilot(
  companyId: string,
  freeText: string,
  periodStart: string,
  periodEnd: string,
  financialYearStartDate: string,
  accountCode?: string,
  conversation: ConversationTurn[] = [],
  provider?: AIProvider,
): Promise<CopilotAnswer> {
  const questionId = matchCopilotQuestion(freeText);
  if (!questionId) {
    return askVyronAiOrFallback(companyId, freeText, periodEnd, conversation, provider ?? (await getDefaultAIProvider()));
  }

  const answer = await dispatchDeterministicQuestion(questionId, companyId, freeText, periodStart, periodEnd, financialYearStartDate, accountCode);
  return { ...answer, answeredBy: "VyronIntelligence" };
}

async function dispatchDeterministicQuestion(
  questionId: string,
  companyId: string,
  freeText: string,
  periodStart: string,
  periodEnd: string,
  financialYearStartDate: string,
  accountCode?: string,
): Promise<CopilotAnswer> {
  switch (questionId) {
    case "profit-decrease": {
      const previous = shiftPeriodBack(periodStart, periodEnd);
      const [current, prior] = await Promise.all([getIncomeStatement(companyId, periodStart, periodEnd), getIncomeStatement(companyId, previous.dateFrom, previous.dateTo)]);
      return answerProfitDecrease(current, prior);
    }
    case "cash-flow-movements": {
      const cashFlow = await getCashFlowStatement(companyId, periodStart, periodEnd);
      return answerCashFlowMovements(cashFlow);
    }
    case "customer-credit-risk": {
      const customers = await listCustomers(companyId);
      const summaries = await Promise.all(customers.map((c) => getCustomerFinancialSummary(companyId, c)));
      const entries: CustomerRiskEntry[] = customers.map((c, i) => ({
        customerId: c.id,
        customerName: c.name,
        outstandingBalance: summaries[i].outstandingBalance,
        overdueAmount: round2(summaries[i].aging.days30 + summaries[i].aging.days60 + summaries[i].aging.days90 + summaries[i].aging.days120Plus),
        averagePaymentDays: summaries[i].averagePaymentDays,
      }));
      return answerHighestCreditRisk(entries);
    }
    case "supplier-renegotiation": {
      const [suppliers, bills] = await Promise.all([listSuppliers(companyId), listPurchaseBills(companyId)]);
      const totalsBySupplier = new Map<number, number>();
      let grandTotal = 0;
      for (const bill of bills) {
        if (!bill.supplierId) continue;
        totalsBySupplier.set(bill.supplierId, (totalsBySupplier.get(bill.supplierId) ?? 0) + bill.total);
        grandTotal += bill.total;
      }
      const entries: SupplierConcentrationEntry[] = suppliers.map((s) => ({
        supplierId: s.id,
        supplierName: s.name,
        lifetimePurchases: round2(totalsBySupplier.get(s.id) ?? 0),
        sharePercent: grandTotal > 0 ? round2(((totalsBySupplier.get(s.id) ?? 0) / grandTotal) * 100) : 0,
      }));
      return answerSupplierRenegotiation(entries);
    }
    case "inventory-increase": {
      const accounts = await listChartOfAccounts(companyId);
      const inventoryAccount = accounts.find((a) => a.accountCode === "1500");
      const [currentBalance, priorBalance, forecast] = await Promise.all([
        getTrialBalance(companyId, periodEnd),
        getTrialBalance(companyId, dayBefore(periodStart)),
        getInventoryForecast(companyId, periodEnd),
      ]);
      const currentValue = inventoryAccount ? currentBalance.rows.find((r) => r.accountId === inventoryAccount.id)?.debitBalance ?? 0 : 0;
      const priorValue = inventoryAccount ? priorBalance.rows.find((r) => r.accountId === inventoryAccount.id)?.debitBalance ?? 0 : 0;
      return answerInventoryIncrease(currentValue, priorValue, forecast.confidence);
    }
    case "journals-for-balance": {
      if (!accountCode) return answerUnmatched(`${freeText} (an account code is required for this question)`);
      const result = await listGlTransactionsInRange(companyId, periodStart, periodEnd);
      const transactions = result.transactions.filter((t) => t.accountCode === accountCode);
      return answerJournalsForBalance(
        accountCode,
        transactions.map((t) => ({ id: t.id, postingDate: t.postingDate, description: t.description, debit: t.debit, credit: t.credit, journalId: t.journalId, journalNumber: t.journalNumber })),
      );
    }
    case "what-changed": {
      const previous = shiftPeriodBack(periodStart, periodEnd);
      const [currentIS, priorIS, currentBS, priorBS] = await Promise.all([
        getIncomeStatement(companyId, periodStart, periodEnd),
        getIncomeStatement(companyId, previous.dateFrom, previous.dateTo),
        getBalanceSheet(companyId, periodEnd, financialYearStartDate),
        getBalanceSheet(companyId, previous.dateTo, financialYearStartDate),
      ]);
      return answerWhatChanged(currentIS, priorIS, currentBS, priorBS);
    }
    case "biggest-risks": {
      const [executiveIntelligence, openAuditFindings, openAssetFindings] = await Promise.all([
        getExecutiveIntelligence(companyId, periodStart, periodEnd, financialYearStartDate),
        listAuditFindings(companyId, { status: "Open" }),
        listAssetFindings(companyId, { status: "Open" }),
      ]);
      const items: RiskItem[] = [
        ...executiveIntelligence.signals.map((s) => ({ label: s.message, confidence: s.confidence, source: s.source })),
        ...openAuditFindings.map((f) => ({ label: f.reason, confidence: f.confidence, source: "Audit" })),
        ...openAssetFindings.map((f) => ({ label: f.reason, confidence: f.confidence, source: "Assets" })),
      ];
      return answerBiggestRisks(items);
    }
    case "cash-flow-pressure": {
      const forecast = await getCashflowForecast(companyId, periodEnd);
      return answerCashFlowPressure(forecast);
    }
    case "profitability-actions": {
      const incomeStatement = await getIncomeStatement(companyId, periodStart, periodEnd);
      return answerProfitabilityActions(incomeStatement);
    }
    case "matching-review": {
      const queue = await getMatchingQueue(companyId);
      return answerMatchingReview(queue.items.map((item) => ({ itemType: item.itemType, description: item.description, confidence: item.confidence })));
    }
    // Phase 12 — VYRON Ask. `periodEnd` stands in for "as of today" here
    // (the same role it plays for "inventory-increase" above) — these
    // four questions don't use periodStart/financialYearStartDate at
    // all, since `getCompanyIntelligenceSummary` is current-state only.
    case "needs-attention": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerNeedsAttention(summary.findings);
    }
    case "banking-warnings": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerBankingWarnings(summary.findings);
    }
    case "next-actions": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerNextActions(summary.findings);
    }
    case "data-quality-warnings": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerDataQualityWarnings(summary.findings);
    }
    // Phase 13 — expanded Financial Intelligence questions. Same
    // "periodEnd as of today" role as the four cases above.
    case "cash-status": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerCashStatus(summary.findings, summary.totalCash ?? null);
    }
    case "customers-paying-late": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerCustomersPayingLate(summary.findings);
    }
    case "supplier-payments-attention": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerSupplierPaymentsAttention(summary.findings);
    }
    case "profitability-status": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerProfitabilityStatus(summary.findings, summary.netProfit ?? null);
    }
    case "gl-issues": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerGlIssues(summary.findings);
    }
    case "vat-issues": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerVatIssues(summary.findings);
    }
    case "missing-data": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerMissingData(summary.findings);
    }
    // Phase 14 — Business Situations. Same "periodEnd as of today" role
    // as every other Financial-Intelligence-aware case above;
    // `buildBusinessSituations` runs over the SAME `summary.findings`
    // these other cases already fetch — no second intelligence fetch.
    case "situations-attention": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerSituationsAttention(buildBusinessSituations(summary.findings));
    }
    case "related-warnings": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerRelatedWarnings(buildBusinessSituations(summary.findings));
    }
    case "cash-concern-why": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerCashConcernWhy(summary.findings, buildBusinessSituations(summary.findings), summary.totalCash ?? null);
    }
    case "main-risks": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerMainRisks(summary.findings, buildBusinessSituations(summary.findings));
    }
    case "deal-with-first": {
      const summary = await getCompanyIntelligenceSummary(companyId, periodEnd);
      return answerDealWithFirst(summary.findings, buildBusinessSituations(summary.findings));
    }
    default:
      return answerUnmatched(freeText);
  }
}

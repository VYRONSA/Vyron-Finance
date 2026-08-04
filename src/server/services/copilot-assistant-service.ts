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
import {
  answerBiggestRisks,
  answerCashFlowMovements,
  answerCashFlowPressure,
  answerHighestCreditRisk,
  answerInventoryIncrease,
  answerJournalsForBalance,
  answerMatchingReview,
  answerProfitDecrease,
  answerProfitabilityActions,
  answerSupplierRenegotiation,
  answerUnmatched,
  answerWhatChanged,
  matchCopilotQuestion,
  type CopilotAnswer,
  type CustomerRiskEntry,
  type RiskItem,
  type SupplierConcentrationEntry,
} from "@/server/copilot/copilot-assistant-engine";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function askCopilot(companyId: string, freeText: string, periodStart: string, periodEnd: string, financialYearStartDate: string, accountCode?: string): Promise<CopilotAnswer> {
  const questionId = matchCopilotQuestion(freeText);
  if (!questionId) return answerUnmatched(freeText);

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
      return answerMatchingReview(queue.map((item) => ({ itemType: item.itemType, description: item.description, confidence: item.confidence })));
    }
    default:
      return answerUnmatched(freeText);
  }
}

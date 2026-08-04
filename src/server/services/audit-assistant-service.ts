/**
 * Application Service for the AI Audit Assistant — matches free text to
 * a supported question (`matchAuditQuestion`), fetches the real data
 * that specific question needs, and hands it to the matching pure
 * answer builder. See `audit-assistant-engine.ts` for why this is a
 * fixed, evidence-backed catalog rather than a general NLP integration.
 */

import { listSalesInvoices } from "@/server/repositories/sales-invoice-repository";
import { listJournals } from "@/server/services/journal-workflow-service";
import { listGlTransactionsInRange } from "@/server/repositories/gl-repository";
import { listVatDocuments } from "@/server/services/vat-transaction-service";
import { aggregateMovementsByAccount, shiftPeriodBack } from "@/server/services/financial-intelligence-service";
import {
  answerAfterHoursJournals,
  answerBelowThreshold,
  answerDuplicateInvoices,
  answerMissingSupportingDocuments,
  answerModuleGap,
  answerUnmatched,
  answerUnusualRevenueGrowth,
  answerVerifyVatCalculations,
  matchAuditQuestion,
  MODULE_GAP_QUESTIONS,
  type AuditAnswer,
} from "@/server/audit/audit-assistant-engine";

export async function askAuditAssistant(companyId: string, freeText: string, periodStart: string, periodEnd: string, performanceMateriality: number): Promise<AuditAnswer> {
  const questionId = matchAuditQuestion(freeText);
  if (!questionId) return answerUnmatched(freeText);
  if (questionId in MODULE_GAP_QUESTIONS) return answerModuleGap(questionId, freeText);

  switch (questionId) {
    case "duplicate-invoices": {
      const invoices = await listSalesInvoices(companyId);
      return answerDuplicateInvoices(invoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, customerId: i.customerId, invoiceDate: i.invoiceDate, total: i.total })));
    }
    case "after-hours-journals": {
      const journals = (await listJournals(companyId)).filter((j) => j.journalDate >= periodStart && j.journalDate <= periodEnd);
      return answerAfterHoursJournals(journals);
    }
    case "unusual-revenue-growth": {
      const previousPeriod = shiftPeriodBack(periodStart, periodEnd);
      const [current, previous] = await Promise.all([listGlTransactionsInRange(companyId, periodStart, periodEnd), listGlTransactionsInRange(companyId, previousPeriod.dateFrom, previousPeriod.dateTo)]);
      return answerUnusualRevenueGrowth(aggregateMovementsByAccount(current.transactions), aggregateMovementsByAccount(previous.transactions));
    }
    case "verify-vat": {
      const documents = (await listVatDocuments(companyId)).filter((d) => d.date >= periodStart && d.date <= periodEnd);
      return answerVerifyVatCalculations(documents.map((d) => ({ id: d.id, documentType: d.documentType, vatType: d.vatType, grossAmount: d.grossAmount, net: round2(d.grossAmount - d.vatAmount), vat: d.vatAmount })));
    }
    case "missing-documents": {
      const journals = (await listJournals(companyId)).filter((j) => j.journalDate >= periodStart && j.journalDate <= periodEnd);
      return answerMissingSupportingDocuments(journals);
    }
    case "below-threshold": {
      const journals = (await listJournals(companyId)).filter((j) => j.journalDate >= periodStart && j.journalDate <= periodEnd);
      return answerBelowThreshold(journals.map((j) => ({ id: j.id, label: j.journalNumber, amount: Math.max(j.totalDebit, j.totalCredit) })), performanceMateriality);
    }
    default:
      return answerUnmatched(freeText);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

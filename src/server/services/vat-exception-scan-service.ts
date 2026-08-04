/**
 * Orchestrates VAT Intelligence + the VAT Rule Engine into real VAT
 * Exceptions — the manual "Run VAT Intelligence Now" trigger (same
 * "manual trigger alongside the real path" pattern as the Rule Engine's
 * own "Run Rule Engine Now" and the Scheduler's "Run Scheduler Now").
 * Business Event (a Sales Invoice / Supplier Bill) -> Rule Engine -> VAT
 * Engine -> ... -> Exception Centre: no separate VAT automation logic —
 * this only calls the real `vat-intelligence.ts`/`vat-rule-service.ts`
 * functions and persists what they find.
 */

import { listVatDocuments } from "@/server/services/vat-transaction-service";
import { listRateHistoryForCompany } from "@/server/repositories/vat-rate-history-repository";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { evaluateVatRules } from "@/server/services/vat-rule-service";
import { raiseVatExceptionIdempotent } from "@/server/repositories/vat-exception-repository";
import { resolveEffectiveRate } from "@/server/vat/vat-engine";
import { buildVatIntelligence, detectMissingVatNumber, type VatIntelligenceSignal } from "@/server/vat/vat-intelligence";
import type { VatExceptionType } from "@/server/vat/types";

const SIGNAL_TO_EXCEPTION_TYPE: Record<VatIntelligenceSignal["kind"], VatExceptionType> = {
  "missing-vat": "MissingVatNumber",
  "incorrect-vat-code": "IncorrectVatCode",
  "duplicate-vat-claim": "DuplicateVatClaim",
  "suspicious-vat-value": "UnexpectedVatPercentage",
  "high-risk": "VatRateConflict",
  "unusual-trend": "CrossPeriodVat",
  "vendor-anomaly": "IncorrectVatCode",
  "customer-anomaly": "IncorrectVatCode",
};

export type VatScanOutcome = {
  documentsScanned: number;
  exceptionsRaised: number;
  ruleMatches: number;
};

export async function runVatIntelligenceScan(companyId: string, performedBy = "System"): Promise<VatScanOutcome> {
  const [documents, treatments, historyByTreatment] = await Promise.all([
    listVatDocuments(companyId),
    listVatTreatments(companyId),
    listRateHistoryForCompany(companyId),
  ]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const effectiveRateByTreatment = new Map<string, number>();
  for (const treatment of treatments) {
    const history = historyByTreatment.get(treatment.id) ?? [];
    const rate = resolveEffectiveRate(history, todayIso);
    if (rate !== null) effectiveRateByTreatment.set(treatment.code, rate);
  }

  const intelligenceSignals = buildVatIntelligence(documents, effectiveRateByTreatment);
  const missingVatNumberSignals = detectMissingVatNumber(documents);

  let exceptionsRaised = 0;
  const documentById = new Map(documents.map((d) => [d.id, d]));

  for (const [documentId, signals] of intelligenceSignals) {
    const doc = documentById.get(documentId);
    if (!doc) continue;
    for (const signal of signals) {
      await raiseVatExceptionIdempotent(companyId, {
        exceptionType: SIGNAL_TO_EXCEPTION_TYPE[signal.kind],
        documentType: doc.documentType,
        documentId: doc.id,
        reason: signal.message,
        evidence: signal.reasoning,
        recommendedAction: signal.suggestedCorrection,
      });
      exceptionsRaised++;
    }
  }

  for (const [documentId, signal] of missingVatNumberSignals) {
    const doc = documentById.get(documentId);
    if (!doc) continue;
    await raiseVatExceptionIdempotent(companyId, {
      exceptionType: "MissingVatNumber",
      documentType: doc.documentType,
      documentId: doc.id,
      reason: signal.message,
      evidence: signal.reasoning,
      recommendedAction: signal.suggestedCorrection,
    });
    exceptionsRaised++;
  }

  const ruleResults = await evaluateVatRules(companyId, documents, performedBy);
  const ruleMatches = ruleResults.reduce((sum, r) => sum + r.matchedRuleIds.length, 0);

  return { documentsScanned: documents.length, exceptionsRaised, ruleMatches };
}

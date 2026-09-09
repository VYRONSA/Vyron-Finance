/**
 * VAT domain evaluator for the platform's ONE Rule Engine — closes the
 * "real schema, no live evaluator yet" gap the Automation Platform
 * (Module 7) disclosed for every non-Banking domain, for VAT
 * specifically, since VAT is this module's own focus. Reuses the exact
 * same `evaluateTransactionAgainstRules`/`ruleMatches` functions the
 * Banking pipeline calls — no second rule-matching implementation.
 * Business Event -> Rule Engine -> VAT Engine -> ... : a VAT document is
 * the Business Event here; a matched `flag_for_review` action raises a
 * real VAT Exception, never a silent skip.
 */

import { listActiveBankingRules } from "@/server/repositories/banking-rule-repository";
import { evaluateTransactionAgainstRules, type EvaluableRecord } from "@/server/banking-rules/rule-engine";
import { raiseVatExceptionIdempotent } from "@/server/repositories/vat-exception-repository";
import { recordAuditEntry } from "@/server/services/automation-audit-service";
import type { VatDocument } from "@/server/vat/vat-intelligence";
import type { VatExceptionType } from "@/server/vat/types";

const DEFAULT_FLAG_TYPE: VatExceptionType = "IncorrectVatCode";
const VALID_FLAG_TYPES: VatExceptionType[] = [
  "MissingVatNumber", "IncorrectVatCode", "UnexpectedVatPercentage",
  "LargeVatAdjustment", "DuplicateVatClaim", "VatRateConflict", "CrossPeriodVat",
];

function toEvaluable(doc: VatDocument): EvaluableRecord {
  return {
    vatCode: doc.vatTreatmentCode,
    amount: doc.grossAmount,
    documentType: doc.documentType,
  };
}

export type VatRuleEvaluationOutcome = { documentId: number; matchedRuleIds: number[]; flagged: boolean };

/** Runs every active VAT-domain rule against a set of VAT documents
 * (Sales Invoices, Supplier Bills, ...) — a `flag_for_review` action
 * raises a real, evidence-carrying VAT Exception rather than a silent
 * skip. Bank-transaction-specific rule-application logging
 * (`banking_rule_applications`, FK'd to `ae_bank_transactions`) doesn't
 * apply to non-bank-transaction documents, so VAT rule hits are recorded
 * into the shared Audit Trail instead (`rule_id` there has no such FK
 * restriction). */
export async function evaluateVatRules(companyId: string, documents: VatDocument[], performedBy = "System"): Promise<VatRuleEvaluationOutcome[]> {
  const rules = await listActiveBankingRules(companyId, "VAT");
  const results: VatRuleEvaluationOutcome[] = [];

  for (const doc of documents) {
    const { matchedRules, actions } = evaluateTransactionAgainstRules(toEvaluable(doc), rules);
    let flagged = false;

    for (const action of actions) {
      if (action.actionType !== "flag_for_review") continue;
      const exceptionType = VALID_FLAG_TYPES.includes(action.targetText as VatExceptionType) ? (action.targetText as VatExceptionType) : DEFAULT_FLAG_TYPE;
      await raiseVatExceptionIdempotent(companyId, {
        exceptionType,
        documentType: doc.documentType,
        documentId: doc.id,
        reason: `Flagged by VAT automation rule.`,
        evidence: `VAT code "${doc.vatTreatmentCode}" on a gross amount of ${doc.grossAmount.toFixed(2)}.`,
        recommendedAction: "Review this document's VAT coding before it is included in a VAT Return.",
      });
      flagged = true;
    }

    for (const rule of matchedRules) {
      await recordAuditEntry(companyId, {
        performedBy,
        actionType: "VatRuleApplied",
        ruleId: rule.id,
        reason: `Rule "${rule.name}" matched.`,
        documentType: doc.documentType,
        documentId: doc.id,
      });
    }

    results.push({ documentId: doc.id, matchedRuleIds: matchedRules.map((r) => r.id), flagged });
  }

  return results;
}

/**
 * Audit Intelligence — "Do not create a separate audit engine when
 * existing platform services can be extended." Every one of the 10
 * indicator types this composes is derived from an ALREADY-BUILT signal
 * source: `getExecutiveIntelligence` (Module 9's normalized Financial
 * Intelligence + scores), `buildVatIntelligence` (VAT module), and the
 * Audit Tests that just ran (this service reads back what
 * `audit-test-service.ts` persisted). Nothing here re-derives a figure
 * another module already owns.
 *
 * Related-Party Indicators are deliberately never raised: research
 * confirmed no related-party flag or data exists anywhere in Customer/
 * Supplier records, so fabricating a "finding" for a category with no
 * real data source would violate the platform's "never present
 * unsupported conclusions" rule. This is disclosed, not silently
 * skipped — see the Auditor Workspace UI and `docs/MIGRATION_ROADMAP.md`.
 */

import { getExecutiveIntelligence } from "@/server/services/executive-intelligence-service";
import { listVatDocuments } from "@/server/services/vat-transaction-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { listRateHistoryForCompany } from "@/server/repositories/vat-rate-history-repository";
import { resolveEffectiveRate } from "@/server/vat/vat-engine";
import { buildVatIntelligence, isHighRisk } from "@/server/vat/vat-intelligence";
import { listJournals } from "@/server/services/journal-workflow-service";
import { listAuditFindings, raiseFindingIdempotent } from "@/server/repositories/audit-finding-repository";
import { listAssetFindings } from "@/server/services/asset-intelligence-service";
import type { AuditFinding, AuditFindingType } from "@/server/audit/types";

const MANUAL_JOURNAL_CONTROL_WEAKNESS_THRESHOLD = 5;
const HIGH_RISK_USER_FINDING_THRESHOLD = 3;

type IntelligenceCandidate = {
  findingType: AuditFindingType;
  severity: AuditFinding["severity"];
  confidence: number;
  reason: string;
  evidence: string;
  suggestedProcedure: string;
  relatedType: string | null;
  relatedId: number | null;
};

export async function runAuditIntelligence(companyId: string, engagementId: number | null, periodStart: string, periodEnd: string, financialYearStartDate: string): Promise<{ findingsRaised: number }> {
  const [executiveIntelligence, vatTreatments, vatDocuments, allJournals, testFindings, openAssetFindings] = await Promise.all([
    getExecutiveIntelligence(companyId, periodStart, periodEnd, financialYearStartDate),
    listVatTreatments(companyId),
    listVatDocuments(companyId),
    listJournals(companyId),
    listAuditFindings(companyId, { category: "Test", status: "Open" }),
    listAssetFindings(companyId, { status: "Open" }),
  ]);

  const candidates: IntelligenceCandidate[] = [];

  // Unusual Trend / Material Misstatement / Revenue Manipulation —
  // reuse the SAME normalized Financial Intelligence signals Module 9
  // already computes, never a second growth/duplicate calculation.
  for (const signal of executiveIntelligence.signals) {
    if (signal.kind === "unusual-growth") {
      candidates.push({
        findingType: "UnusualTrend",
        severity: signal.confidence > 0.7 ? "High" : "Medium",
        confidence: signal.confidence,
        reason: signal.message,
        evidence: signal.reasoning,
        suggestedProcedure: "Corroborate against the Income Statement's own narrative for this account before concluding.",
        relatedType: null,
        relatedId: null,
      });
    }
    if (signal.kind === "possible-duplicate-journal" || signal.kind === "missing-posting") {
      candidates.push({
        findingType: "MaterialMisstatement",
        severity: signal.confidence > 0.7 ? "High" : "Medium",
        confidence: signal.confidence,
        reason: signal.message,
        evidence: signal.reasoning,
        suggestedProcedure: "Trace to source documentation and confirm the correct treatment before the financial statements are finalized.",
        relatedType: null,
        relatedId: null,
      });
    }
  }

  // Compliance Risk — reuse VAT Intelligence directly (the same engine
  // the VAT workspace's own Intelligence tab uses), never a parallel VAT
  // check.
  const effectiveRateByTreatment = new Map<string, number>();
  const rateHistoryByTreatment = await listRateHistoryForCompany(companyId);
  const todayIso = new Date().toISOString().slice(0, 10);
  for (const treatment of vatTreatments) {
    const history = rateHistoryByTreatment.get(treatment.id) ?? [];
    const rate = resolveEffectiveRate(history, todayIso);
    if (rate !== null) effectiveRateByTreatment.set(treatment.code, rate);
  }
  const vatDocumentsInPeriod = vatDocuments.filter((d) => d.date >= periodStart && d.date <= periodEnd);
  const vatSignalsByDocument = buildVatIntelligence(vatDocumentsInPeriod, effectiveRateByTreatment);
  for (const [documentId, signals] of vatSignalsByDocument) {
    if (!isHighRisk(signals)) continue;
    const top = signals[0];
    candidates.push({
      findingType: "ComplianceRisk",
      severity: "High",
      confidence: top.confidence,
      reason: `VAT document #${documentId} is high-risk: ${top.message}`,
      evidence: signals.map((s) => s.reasoning).join(" "),
      suggestedProcedure: top.suggestedCorrection || "Review this document's VAT treatment against SARS requirements.",
      relatedType: "vat_document",
      relatedId: documentId,
    });
  }

  // Control Weakness — a real aggregation over the Audit Tests that just
  // ran: a high volume of manual journals flagged for review is itself
  // a control observation, not a new detector.
  const manualJournalFindings = testFindings.filter((f) => f.findingType === "ManualJournalReview");
  if (manualJournalFindings.length >= MANUAL_JOURNAL_CONTROL_WEAKNESS_THRESHOLD) {
    candidates.push({
      findingType: "ControlWeakness",
      severity: "Medium",
      confidence: 0.6,
      reason: `${manualJournalFindings.length} material manual journals were posted this period — above the review threshold of ${MANUAL_JOURNAL_CONTROL_WEAKNESS_THRESHOLD}.`,
      evidence: "See the Manual Journal Review test findings for the individual entries.",
      suggestedProcedure: "Assess whether automated posting rules could reduce reliance on manual entry, and whether manual entries are adequately reviewed before posting.",
      relatedType: null,
      relatedId: null,
    });
  }

  // Fraud Indicator — a shared bank account across suppliers/customers
  // (already flagged by the Duplicate Suppliers/Customers tests) is a
  // real, established fraud vector, not a new heuristic.
  for (const f of testFindings.filter((f) => (f.findingType === "DuplicateSuppliers" || f.findingType === "DuplicateCustomers") && f.confidence >= 0.8)) {
    candidates.push({
      findingType: "FraudIndicator",
      severity: "High",
      confidence: f.confidence,
      reason: `Shared bank account / VAT number across distinct ${f.findingType === "DuplicateSuppliers" ? "suppliers" : "customers"}: ${f.reason}`,
      evidence: f.evidence,
      suggestedProcedure: "Investigate whether this represents a genuine control bypass (e.g. a fictitious supplier) before concluding it's a data-entry duplicate.",
      relatedType: f.relatedType,
      relatedId: f.relatedId,
    });
  }

  // High-Risk Journal — journals flagged by more than one Audit Test
  // (e.g. both Large Journal AND Weekend Posting) carry compounded risk.
  const journalFindingCounts = new Map<number, number>();
  for (const f of testFindings) {
    if (f.relatedType !== "journal" || f.relatedId === null) continue;
    journalFindingCounts.set(f.relatedId, (journalFindingCounts.get(f.relatedId) ?? 0) + 1);
  }
  for (const [journalId, count] of journalFindingCounts) {
    if (count < 2) continue;
    const journal = allJournals.find((j) => j.id === journalId);
    candidates.push({
      findingType: "HighRiskJournal",
      severity: "High",
      confidence: Math.min(0.9, 0.4 + count * 0.15),
      reason: `Journal ${journal?.journalNumber ?? `#${journalId}`} was flagged by ${count} separate Audit Tests.`,
      evidence: `See the Audit Tests tab, filtered to journal #${journalId}, for each individual flag.`,
      suggestedProcedure: "Prioritize this journal for detailed review — multiple independent tests flagging the same entry is a compounded risk signal.",
      relatedType: "journal",
      relatedId: journalId,
    });
  }

  // High-Risk User — a real aggregation over WHO submitted/approved the
  // journals behind open findings, not a new user-scoring model.
  const findingCountByUser = new Map<string, number>();
  for (const f of testFindings) {
    if (f.relatedType !== "journal" || f.relatedId === null) continue;
    const journal = allJournals.find((j) => j.id === f.relatedId);
    const user = journal?.submittedBy || journal?.approvedBy;
    if (!user) continue;
    findingCountByUser.set(user, (findingCountByUser.get(user) ?? 0) + 1);
  }
  for (const [user, count] of findingCountByUser) {
    if (count < HIGH_RISK_USER_FINDING_THRESHOLD) continue;
    candidates.push({
      findingType: "HighRiskUser",
      severity: "Medium",
      confidence: Math.min(0.85, 0.4 + count * 0.1),
      reason: `${user} submitted or approved ${count} journals behind open Audit Test findings.`,
      evidence: "See the Audit Tests tab for the individual journals.",
      suggestedProcedure: "Review this user's segregation of duties and consider a targeted sample of their other postings this period.",
      relatedType: "user",
      relatedId: null,
    });
  }

  // Going Concern Risk — reuse Module 9's own Financial Health Score and
  // Business Risk Score directly, never a second solvency calculation.
  if (executiveIntelligence.financialHealthScore < 50 || executiveIntelligence.businessRiskScore > 60) {
    candidates.push({
      findingType: "GoingConcernRisk",
      severity: executiveIntelligence.financialHealthScore < 30 ? "Critical" : "High",
      confidence: 0.6,
      reason: `Financial Health Score is ${executiveIntelligence.financialHealthScore}% and Business Risk Score is ${executiveIntelligence.businessRiskScore}% for this period.`,
      evidence: "See the Reports workspace's Executive scores for the underlying components (liquidity, profitability, cash trend).",
      suggestedProcedure: "Assess management's going concern basis and whether additional disclosure is required.",
      relatedType: null,
      relatedId: null,
    });
  }

  // Asset Risk — "Auditor Workspace consumes asset evidence." Composes
  // Module 11's own Asset Intelligence findings (never re-derived here)
  // into the ONE new `audit_findings.finding_type` value this module
  // added, `AssetRisk` — only high-confidence signals cross over, so the
  // Auditor Workspace surfaces what's audit-relevant without duplicating
  // the full Asset Findings list the Fixed Assets workspace already shows.
  for (const f of openAssetFindings.filter((f) => f.confidence >= 0.7)) {
    candidates.push({
      findingType: "AssetRisk",
      severity: f.confidence >= 0.85 ? "High" : "Medium",
      confidence: f.confidence,
      reason: `${f.findingType}: ${f.reason}`,
      evidence: f.evidence,
      suggestedProcedure: f.suggestedAction,
      relatedType: "fixed_asset",
      relatedId: f.assetId,
    });
  }

  let findingsRaised = 0;
  for (const candidate of candidates) {
    const { created } = await raiseFindingIdempotent(companyId, { ...candidate, engagementId, category: "Intelligence" });
    if (created) findingsRaised += 1;
  }
  return { findingsRaised };
}

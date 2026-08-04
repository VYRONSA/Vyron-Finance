/**
 * The AI Audit Assistant — pure, deterministic, evidence-backed answer
 * builders for a FIXED catalog of supported audit questions, matched
 * from free text by real keyword scoring — never a general-purpose LLM/
 * NLP integration, since this codebase has no AI engine to route
 * through and fabricating one would violate the platform's standing
 * "no unsupported conclusions" rule. Every answer states its Evidence,
 * Supporting Transactions, Calculations, Confidence, Source References,
 * and Alternative Interpretations where relevant — an unmatched or
 * currently-unbuildable question returns an honest "not answerable yet"
 * response (see `MODULE_GAP_ANSWER`) rather than a guess.
 *
 * Every builder here reuses an existing pure detector where one exists
 * (`findUnusualGrowth` from financial-intelligence-service.ts,
 * `isVatSplitConsistentWithType` from vat-engine.ts) — the two genuinely
 * new checks (duplicate invoices by customer+date+total, journals posted
 * outside office hours) have no prior detector to reuse, confirmed by
 * the same research pass that fed `audit-tests-engine.ts`.
 */

import { findUnusualGrowth, type AccountMovement } from "@/server/general-ledger/growth-analysis";
import { isVatSplitConsistentWithType } from "@/server/vat/vat-engine";
import type { VatType } from "@/server/vat/types";

export type AuditAnswer = {
  questionId: string;
  question: string;
  answer: string;
  evidence: string[];
  supportingTransactions: { id: number; label: string; amount: number | null }[];
  calculations: string;
  confidence: number;
  sourceReferences: string[];
  alternativeInterpretations: string[];
};

export type SupportedAuditQuestion = { id: string; label: string; keywords: string[] };

export const SUPPORTED_AUDIT_QUESTIONS: SupportedAuditQuestion[] = [
  { id: "duplicate-invoices", label: "Show all duplicate invoices", keywords: ["duplicate", "invoice"] },
  { id: "after-hours-journals", label: "Find journals posted outside office hours", keywords: ["outside", "office", "hours", "after-hours", "journals"] },
  { id: "unusual-revenue-growth", label: "Show unusual revenue growth", keywords: ["unusual", "revenue", "growth"] },
  { id: "payroll-comparison", label: "Compare payroll to prior year", keywords: ["payroll", "compare", "prior"] },
  { id: "related-party", label: "Identify related-party transactions", keywords: ["related", "party", "related-party"] },
  { id: "depreciation", label: "Recalculate depreciation", keywords: ["depreciation", "recalculate"] },
  { id: "verify-vat", label: "Verify VAT calculations", keywords: ["verify", "vat", "calculation"] },
  { id: "missing-documents", label: "Find missing supporting documents", keywords: ["missing", "supporting", "documents", "document"] },
  { id: "below-threshold", label: "Show transactions just below approval thresholds", keywords: ["below", "threshold", "approval"] },
];

/** Pure — real keyword-overlap scoring, no external NLP call. Returns
 * the best-matching supported question's id, or null if nothing scores
 * above the minimum overlap. */
export function matchAuditQuestion(freeText: string): string | null {
  const words = freeText.toLowerCase().split(/[^a-z-]+/).filter(Boolean);
  let best: { id: string; score: number } | null = null;
  for (const q of SUPPORTED_AUDIT_QUESTIONS) {
    const score = q.keywords.filter((k) => words.includes(k)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: q.id, score };
  }
  return best ? best.id : null;
}

function unavailableAnswer(questionId: string, question: string, reason: string): AuditAnswer {
  return {
    questionId,
    question,
    answer: `Not answerable yet: ${reason}`,
    evidence: [],
    supportingTransactions: [],
    calculations: "None — no underlying data source exists for this yet.",
    confidence: 0,
    sourceReferences: [],
    alternativeInterpretations: [],
  };
}

// ---------------------------------------------------------------------
// Real answer builders — one per supported question with a genuine data
// source today.
// ---------------------------------------------------------------------

export function answerDuplicateInvoices(invoices: { id: number; invoiceNumber: string; customerId: number; invoiceDate: string; total: number }[]): AuditAnswer {
  const groups = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const key = `${inv.customerId}|${inv.invoiceDate}|${inv.total}`;
    groups.set(key, [...(groups.get(key) ?? []), inv]);
  }
  const duplicateGroups = [...groups.values()].filter((g) => g.length > 1);
  const supportingTransactions = duplicateGroups.flatMap((g) => g.map((inv) => ({ id: inv.id, label: inv.invoiceNumber, amount: inv.total })));

  return {
    questionId: "duplicate-invoices",
    question: "Show all duplicate invoices",
    answer: duplicateGroups.length === 0 ? "No duplicate invoices found — no two invoices share the same customer, date, and total." : `${duplicateGroups.length} group(s) of invoices share the same customer, date, and total.`,
    evidence: duplicateGroups.map((g) => `${g.map((i) => i.invoiceNumber).join(" & ")} — same customer, ${g[0].invoiceDate}, R ${g[0].total.toFixed(2)}`),
    supportingTransactions,
    calculations: "Grouped every invoice by (customerId, invoiceDate, total); any group with more than one member is a duplicate candidate.",
    confidence: duplicateGroups.length > 0 ? 0.6 : 0.9,
    sourceReferences: ["Sales Invoices"],
    alternativeInterpretations: ["A same-day, same-total re-issue after a correction is a legitimate non-duplicate case — confirm each pair before concluding."],
  };
}

export function answerAfterHoursJournals(journals: { id: number; journalNumber: string; createdAt: string; totalDebit: number; totalCredit: number }[], startHour = 8, endHour = 17): AuditAnswer {
  const flagged = journals.filter((j) => {
    const hour = new Date(j.createdAt).getUTCHours();
    return hour < startHour || hour >= endHour;
  });
  return {
    questionId: "after-hours-journals",
    question: "Find journals posted outside office hours",
    answer: flagged.length === 0 ? `No journals were entered outside ${startHour}:00–${endHour}:00.` : `${flagged.length} journal(s) were entered outside ${startHour}:00–${endHour}:00.`,
    evidence: flagged.map((j) => `${j.journalNumber} entered at ${new Date(j.createdAt).toISOString()}`),
    supportingTransactions: flagged.map((j) => ({ id: j.id, label: j.journalNumber, amount: Math.max(j.totalDebit, j.totalCredit) })),
    calculations: `Checked each journal's createdAt UTC hour against the ${startHour}:00–${endHour}:00 window.`,
    confidence: 0.75,
    sourceReferences: ["Journals"],
    alternativeInterpretations: ["\"Office hours\" here uses UTC, not a configured company timezone — adjust the window if your company operates in a different zone."],
  };
}

export function answerUnusualRevenueGrowth(currentByAccount: Map<number, AccountMovement>, previousByAccount: Map<number, AccountMovement>, thresholdPercent = 30): AuditAnswer {
  const alerts = findUnusualGrowth(currentByAccount, previousByAccount, thresholdPercent);
  return {
    questionId: "unusual-revenue-growth",
    question: "Show unusual revenue growth",
    answer: alerts.length === 0 ? `No account moved by more than ${thresholdPercent}% period-over-period.` : `${alerts.length} account(s) moved by more than ${thresholdPercent}% period-over-period.`,
    evidence: alerts.map((a) => a.reasoning),
    supportingTransactions: alerts.map((a) => ({ id: a.accountId, label: `${a.accountCode} ${a.accountDescription}`, amount: a.currentMovement })),
    calculations: `Reused financial-intelligence-service.ts::findUnusualGrowth with a ${thresholdPercent}% threshold — no separate growth calculation.`,
    confidence: 0.65,
    sourceReferences: ["Financial Intelligence — Unusual Growth"],
    alternativeInterpretations: ["A large movement can be legitimate seasonal or one-off business activity, not necessarily a misstatement — corroborate against the Income Statement narrative."],
  };
}

export function answerVerifyVatCalculations(documents: { id: number; documentType: string; vatType: VatType | null; grossAmount: number; net: number; vat: number }[]): AuditAnswer {
  const inconsistent = documents.filter((d) => d.vatType !== null && !isVatSplitConsistentWithType(d.vatType, { gross: d.grossAmount, net: d.net, vat: d.vat }));
  return {
    questionId: "verify-vat",
    question: "Verify VAT calculations",
    answer: inconsistent.length === 0 ? "Every document's VAT split is internally consistent with its VAT type." : `${inconsistent.length} document(s) have a VAT split inconsistent with their VAT type.`,
    evidence: inconsistent.map((d) => `${d.documentType} #${d.id}: type ${d.vatType}, gross ${d.grossAmount.toFixed(2)}, VAT ${d.vat.toFixed(2)}`),
    supportingTransactions: inconsistent.map((d) => ({ id: d.id, label: `${d.documentType} #${d.id}`, amount: d.grossAmount })),
    calculations: "Reused vat-engine.ts::isVatSplitConsistentWithType — the same check VAT Intelligence's own \"incorrect VAT code\" detector uses.",
    confidence: 0.8,
    sourceReferences: ["VAT Engine", "VAT Intelligence"],
    alternativeInterpretations: [],
  };
}

export function answerMissingSupportingDocuments(journals: { id: number; journalNumber: string; sourceType: string; reference: string }[]): AuditAnswer {
  const flagged = journals.filter((j) => j.sourceType === "manual" && !j.reference.trim());
  return {
    questionId: "missing-documents",
    question: "Find missing supporting documents",
    answer: flagged.length === 0 ? "Every manual journal has a reference recorded." : `${flagged.length} manual journal(s) have no reference recorded.`,
    evidence: flagged.map((j) => `${j.journalNumber} — manual entry with an empty reference field`),
    supportingTransactions: flagged.map((j) => ({ id: j.id, label: j.journalNumber, amount: null })),
    calculations: "This platform has no document-attachment system yet, so \"missing supporting documents\" is interpreted as: a manual journal with no reference recorded — a real, disclosed proxy, not a document scan.",
    confidence: 0.5,
    sourceReferences: ["Journals"],
    alternativeInterpretations: ["A populated reference field doesn't guarantee a document actually exists off-platform — this only catches the case where even a reference was never captured."],
  };
}

export function answerBelowThreshold(transactions: { id: number; label: string; amount: number }[], threshold: number, bandPercent = 20): AuditAnswer {
  const lowerBound = threshold * (1 - bandPercent / 100);
  const flagged = transactions.filter((t) => t.amount >= lowerBound && t.amount < threshold);
  return {
    questionId: "below-threshold",
    question: "Show transactions just below approval thresholds",
    answer: flagged.length === 0 ? `No transactions fall within ${bandPercent}% below the ${threshold.toFixed(2)} threshold.` : `${flagged.length} transaction(s) fall within ${bandPercent}% below the ${threshold.toFixed(2)} threshold.`,
    evidence: flagged.map((t) => `${t.label}: ${t.amount.toFixed(2)} (${Math.round((t.amount / threshold) * 100)}% of threshold)`),
    supportingTransactions: flagged,
    calculations: `This platform has no configurable approval-threshold setting yet, so this uses the audit engagement's own Performance Materiality as the threshold, flagging amounts in [${lowerBound.toFixed(2)}, ${threshold.toFixed(2)}).`,
    confidence: 0.55,
    sourceReferences: ["Audit Engagement — Performance Materiality"],
    alternativeInterpretations: ["A real per-workflow approval limit (e.g. on Purchase Orders) doesn't exist in this platform today — this substitutes materiality, a related but different concept."],
  };
}

export const MODULE_GAP_QUESTIONS: Record<string, string> = {
  "payroll-comparison": "no Payroll module exists yet in this platform (a disclosed future roadmap item) — there is no payroll data to compare.",
  "related-party": "no related-party flag or data exists anywhere in Customer/Supplier records yet — this would need new master-data capture before it could be answered honestly.",
  depreciation: "no Fixed Assets & Depreciation module exists yet (a disclosed future roadmap item) — there is no asset register or depreciation schedule to recalculate.",
};

export function answerModuleGap(questionId: string, question: string): AuditAnswer {
  return unavailableAnswer(questionId, question, MODULE_GAP_QUESTIONS[questionId] ?? "this capability doesn't exist in the platform yet.");
}

export function answerUnmatched(freeText: string): AuditAnswer {
  return unavailableAnswer(
    "unmatched",
    freeText,
    `this doesn't match any of the ${SUPPORTED_AUDIT_QUESTIONS.length} supported audit questions today. This assistant answers from a fixed, evidence-backed catalog — not free-text natural language — to avoid presenting an unsupported conclusion.`,
  );
}

/**
 * The 18 Audit Tests — pure, deterministic, computed-from-data only
 * (same honest framing as every other Intelligence module in this
 * platform). Where a real detector already exists elsewhere, this file
 * REUSES it rather than reimplementing ("Do not create a separate audit
 * engine when existing platform services can be extended"):
 * `runDuplicatePaymentsTest` wraps `detectDuplicatePayments`
 * (banking-intelligence.ts), `runDuplicateJournalsTest` wraps
 * `findPossibleDuplicateJournals` (financial-intelligence-service.ts),
 * `runDuplicateVatClaimsTest` wraps `detectDuplicateVatClaims`
 * (vat-intelligence.ts). Every function returns the same normalized
 * `AuditTestFinding[]` shape regardless of what it wraps, so
 * `audit-test-service.ts` has one uniform way to persist results into
 * `audit_findings`.
 */

import { detectDuplicatePayments, type IntelligenceTransaction } from "@/server/banking-rules/banking-intelligence";
import { findPossibleDuplicateJournals } from "@/server/services/financial-intelligence-service";
import { detectDuplicateVatClaims, type VatDocument } from "@/server/vat/vat-intelligence";
import { findDuplicateParties as findDuplicatePartiesShared, type DuplicatableParty } from "@/server/matching/duplicate-party-engine";
import type { GlTransactionWithContext, TrialBalanceRow } from "@/server/general-ledger/types";
import type { Journal } from "@/server/accounting/types";
import type { AllocationStatus } from "@/server/accounting/types";
import type { AuditFindingSeverity, AuditFindingType } from "./types";

export type AuditTestFinding = {
  findingType: AuditFindingType;
  severity: AuditFindingSeverity;
  confidence: number;
  reason: string;
  evidence: string;
  suggestedProcedure: string;
  relatedType: string | null;
  relatedId: number | null;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------
// Reuse wrappers — no new detection logic.
// ---------------------------------------------------------------------

export function runDuplicatePaymentsTest(transactions: IntelligenceTransaction[]): AuditTestFinding[] {
  const signals = detectDuplicatePayments(transactions);
  return [...signals.entries()].map(([transactionId, signal]) => ({
    findingType: "DuplicatePayments",
    severity: "High",
    confidence: signal.confidence,
    reason: signal.message,
    evidence: signal.reasoning,
    suggestedProcedure: "Confirm both payments were genuinely separate before allocating either; request bank confirmation if in doubt.",
    relatedType: "bank_transaction",
    relatedId: transactionId,
  }));
}

export function runDuplicateJournalsTest(transactions: GlTransactionWithContext[]): AuditTestFinding[] {
  const duplicates = findPossibleDuplicateJournals(transactions);
  return duplicates.map((d) => ({
    findingType: "DuplicateJournals",
    severity: "Medium",
    confidence: Math.min(0.9, 0.4 + d.occurrences.length * 0.15),
    reason: `${d.occurrences.length} journals posted the same ${d.side.toLowerCase()} amount to ${d.accountCode} on ${d.postingDate}.`,
    evidence: d.reasoning,
    suggestedProcedure: "Trace each occurrence to its source document and confirm it wasn't posted twice.",
    relatedType: "gl_transaction",
    relatedId: d.occurrences[0]?.transactionId ?? null,
  }));
}

export function runDuplicateVatClaimsTest(documents: VatDocument[]): AuditTestFinding[] {
  const signals = detectDuplicateVatClaims(documents);
  return [...signals.entries()].map(([documentId, signal]) => ({
    findingType: "DuplicateVatClaims",
    severity: "High",
    confidence: signal.confidence,
    reason: signal.message,
    evidence: signal.reasoning,
    suggestedProcedure: "Confirm only one of the matching documents' VAT was actually claimed on the VAT Return.",
    relatedType: "vat_document",
    relatedId: documentId,
  }));
}

// ---------------------------------------------------------------------
// New tests — genuinely no existing detector to reuse (confirmed by
// research: no duplicate-supplier/customer master-data check, no
// sequence-gap/posting-date/Benford/suspense/negative-balance test
// anywhere in the codebase).
// ---------------------------------------------------------------------

/** Thin wrapper over the shared `duplicate-party-engine.ts` (extracted,
 * behavior-preserving — see that file's own docstring) — converts its
 * generic finding shape into this file's `AuditTestFinding` shape.
 * `runDuplicateCustomersTest`/`runDuplicateSuppliersTest` below are
 * verified behavior-identical via their own pre-existing pinned tests. */
function findDuplicateParties(parties: DuplicatableParty[], findingType: AuditFindingType, relatedType: string): AuditTestFinding[] {
  return findDuplicatePartiesShared(parties).map((f) => ({
    findingType,
    severity: f.confidence >= 0.8 ? "High" : "Medium",
    confidence: f.confidence,
    reason: f.reason,
    evidence: f.evidence,
    suggestedProcedure: f.suggestedProcedure,
    relatedType,
    relatedId: f.relatedId,
  }));
}

export function runDuplicateSuppliersTest(suppliers: { id: number; name: string; bankAccountNumber: string; vatNumber: string }[]): AuditTestFinding[] {
  return findDuplicateParties(
    suppliers.map((s) => ({ id: s.id, name: s.name, secondaryIds: [s.bankAccountNumber, s.vatNumber].filter(Boolean) })),
    "DuplicateSuppliers",
    "supplier",
  );
}

export function runDuplicateCustomersTest(customers: { id: number; name: string; vatNumber: string; registrationNumber: string }[]): AuditTestFinding[] {
  return findDuplicateParties(
    customers.map((c) => ({ id: c.id, name: c.name, secondaryIds: [c.vatNumber, c.registrationNumber].filter(Boolean) })),
    "DuplicateCustomers",
    "customer",
  );
}

/** Document numbering is count-based (`prefix + count.padStart(6,"0")`),
 * confirmed by research — a gap still means "a number was skipped or a
 * document was deleted/voided," a real and useful signal even though
 * it's not a strict max()+1 sequence. */
export function runSequenceGapsTest(documents: { id: number; number: string }[], entityLabel: string): AuditTestFinding[] {
  const parsed = documents
    .map((d) => ({ id: d.id, number: d.number, numeric: Number(d.number.match(/(\d+)$/)?.[1] ?? NaN) }))
    .filter((d) => Number.isFinite(d.numeric))
    .sort((a, b) => a.numeric - b.numeric);

  const findings: AuditTestFinding[] = [];
  for (let i = 1; i < parsed.length; i++) {
    const gap = parsed[i].numeric - parsed[i - 1].numeric;
    if (gap <= 1) continue;
    findings.push({
      findingType: "SequenceGaps",
      severity: gap > 5 ? "High" : "Medium",
      confidence: 0.7,
      reason: `${gap - 1} missing ${entityLabel} number(s) between ${parsed[i - 1].number} and ${parsed[i].number}.`,
      evidence: `Numbering is sequential per company; a gap this size means documents were deleted, voided, or numbered outside this system.`,
      suggestedProcedure: "Confirm every missing number corresponds to a genuinely voided/cancelled document, not a deleted real transaction.",
      relatedType: entityLabel,
      relatedId: parsed[i].id,
    });
  }
  return findings;
}

const BACKDATING_THRESHOLD_DAYS = 3;

/** Flags journals whose `createdAt` (when the row was actually entered)
 * is materially later than `journalDate` (the date it claims to be
 * posted on) — a real backdating signal, not a fabricated one. */
export function runPostingDateTest(journals: Pick<Journal, "id" | "journalNumber" | "journalDate" | "createdAt">[]): AuditTestFinding[] {
  const findings: AuditTestFinding[] = [];
  for (const j of journals) {
    const daysLate = Math.floor((Date.parse(j.createdAt) - Date.parse(`${j.journalDate}T00:00:00Z`)) / 86_400_000);
    if (daysLate < BACKDATING_THRESHOLD_DAYS) continue;
    findings.push({
      findingType: "PostingDateTests",
      severity: daysLate > 14 ? "High" : "Medium",
      confidence: Math.min(0.9, 0.4 + daysLate / 30),
      reason: `Journal ${j.journalNumber} was entered ${daysLate} day(s) after its posting date (${j.journalDate}).`,
      evidence: `Entered at ${j.createdAt}, dated ${j.journalDate}.`,
      suggestedProcedure: "Confirm the backdating was legitimate (e.g. a correction) and not used to manipulate a closed period's results.",
      relatedType: "journal",
      relatedId: j.id,
    });
  }
  return findings;
}

const CUTOFF_WINDOW_DAYS = 5;

/** Journals dated at or before `periodEndDate` but entered AFTER it — a
 * real cut-off risk: results for the closed period could still be
 * changing after the fact. */
export function runCutoffTest(journals: Pick<Journal, "id" | "journalNumber" | "journalDate" | "createdAt">[], periodEndDate: string): AuditTestFinding[] {
  const periodEndMs = Date.parse(`${periodEndDate}T23:59:59Z`);
  const findings: AuditTestFinding[] = [];
  for (const j of journals) {
    if (j.journalDate > periodEndDate) continue;
    const createdMs = Date.parse(j.createdAt);
    const daysAfter = Math.floor((createdMs - periodEndMs) / 86_400_000);
    if (daysAfter <= 0 || daysAfter > CUTOFF_WINDOW_DAYS) continue;
    findings.push({
      findingType: "CutoffTests",
      severity: "High",
      confidence: 0.75,
      reason: `Journal ${j.journalNumber} is dated ${j.journalDate} (in the period) but was entered ${daysAfter} day(s) after period end ${periodEndDate}.`,
      evidence: `Entered at ${j.createdAt}.`,
      suggestedProcedure: "Verify the transaction genuinely belongs to the closed period and wasn't backdated to avoid appearing in the next one.",
      relatedType: "journal",
      relatedId: j.id,
    });
  }
  return findings;
}

const BENFORD_EXPECTED: Record<number, number> = { 1: 30.1, 2: 17.6, 3: 12.5, 4: 9.7, 5: 7.9, 6: 6.7, 7: 5.8, 8: 5.1, 9: 4.6 };
const BENFORD_MIN_SAMPLE = 100;

/** Benford's Law first-digit test — a real statistical technique, with
 * an honestly disclosed reliability caveat: it's only meaningful with a
 * reasonably large, naturally-occurring sample (traditionally 100+
 * values spanning multiple orders of magnitude); below that this
 * returns a low-confidence result rather than a false alarm. */
export function runBenfordAnalysis(amounts: number[]): AuditTestFinding[] {
  const positive = amounts.filter((a) => a > 0);
  if (positive.length === 0) return [];

  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
  for (const a of positive) {
    const firstDigit = Number(String(Math.abs(a)).replace(/[^0-9]/g, "")[0]);
    if (firstDigit >= 1 && firstDigit <= 9) counts[firstDigit] += 1;
  }

  let totalDeviation = 0;
  const breakdown: string[] = [];
  for (let digit = 1; digit <= 9; digit++) {
    const actualPercent = round2((counts[digit] / positive.length) * 100);
    const deviation = Math.abs(actualPercent - BENFORD_EXPECTED[digit]);
    totalDeviation += deviation;
    breakdown.push(`${digit}: expected ${BENFORD_EXPECTED[digit]}%, actual ${actualPercent}%`);
  }
  const meanAbsoluteDeviation = round2(totalDeviation / 9);
  if (meanAbsoluteDeviation < 3) return []; // within normal Benford variance — nothing to flag

  const sampleAdequate = positive.length >= BENFORD_MIN_SAMPLE;
  return [
    {
      findingType: "BenfordAnalysis",
      severity: meanAbsoluteDeviation > 8 ? "High" : "Medium",
      confidence: sampleAdequate ? Math.min(0.85, 0.3 + meanAbsoluteDeviation / 20) : 0.3,
      reason: `First-digit distribution deviates from Benford's Law by an average of ${meanAbsoluteDeviation} percentage points across ${positive.length} value(s).`,
      evidence: breakdown.join("; ") + (sampleAdequate ? "" : " — sample size below the ~100-value threshold Benford's Law needs to be reliable; treat as a weak signal only."),
      suggestedProcedure: "Investigate whether amounts are being rounded, capped, or manually entered rather than arising naturally from transactions.",
      relatedType: null,
      relatedId: null,
    },
  ];
}

export function runLargeJournalsTest(journals: Pick<Journal, "id" | "journalNumber" | "totalDebit" | "totalCredit">[], threshold: number): AuditTestFinding[] {
  return journals
    .filter((j) => Math.max(j.totalDebit, j.totalCredit) > threshold)
    .map((j) => ({
      findingType: "LargeJournalTests",
      severity: Math.max(j.totalDebit, j.totalCredit) > threshold * 3 ? "High" : "Medium",
      confidence: 0.6,
      reason: `Journal ${j.journalNumber} totals ${money(Math.max(j.totalDebit, j.totalCredit))}, above the ${money(threshold)} threshold.`,
      evidence: `Debit ${money(j.totalDebit)}, Credit ${money(j.totalCredit)}.`,
      suggestedProcedure: "Trace to supporting documentation and confirm authorization.",
      relatedType: "journal",
      relatedId: j.id,
    }));
}

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dayOfWeekUtc(dateIso: string): number {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay(); // 0 = Sunday, 6 = Saturday
}

export function runWeekendPostingTest(journals: Pick<Journal, "id" | "journalNumber" | "journalDate">[]): AuditTestFinding[] {
  return journals
    .filter((j) => {
      const day = dayOfWeekUtc(j.journalDate);
      return day === 0 || day === 6;
    })
    .map((j) => ({
      findingType: "WeekendPosting",
      severity: "Low",
      confidence: 0.9,
      reason: `Journal ${j.journalNumber} was posted on ${j.journalDate}, a weekend.`,
      evidence: `Day of week: ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayOfWeekUtc(j.journalDate)]}.`,
      suggestedProcedure: "Confirm weekend postings are consistent with normal business operations (e.g. retail trading days) and not evidence of unauthorized access.",
      relatedType: "journal",
      relatedId: j.id,
    }));
}

/** Real, and currently always empty by default — no public holiday
 * calendar is configured anywhere in this codebase (same disclosed,
 * jurisdiction-specific gap already carried by
 * `recurrence.ts`'s `skip_public_holidays`). The moment a real calendar
 * source is wired in, this test becomes fully live with zero changes
 * here. */
export function runHolidayPostingTest(journals: Pick<Journal, "id" | "journalNumber" | "journalDate">[], holidayDates: string[]): AuditTestFinding[] {
  const holidays = new Set(holidayDates);
  return journals
    .filter((j) => holidays.has(j.journalDate))
    .map((j) => ({
      findingType: "HolidayPosting",
      severity: "Low",
      confidence: 0.9,
      reason: `Journal ${j.journalNumber} was posted on ${j.journalDate}, a public holiday.`,
      evidence: `${j.journalDate} is in the configured holiday calendar.`,
      suggestedProcedure: "Confirm holiday postings are consistent with normal business operations.",
      relatedType: "journal",
      relatedId: j.id,
    }));
}

/** Manual journals (`sourceType === "manual"`, confirmed the exact
 * value `journal-crud-service.ts` sets) above the materiality threshold —
 * every automatically-generated journal is excluded, since those
 * already trace to a Posting Rule and source document. */
export function runManualJournalReviewTest(journals: Pick<Journal, "id" | "journalNumber" | "sourceType" | "totalDebit" | "totalCredit">[], materialityThreshold: number): AuditTestFinding[] {
  return journals
    .filter((j) => j.sourceType === "manual" && Math.max(j.totalDebit, j.totalCredit) >= materialityThreshold)
    .map((j) => ({
      findingType: "ManualJournalReview",
      severity: "Medium",
      confidence: 0.65,
      reason: `Manual journal ${j.journalNumber} totals ${money(Math.max(j.totalDebit, j.totalCredit))}, at or above materiality.`,
      evidence: "Entered directly rather than generated by a Posting Rule from a source document.",
      suggestedProcedure: "Verify the business rationale and authorization for this manual entry.",
      relatedType: "journal",
      relatedId: j.id,
    }));
}

export function runSuspenseAccountReviewTest(transactions: Pick<GlTransactionWithContext, "id" | "accountCode" | "postingDate" | "debit" | "credit" | "description">[], suspenseAccountCode = "9999"): AuditTestFinding[] {
  return transactions
    .filter((t) => t.accountCode === suspenseAccountCode)
    .map((t) => ({
      findingType: "SuspenseAccountReview",
      severity: "Medium",
      confidence: 0.7,
      reason: `Posting to the Suspense account (${suspenseAccountCode}) on ${t.postingDate}: ${money(t.debit || t.credit)}.`,
      evidence: t.description || "No description recorded.",
      suggestedProcedure: "Every Suspense balance should be cleared before period-end — identify the correct account and reclassify.",
      relatedType: "gl_transaction",
      relatedId: t.id,
    }));
}

export function runNegativeInventoryTest(stockItems: { id: number; stockCode: string; description: string; quantityOnHand: number }[]): AuditTestFinding[] {
  return stockItems
    .filter((s) => s.quantityOnHand < 0)
    .map((s) => ({
      findingType: "NegativeInventory",
      severity: "High",
      confidence: 0.85,
      reason: `${s.stockCode} — ${s.description} shows a negative quantity on hand (${s.quantityOnHand}).`,
      evidence: "A stock item cannot physically go below zero — this indicates a missing Goods Received entry or a data/timing error.",
      suggestedProcedure: "Trace all Issue/Adjustment transactions for this item and confirm every receipt was captured.",
      relatedType: "stock_item",
      relatedId: s.id,
    }));
}

export function runNegativeCashTest(rows: TrialBalanceRow[], cashAccountIds: number[]): AuditTestFinding[] {
  const cashIds = new Set(cashAccountIds);
  return rows
    .filter((r) => cashIds.has(r.accountId) && r.creditBalance > 0)
    .map((r) => ({
      findingType: "NegativeCash",
      severity: "High",
      confidence: 0.85,
      reason: `${r.accountCode} — ${r.description} shows a negative cash balance (overdrawn by ${money(r.creditBalance)}).`,
      evidence: `Debit-normal Bank account net-credit balance of ${money(r.creditBalance)}.`,
      suggestedProcedure: "Confirm whether this is a genuine bank overdraft (with a facility) or a posting/timing error.",
      relatedType: "chart_of_account",
      relatedId: r.accountId,
    }));
}

const RECONCILING_ITEM_AGE_DAYS = 30;

export function runAgedReconcilingItemsTest(
  transactions: { id: number; transactionDate: string | null; allocationStatus: AllocationStatus; debit: number; credit: number; beneficiary: string }[],
  asOfDate: string,
): AuditTestFinding[] {
  const asOfMs = Date.parse(`${asOfDate}T00:00:00Z`);
  return transactions
    .filter((t) => t.allocationStatus === "Unallocated" && t.transactionDate !== null)
    .map((t) => ({ ...t, ageDays: Math.floor((asOfMs - Date.parse(`${t.transactionDate}T00:00:00Z`)) / 86_400_000) }))
    .filter((t) => t.ageDays >= RECONCILING_ITEM_AGE_DAYS)
    .map((t) => ({
      findingType: "AgedReconcilingItems" as AuditFindingType,
      severity: t.ageDays > 90 ? "High" : "Medium",
      confidence: 0.7,
      reason: `Unallocated bank transaction with ${t.beneficiary} dated ${t.transactionDate}, ${t.ageDays} day(s) old.`,
      evidence: `Amount: ${money(t.debit || t.credit)}. Still Unallocated as of ${asOfDate}.`,
      suggestedProcedure: "Investigate why this item has remained unreconciled and clear it or escalate.",
      relatedType: "bank_transaction",
      relatedId: t.id,
    }));
}

/** Data-integrity check: every `gl_transactions` row should reference a
 * real journal (enforced by FK at the database level) — this exists as
 * a defensive, real check over whatever data the caller supplies (e.g. a
 * snapshot/export), not an assumption the FK can never be bypassed. */
export function runOrphanTransactionsTest(transactions: Pick<GlTransactionWithContext, "id" | "journalId" | "accountCode" | "postingDate">[], validJournalIds: Set<number>): AuditTestFinding[] {
  return transactions
    .filter((t) => !validJournalIds.has(t.journalId))
    .map((t) => ({
      findingType: "OrphanTransactions",
      severity: "Critical",
      confidence: 0.95,
      reason: `GL transaction on ${t.accountCode} dated ${t.postingDate} references journal #${t.journalId}, which doesn't exist in the current journal set.`,
      evidence: "A posted GL transaction should always trace back to a real journal — this is a data-integrity issue, not a normal audit exception.",
      suggestedProcedure: "Escalate immediately — this may indicate a data migration issue or corruption.",
      relatedType: "gl_transaction",
      relatedId: t.id,
    }));
}

/**
 * Phase 28 — turns a company's own transaction history into compact,
 * structured evidence for one narration pattern (`narration-pattern.ts`).
 * This is the piece the forensic report found completely missing: the
 * AI classified 73 real production transactions to Bank Charges seeing
 * each one in total isolation, with no way to know "this company has
 * confirmed 18 similar transactions as Salaries & Wages and zero as
 * Bank Charges." `aggregatePatternEvidence` is a pure function (fully
 * unit-testable without touching Supabase); `buildCompanyHistoricalPatternEvidence`
 * is the only place that talks to the repository.
 *
 * Human-confirmed vs AI-only, deliberately distinguished per the
 * forensic report's own explicit requirement ("AI should NOT learn
 * blindly from its own previous mistakes — a previous AI allocation
 * must not become 'truth' simply because it exists"): a row counts as
 * human-confirmed when `isManualOverride === true` (covers manual
 * assign, Find & Recode, AND an accepted AI suggestion — Phase 28 Part
 * 10's Accept button writes through the exact same flag) OR when
 * `ruleId !== null` (a Banking Rule's own deterministic match — never
 * AI, never a guess). A row where `allocationMethod === 'Future AI'`
 * and neither of those is true is a mere unconfirmed AI suggestion or
 * automatic allocation — real information, but weak, never treated as
 * equivalent to a human decision.
 */

import { REPEATED_ALLOCATION_THRESHOLD } from "@/server/services/transaction-explorer-service";
import { listHistoricalAllocationsForPattern } from "@/server/repositories/transaction-explorer-repository";
import { derivePattern, amountBandBounds, type TransactionNarrationPattern } from "./narration-pattern";
import type { BankTransactionRecord } from "@/server/accounting/types";

/** Bounds the repository query — never an unbounded scan, per the
 * forensic report's explicit performance requirement. 200 is generous
 * for any single narration-pattern group at Northwood's current scale
 * (181 transactions total) while still being a real, defensive cap. */
const MAX_HISTORICAL_SAMPLE = 200;

export type EvidenceStrength = "Strong" | "Moderate" | "Weak" | "None";

export type GlAccountPatternEvidence = {
  accountCode: string;
  /** `is_manual_override === true` OR a real `rule_id` — see this
   * module's own docstring for exactly why these two, and only these
   * two, count as human-confirmed. */
  humanConfirmedCount: number;
  /** `allocationMethod === "Future AI"` and NOT human-confirmed — a
   * real signal, but never enough on its own for Strong evidence. */
  aiOnlyCount: number;
  totalCount: number;
};

export type CompanyHistoricalPatternEvidence = {
  pattern: TransactionNarrationPattern;
  /** How many historical rows this evidence was built from — 0 is a
   * real, valid, honest answer ("None" strength), never hidden. */
  sampleSize: number;
  /** Every GL account this pattern has ever resolved to for this
   * company, sorted by humanConfirmedCount desc then totalCount desc —
   * the FULL breakdown, not just the winner, so the evidence stays
   * explainable (Phase 28's own explicit requirement) rather than a
   * single opaque number. */
  accounts: GlAccountPatternEvidence[];
  strength: EvidenceStrength;
  /** The single account this pattern most strongly points to — `null`
   * when there's no evidence at all, OR when the top two accounts are
   * genuinely tied on human-confirmed count (see `isAmbiguous`): "do
   * not force allocation" on an ambiguous candidate set, per the
   * forensic report's own explicit example. */
  dominantAccountCode: string | null;
  isAmbiguous: boolean;
};

function emptyEvidence(pattern: TransactionNarrationPattern): CompanyHistoricalPatternEvidence {
  return { pattern, sampleSize: 0, accounts: [], strength: "None", dominantAccountCode: null, isAmbiguous: false };
}

/** The decision table shared by both ways of arriving at a sorted
 * `accounts` breakdown: aggregating raw rows (`aggregatePatternEvidence`)
 * and reconstructing from the already-aggregated, already-fetched
 * evidence the AI itself was shown (`evidenceFromAiPatterns`, used by
 * `classification-engine.ts` specifically to avoid a second, duplicate
 * database round trip for the exact same pattern — see that module's
 * own docstring). Exactly one rule set, never two that could drift. */
function deriveStrengthAndDominant(accounts: GlAccountPatternEvidence[]): { strength: EvidenceStrength; dominantAccountCode: string | null; isAmbiguous: boolean } {
  if (accounts.length === 0) return { strength: "None", dominantAccountCode: null, isAmbiguous: false };

  const top = accounts[0]!;
  const second = accounts[1] ?? null;
  const isAmbiguous = second !== null && top.humanConfirmedCount > 0 && top.humanConfirmedCount === second.humanConfirmedCount;

  let strength: EvidenceStrength;
  if (isAmbiguous) strength = "Moderate";
  else if (top.humanConfirmedCount >= REPEATED_ALLOCATION_THRESHOLD) strength = "Strong";
  else if (top.humanConfirmedCount >= 1) strength = "Moderate";
  else if (top.aiOnlyCount >= 1) strength = "Weak";
  else strength = "None";

  return { strength, dominantAccountCode: isAmbiguous ? null : top.accountCode, isAmbiguous };
}

export function aggregatePatternEvidence(
  pattern: TransactionNarrationPattern,
  rows: { suggestedGlAccount: string | null; ruleId: number | null; isManualOverride: boolean; allocationMethod: string | null }[],
): CompanyHistoricalPatternEvidence {
  if (rows.length === 0) return emptyEvidence(pattern);

  const byAccount = new Map<string, { human: number; aiOnly: number; total: number }>();
  for (const row of rows) {
    if (!row.suggestedGlAccount) continue;
    const isHumanConfirmed = row.isManualOverride === true || row.ruleId !== null;
    const isAiOnly = row.allocationMethod === "Future AI" && !isHumanConfirmed;
    const entry = byAccount.get(row.suggestedGlAccount) ?? { human: 0, aiOnly: 0, total: 0 };
    entry.total += 1;
    if (isHumanConfirmed) entry.human += 1;
    else if (isAiOnly) entry.aiOnly += 1;
    byAccount.set(row.suggestedGlAccount, entry);
  }

  const accounts: GlAccountPatternEvidence[] = [...byAccount.entries()]
    .map(([accountCode, v]) => ({ accountCode, humanConfirmedCount: v.human, aiOnlyCount: v.aiOnly, totalCount: v.total }))
    .sort((a, b) => b.humanConfirmedCount - a.humanConfirmedCount || b.totalCount - a.totalCount);

  if (accounts.length === 0) return emptyEvidence(pattern);

  const { strength, dominantAccountCode, isAmbiguous } = deriveStrengthAndDominant(accounts);
  return { pattern, sampleSize: rows.length, accounts, strength, dominantAccountCode, isAmbiguous };
}

/** Phase 28 — reconstructs a full `CompanyHistoricalPatternEvidence`
 * from the compact, already-aggregated shape the AI itself was shown
 * (`CompanyHistoricalPatternForAi`, built once by `evidence-builder.ts`
 * and threaded through the same classification call) — specifically so
 * `classification-engine.ts` can compute the accounting-confidence
 * assessment WITHOUT a second database query for evidence
 * `evidence-builder.ts` already fetched a moment earlier. Uses the
 * exact same `deriveStrengthAndDominant` decision rule as the raw-row
 * path, so a strength/dominant-account conclusion is never different
 * depending on which path computed it. */
export function evidenceFromAiPatterns(patterns: { narrationPrefix: string; amountRange: string; direction: "Debit" | "Credit"; accounts: { accountCode: string; humanConfirmedCount: number; aiOnlyCount: number }[] }[]): CompanyHistoricalPatternEvidence {
  if (patterns.length === 0) return emptyEvidence({ prefix: "Other", amountBand: "0-500", direction: "Debit" });

  const p = patterns[0]!;
  const pattern: TransactionNarrationPattern = { prefix: p.narrationPrefix, amountBand: p.amountRange, direction: p.direction };
  const accounts: GlAccountPatternEvidence[] = p.accounts
    .map((a) => ({ ...a, totalCount: a.humanConfirmedCount + a.aiOnlyCount }))
    .sort((a, b) => b.humanConfirmedCount - a.humanConfirmedCount || b.totalCount - a.totalCount);

  if (accounts.length === 0) return emptyEvidence(pattern);

  const sampleSize = accounts.reduce((sum, a) => sum + a.totalCount, 0);
  const { strength, dominantAccountCode, isAmbiguous } = deriveStrengthAndDominant(accounts);
  return { pattern, sampleSize, accounts, strength, dominantAccountCode, isAmbiguous };
}

/** The one place this module talks to the database — company-scoped,
 * bounded, read-only. Excludes the transaction being classified from
 * its own evidence (it can't be historical evidence for itself). */
export async function buildCompanyHistoricalPatternEvidence(
  companyId: string,
  transaction: Pick<BankTransactionRecord, "id" | "description" | "beneficiary" | "debit" | "credit">,
): Promise<CompanyHistoricalPatternEvidence> {
  const pattern = derivePattern(transaction);
  const bounds = amountBandBounds(pattern.amountBand);
  if (!bounds) return emptyEvidence(pattern);

  const rows = await listHistoricalAllocationsForPattern(
    companyId,
    pattern.prefix,
    pattern.direction,
    bounds.min,
    bounds.max,
    transaction.id,
    MAX_HISTORICAL_SAMPLE,
  );
  return aggregatePatternEvidence(pattern, rows);
}

/**
 * Phase 22A — assembles the ONE piece of evidence sent to the
 * classification model for one transaction. Mirrors
 * `../evidence-package.ts`'s discipline (fresh, server-side, strict
 * allow-list) but for this different domain. `companyId` scopes every
 * query here — see `listChartOfAccounts`/`listTransactionsByBeneficiary`
 * below, both already `company_id`-filtered repository functions, never
 * a new cross-tenant query.
 */

import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { listTransactionsByBeneficiary } from "@/server/repositories/transaction-explorer-repository";
import { isPayment, type BankTransactionRecord } from "@/server/accounting/types";
import type { AccountType } from "@/server/general-ledger/types";
import { buildCompanyHistoricalPatternEvidence, type CompanyHistoricalPatternEvidence } from "./company-historical-evidence";
import type { ClassificationCandidateAccount, CompanyHistoricalPatternForAi, SimilarPastClassification, TransactionClassificationEvidence } from "./types";

/** Phase 26I — the Phase 26H audit found this originally P&L-only
 * candidate set was the one real, code-confirmed gap in an otherwise
 * well-evidenced classification pipeline: a debit that's genuinely an
 * asset purchase, loan repayment, owner drawing, or statutory payable
 * (PAYE/UIF/SDL) had no honest candidate to be offered at all, leaving
 * the model only a poor-fitting Expense guess or `accountCode: null`.
 * Widened here to include Asset/Liability/Equity — covering the
 * platform's own seeded loan/owner/capital accounts (Loans Payable,
 * Director's Loan Account, Credit Card, Share Capital, Drawings,
 * PAYE/UIF/SDL Payable, Accrued Expenses, Prepayments, Petty Cash, fixed
 * assets) — while `NEVER_CANDIDATE_DESCRIPTIONS` below keeps the
 * platform's own structurally-special accounts (Bank, the VAT control
 * accounts, Debtors/Creditors, Retained Income, Suspense) permanently
 * excluded regardless of type. The hallucination defense in
 * `classification-engine.ts` (candidate-list membership check) needs no
 * change — it validates against whatever this function returns either
 * way. */
const PAYMENT_ACCOUNT_TYPES: AccountType[] = ["Expense", "Cost of Sales", "Other Expense", "Asset", "Liability", "Equity"];
const RECEIPT_ACCOUNT_TYPES: AccountType[] = ["Income", "Other Income", "Asset", "Liability", "Equity"];

/** Phase 26I — accounts that must never be offered to the AI as a
 * classification candidate even though their `accountType` now
 * qualifies under the widened sets above:
 *   - "Bank": the account representing the bank feed itself. A bank
 *     transaction is always the OTHER side of a "Bank" ledger entry,
 *     never a classification of the Bank account back onto itself —
 *     offering it as a candidate is structurally meaningless.
 *   - "VAT Input"/"VAT Output": maintained exclusively by the dedicated
 *     VAT engine (`src/server/vat/vat-engine.ts`,
 *     `vat-return-service.ts`) from real GL activity — never a manual
 *     or AI-suggested posting target.
 *   - "Retained Income"/"Suspense": system/period-close and
 *     error-fallback balances, never a real transaction classification.
 * Matched by `description`, the SAME convention `opening-balance-service.ts`
 * already relies on for its own Debtors/Creditors lookups
 * (`accounts.find(a => a.isControlAccount && a.description === "Debtors")`).
 * A known, honest limitation for a company that renamed one of these
 * accounts from its seeded default (migration 0007/0086) name — the
 * same class of simplification this module's own docstring already
 * accepted for Phase 22A's narrower P&L-only candidate set. */
const NEVER_CANDIDATE_DESCRIPTIONS = new Set(["Bank", "VAT Input", "VAT Output", "Retained Income", "Suspense"]);

/** How many prior same-beneficiary transactions to surface as history —
 * enough to show a real pattern without unboundedly growing the prompt
 * for a frequent merchant. */
const MAX_SIMILAR_PAST_CLASSIFICATIONS = 5;

async function candidateAccountsFor(companyId: string, transaction: BankTransactionRecord): Promise<ClassificationCandidateAccount[]> {
  const relevantTypes = isPayment(transaction) ? PAYMENT_ACCOUNT_TYPES : RECEIPT_ACCOUNT_TYPES;
  const accounts = await listChartOfAccounts(companyId);
  return accounts
    .filter((a) => a.isActive && relevantTypes.includes(a.accountType) && !a.isControlAccount && !NEVER_CANDIDATE_DESCRIPTIONS.has(a.description))
    .map((a) => ({ accountCode: a.accountCode, description: a.description, accountType: a.accountType }));
}

/** Phase 28 — the forensic report's own Part 9: "the current candidate
 * list is too flat... rank candidates using evidence." A pure,
 * deterministic re-sort (never a filter — the hallucination check in
 * `classification-engine.ts` still validates against the exact same
 * membership set either way, unaffected by order) putting accounts this
 * company has REAL history with first.
 *
 * Phase 28B — the dry run's own "Greenest Office" finding: ranking by
 * `humanConfirmedCount * 1000 + aiOnlyCount` let a purely AI-guessed
 * account (e.g. 8 prior unconfirmed AI guesses, 0 human confirmations)
 * outrank an untested candidate — a feedback loop where a wrong guess,
 * once stored, makes the model more likely to see and repeat the same
 * wrong guess next time ("VYRON learning its own mistakes"). Ranking
 * now scores by `humanConfirmedCount` ONLY — a Banking Rule match or a
 * human-confirmed allocation earns a real ranking advantage; AI-only
 * history earns none. Two candidates that differ only in AI-only count
 * (20 vs 0, 100 vs 1, or 0 vs 0) score identically and keep their
 * original relative order — `Array.prototype.sort` is stable in this
 * runtime (Node/V8, ES2019+). AI-only counts are NOT deleted or hidden:
 * they still flow through to `companyHistoricalPatterns` (via
 * `toAiPattern` below) and into `assessAccountingConfidence`, where they
 * remain visible as Weak evidence — this function only stops them from
 * buying a candidate a better position in the list. */
export function rankCandidateAccounts(
  candidates: ClassificationCandidateAccount[],
  evidence: CompanyHistoricalPatternEvidence,
): ClassificationCandidateAccount[] {
  if (evidence.accounts.length === 0) return candidates;
  const score = new Map(evidence.accounts.map((a) => [a.accountCode, a.humanConfirmedCount]));
  return [...candidates].sort((a, b) => (score.get(b.accountCode) ?? 0) - (score.get(a.accountCode) ?? 0));
}

function toAiPattern(evidence: CompanyHistoricalPatternEvidence): CompanyHistoricalPatternForAi[] {
  if (evidence.accounts.length === 0) return [];
  return [
    {
      narrationPrefix: evidence.pattern.prefix,
      amountRange: evidence.pattern.amountBand,
      direction: evidence.pattern.direction,
      accounts: evidence.accounts.map((a) => ({ accountCode: a.accountCode, humanConfirmedCount: a.humanConfirmedCount, aiOnlyCount: a.aiOnlyCount })),
    },
  ];
}

async function similarPastClassificationsFor(companyId: string, transaction: BankTransactionRecord): Promise<SimilarPastClassification[]> {
  if (!transaction.beneficiary) return [];
  const past = await listTransactionsByBeneficiary(companyId, transaction.beneficiary);
  return past
    .filter((t) => t.id !== transaction.id && Boolean(t.suggestedGlAccount))
    .slice(0, MAX_SIMILAR_PAST_CLASSIFICATIONS)
    .map((t) => ({ description: t.description, glAccount: t.suggestedGlAccount!, wasManuallyConfirmed: t.isManualOverride }));
}

export async function buildTransactionClassificationEvidence(companyId: string, transaction: BankTransactionRecord): Promise<TransactionClassificationEvidence> {
  const [rawCandidateAccounts, similarPastClassifications, historicalPatternEvidence] = await Promise.all([
    candidateAccountsFor(companyId, transaction),
    similarPastClassificationsFor(companyId, transaction),
    buildCompanyHistoricalPatternEvidence(companyId, transaction),
  ]);

  return {
    companyId,
    transactionId: transaction.id,
    description: transaction.description,
    beneficiary: transaction.beneficiary,
    reference: transaction.reference,
    amount: isPayment(transaction) ? transaction.debit : transaction.credit,
    direction: isPayment(transaction) ? "Debit" : "Credit",
    transactionDate: transaction.transactionDate,
    bankAccount: transaction.bankAccount,
    candidateAccounts: rankCandidateAccounts(rawCandidateAccounts, historicalPatternEvidence),
    similarPastClassifications,
    companyHistoricalPatterns: toAiPattern(historicalPatternEvidence),
  };
}

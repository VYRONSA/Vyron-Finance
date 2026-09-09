/**
 * Proactive Repeated-Correction Intelligence - Phase 25D. Pure,
 * deterministic, no AI, no persisted "learned" state.
 *
 * The counting RULE here is the exact one
 * transaction-explorer-service.ts::getRepeatedAllocationCount (and its
 * repository counterpart countBeneficiaryAllocations) already uses for
 * the inline "create a Banking Rule?" prompt: same company, same
 * beneficiary (raw exact-string match - the existing helper's own
 * .eq("beneficiary", beneficiary), deliberately NOT run through
 * normalizedBeneficiary, so this detector never disagrees with what the
 * inline prompt would show for the same transactions), same target GL
 * account, at REPEATED_ALLOCATION_THRESHOLD (imported, not re-declared)
 * or more occurrences.
 *
 * The EXECUTION SHAPE differs out of necessity, not choice:
 * countBeneficiaryAllocations issues one live COUNT query per
 * (beneficiary, target) pair - correct for a single just-allocated
 * transaction, but running it once per unique beneficiary+GL pair across
 * a whole company's history would be N live queries. This module instead
 * groups an already-fetched BankTransactionRecord[] in one O(n) pass -
 * same rule, bulk-safe shape, per the brief's own "if the existing helper
 * cannot efficiently support proactive scanning, make the smallest shared
 * extraction necessary."
 *
 * One deliberate, documented divergence: countBeneficiaryAllocations
 * counts ANY current match regardless of how it was made (manual, Banking
 * Rule, or AI Classification - confirmed by inspection, it filters only
 * on beneficiary + target). That's fine for its own purpose (advising
 * mid-allocation regardless of history's provenance), but meaningless as
 * proactive "evidence a NEW Banking Rule would help" - a pattern already
 * fully explained by an existing Rule or AI Classification is not
 * unaddressed manual effort. This module therefore restricts its
 * evidence to genuinely manual allocations only, using the three
 * pre-existing fields this codebase already uses to distinguish origin
 * (isManualOverride, ruleId, allocationMethod - there is no single
 * origin enum) - not a new eligibility concept, just the existing ones
 * combined correctly.
 */

import type { BankTransactionRecord } from "@/server/accounting/types";
import { REPEATED_ALLOCATION_THRESHOLD } from "@/server/services/transaction-explorer-service";

export type RepeatedCorrectionPattern = {
  beneficiary: string;
  glAccount: string;
  occurrenceCount: number;
  transactionIds: number[];
  latestDate: string | null;
};

function isGenuineManualAllocation(t: BankTransactionRecord): boolean {
  return t.isManualOverride === true && t.ruleId === null && t.allocationMethod !== "Future AI";
}

function groupKey(beneficiary: string, glAccount: string): string {
  return beneficiary + "|" + glAccount;
}

export function detectRepeatedCorrectionPatterns(transactions: BankTransactionRecord[]): RepeatedCorrectionPattern[] {
  const groups = new Map<string, BankTransactionRecord[]>();

  for (const t of transactions) {
    if (!isGenuineManualAllocation(t)) continue;
    if (!t.beneficiary || t.beneficiary.trim() === "") continue;
    if (!t.suggestedGlAccount) continue;

    const key = groupKey(t.beneficiary, t.suggestedGlAccount);
    const group = groups.get(key) ?? [];
    group.push(t);
    groups.set(key, group);
  }

  const patterns: RepeatedCorrectionPattern[] = [];
  for (const group of groups.values()) {
    if (group.length < REPEATED_ALLOCATION_THRESHOLD) continue;

    const datedDescending = [...group].sort((a, b) => (b.transactionDate ?? "").localeCompare(a.transactionDate ?? ""));
    patterns.push({
      beneficiary: group[0].beneficiary,
      glAccount: group[0].suggestedGlAccount as string,
      occurrenceCount: group.length,
      transactionIds: group.map((t) => t.id),
      latestDate: datedDescending[0].transactionDate,
    });
  }

  return patterns.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
}

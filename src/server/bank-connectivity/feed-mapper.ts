/**
 * Phase 16 — the final, provider-NEUTRAL hop from a normalised
 * `BankTransactionFeedItem` (any provider's mapper produces this same
 * shape) into VYRON's EXISTING ingestion shape, `ParsedBankTransaction`
 * (`src/server/import-centre/types.ts`). From here on, a synced
 * transaction is indistinguishable from a manually-imported one — this
 * is the seam the brief's flow diagram calls "NORMALISED BANK DATA ->
 * EXISTING VYRON BANK ACCOUNT". Deliberately provider-agnostic (does not
 * import anything from `providers/fnb/*`) so a second provider reuses
 * this unchanged.
 */

import type { ParsedBankTransaction } from "@/server/import-centre/types";
import type { BankTransactionFeedItem } from "./types";

/**
 * `bankAccount` is the raw account number text `ParsedBankTransaction`
 * expects (matching what a CSV/PDF parser would put there) — the caller
 * (`bank-sync-service.ts`) supplies it from the linked
 * `bank_connection_accounts` row, never re-derived here.
 *
 * `reference` carries the provider's own `providerTransactionId` (brief,
 * Part 7 #5: "preserve the bank's transaction ID/reference where
 * possible") — this is also exactly the field the EXISTING natural-key
 * dedup constraint already keys on, so no schema change was needed to
 * get robust, bank-issued-ID-based deduplication (FINDINGS.md §3).
 */
export function toParsedBankTransaction(item: BankTransactionFeedItem, bankAccountNumber: string, importBatch: string, sourceFilename: string, rowNumber: number): ParsedBankTransaction {
  return {
    transactionDate: item.date,
    reference: item.providerTransactionId,
    description: item.description || item.reference,
    beneficiary: item.reference,
    debit: item.direction === "debit" ? item.amount : 0,
    credit: item.direction === "credit" ? item.amount : 0,
    balance: item.balanceAfter,
    bankAccount: bankAccountNumber,
    vat: null,
    glAccount: "",
    notes: "",
    sourceFilename,
    importBatch,
    rowNumber,
  };
}

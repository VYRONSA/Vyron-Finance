/**
 * Phase 16, Part 7/8 — initial and recurring bank sync. This is the ONE
 * place a synced FNB transaction crosses into VYRON's EXISTING
 * ingestion pipeline:
 *
 *   FNB API -> FNB provider -> normalised feed item -> toParsedBankTransaction
 *   -> importRepo.ingestBankTransactionIdempotent (EXISTING dedup)
 *   -> applyRulesToTransactions (EXISTING Banking Rules + Exceptions)
 *   -> classifyUnallocatedTransactionsWithAi (EXISTING AI Classification,
 *      Phase 25E — same call, same position, same `.catch`-guard
 *      import-service.ts already uses for CSV/PDF imports)
 *
 * No second transaction-processing engine exists here — everything
 * after `ingestBankTransactionIdempotent` is the exact same code path
 * a manual CSV/PDF import already uses (FINDINGS.md §§2-6).
 */

import * as connectivityRepo from "@/server/repositories/bank-connectivity-repository";
import * as importRepo from "@/server/repositories/import-repository";
import { assignSourceOccurrences } from "@/server/import-centre/import-source-occurrence";
import { getBankAccount } from "@/server/repositories/bank-account-repository";
import { applyRulesToTransactions } from "@/server/services/rule-processing-service";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import { classifyUnallocatedTransactionsWithAi } from "@/server/services/transaction-classification-service";
import { getAuthorizedSession } from "./bank-connectivity-service";
import { toParsedBankTransaction } from "./feed-mapper";
import { createFnbProvider } from "./providers/fnb/fnb-provider";
import type { BankProvider } from "./bank-provider";
import type { BankConnection, BankConnectionAccount, BankProviderName, BankSyncRun } from "./types";

export class ValidationError extends Error {}

/** "an appropriate initial transaction history" (brief, Part 7 #3) —
 * FNB's own documentation doesn't specify a maximum queryable range
 * (FINDINGS.md §14 only confirms "a defined account and date range" is
 * accepted); 90 days is a deliberately conservative, clearly-documented
 * default rather than an assumed maximum, chosen so a first sync is
 * useful (enough history to seed Banking Rules/Matching) without
 * guessing at an unconfirmed upper bound. */
const INITIAL_SYNC_LOOKBACK_DAYS = 90;

function isoDaysBefore(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function getProvider(name: BankProviderName): BankProvider {
  if (name === "FNB") return createFnbProvider();
  throw new ValidationError(`Unsupported bank provider: ${name}`);
}

function syncBatchId(bankConnectionAccountId: number, nowIso: string): string {
  return `FNB-SYNC-${bankConnectionAccountId}-${nowIso.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

export type SyncOutcome = {
  run: BankSyncRun;
  transactionsFetched: number;
  transactionsImported: number;
  transactionsDuplicate: number;
};

/**
 * Runs exactly one sync (initial or incremental, decided by whether a
 * cursor already exists) for one linked account. Idempotent: syncing
 * the same date range twice imports zero net-new duplicates, because
 * every insert goes through the EXISTING
 * `ingestBankTransactionIdempotent` natural-key dedup (brief, Part 7
 * #10 / FINDINGS.md §3) — this function doesn't need its own dedup
 * logic. The cursor (`bank_connection_accounts.last_synced_through`) is
 * only ever advanced on a run that reaches `Success`/`PartialFailure`;
 * a wholly `Failed` run leaves it untouched (brief, Part 7 #10 / Part
 * 13's own required "failed sync does not move the cursor" test).
 */
export async function syncBankConnectionAccount(companyId: string, linkedAccount: BankConnectionAccount, connection: BankConnection, nowIso: string, performedBy = "System"): Promise<SyncOutcome> {
  const todayIso = nowIso.slice(0, 10);
  const isInitial = linkedAccount.lastSyncedThrough === null;
  // Incremental syncs re-request FROM the last cursor date (inclusive,
  // not cursor+1) rather than a tight day-after-day window — any
  // overlap this creates is free, since the natural-key dedup below
  // already makes re-fetching an already-imported day a no-op. This is
  // deliberately simpler and safer than trying to track a sub-day
  // cursor FNB's documented API doesn't support anyway (FINDINGS.md
  // §14: "a defined account and date range", not a finer-grained
  // cursor/delta token).
  const rangeStart = isInitial ? isoDaysBefore(todayIso, INITIAL_SYNC_LOOKBACK_DAYS) : linkedAccount.lastSyncedThrough!;
  const rangeEnd = todayIso;

  const run = await connectivityRepo.startBankSyncRun(companyId, linkedAccount.id, isInitial ? "Initial" : "Incremental", rangeStart, rangeEnd);

  // Phase 25K — hoisted out of the `try` so a mid-batch failure's `catch`
  // block below can report what actually landed instead of fabricating
  // zeros regardless of real progress (a misleading audit trail that
  // made a "just to be safe" manual re-import look safer than it is).
  let feedItemCount = 0;
  let imported = 0;
  let duplicate = 0;

  try {
    const providerImpl = getProvider(connection.provider);
    if (!providerImpl.capabilities.supportsTransactionHistory) {
      throw new ValidationError(`${connection.provider} does not support transaction history retrieval.`);
    }
    const session = await getAuthorizedSession(companyId, connection, nowIso);
    const feedItems = await providerImpl.getTransactions(session, { providerAccountId: linkedAccount.providerAccountId, rangeStart, rangeEnd });
    feedItemCount = feedItems.length;

    // Phase 25K — the natural-key dedup manual/email import and FNB sync
    // both rely on (`ingestBankTransactionIdempotent`'s unique key
    // includes `bank_account`) only works if both channels write the SAME
    // text into that column. Manual/email import writes the raw account
    // number read off the statement; this used to write FNB's MASKED
    // account number instead. Since `linkedAccount.bankAccountId` can
    // point at a pre-existing `ae_bank_accounts` row a manual import
    // already fed, resolving the canonical raw number here (the same one
    // manual import resolved/created it with) keeps both channels on the
    // same natural key, so an overlapping date range dedups correctly
    // instead of double-importing and double-posting to the GL.
    const bankAccount = await getBankAccount(companyId, linkedAccount.bankAccountId);
    const naturalKeyAccountNumber = bankAccount?.accountNumber || linkedAccount.maskedAccountNumber;

    const batchId = syncBatchId(linkedAccount.id, nowIso);
    const sourceFilename = `${connection.provider} Direct Feed`;
    const createdTransactionIds: number[] = [];
    let mostRecentTransactionIso: string | null = null;

    // Migration 0092 — the same ordinal-within-source rule every other
    // ingestion path uses, applied to one feed page. A bank that really
    // does report two identical debits in a day is reporting two real
    // transactions and both must land; re-polling an overlapping date
    // range returns the same page in the same order, reproduces the same
    // ordinals, and still dedups exactly as before.
    const feedRows = assignSourceOccurrences(
      feedItems.map((item, i) => {
        const parsed = toParsedBankTransaction(item, naturalKeyAccountNumber, batchId, sourceFilename, i + 1);
        return {
          parsed,
          bankAccount: parsed.bankAccount,
          transactionDate: parsed.transactionDate,
          reference: parsed.reference,
          description: parsed.description,
          debit: parsed.debit,
          credit: parsed.credit,
        };
      }),
    );

    for (const feedRow of feedRows) {
      const parsed = feedRow.parsed;
      const { transaction, created } = await importRepo.ingestBankTransactionIdempotent(companyId, {
        transactionDate: parsed.transactionDate!,
        reference: parsed.reference,
        description: parsed.description,
        beneficiary: parsed.beneficiary,
        debit: parsed.debit,
        credit: parsed.credit,
        balance: parsed.balance,
        bankAccount: parsed.bankAccount,
        bankAccountId: linkedAccount.bankAccountId,
        vat: parsed.vat,
        glAccount: parsed.glAccount,
        notes: parsed.notes,
        importBatch: batchId,
        sourceFilename,
        sourceOccurrence: feedRow.sourceOccurrence,
      });
      if (created) {
        imported++;
        createdTransactionIds.push(transaction.id);
      } else {
        duplicate++;
      }
      if (!mostRecentTransactionIso || parsed.transactionDate! > mostRecentTransactionIso) mostRecentTransactionIso = parsed.transactionDate;
    }

    if (createdTransactionIds.length > 0) {
      await applyRulesToTransactions(companyId, createdTransactionIds, performedBy);
      // Phase 25I — this used to be unguarded, sitting between two steps
      // that had already genuinely succeeded (ingest, Rules) and one
      // still to come (AI classification below). A transient usage-
      // metering failure here would throw out to the outer `catch`,
      // which (a) marks this whole run "Failed" even though the import
      // and Rules application both actually succeeded, (b) skips AI
      // classification for this batch entirely, and (c) since the
      // natural-key dedup makes a retry of this exact batch report
      // every transaction as `created: false`, this specific batch would
      // never get another chance at usage recording or AI classification
      // — a billing undercount is far preferable to that. Same defensive
      // discipline as the AI classification call immediately below.
      await recordUsageEvent(companyId, "bank_imports").catch(() => {});

      // Phase 25E — AI Transaction Classification, extended to the live
      // bank-feed path. Identical call, identical placement (immediately
      // after Banking Rules, on the same newly-created transaction ids),
      // identical defensive `.catch` guard to `import-service.ts`'s own
      // Phase 22A call site — `classifyUnallocatedTransactionsWithAi`
      // itself already only ever touches transactions Rules/Matching left
      // completely untouched (`isEligibleForAiClassification`), already
      // never throws, and a bank sync completing must never depend on an
      // AI provider being reachable, exactly like an import.
      await classifyUnallocatedTransactionsWithAi(companyId, createdTransactionIds, performedBy).catch(() => {});
    }

    await connectivityRepo.finishBankSyncRun(companyId, run.id, { status: "Success", transactionsFetched: feedItems.length, transactionsImported: imported, transactionsDuplicate: duplicate, errorMessage: null }, nowIso);
    // Cursor only advances here, on the success path.
    await connectivityRepo.recordSuccessfulSyncCursor(companyId, linkedAccount.id, rangeEnd, "Success", nowIso, mostRecentTransactionIso ? `${mostRecentTransactionIso}T00:00:00.000Z` : null);

    return { run: { ...run, status: "Success", transactionsFetched: feedItems.length, transactionsImported: imported, transactionsDuplicate: duplicate, finishedAt: nowIso }, transactionsFetched: feedItems.length, transactionsImported: imported, transactionsDuplicate: duplicate };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error.";
    // Phase 25K — report whatever actually landed before the failure
    // (e.g. a mid-batch provider timeout after several rows were already
    // ingested) instead of fabricated zeros; a misleading "nothing
    // happened" audit trail was itself indirectly encouraging "just to be
    // safe" manual re-imports into an already-partially-synced range.
    await connectivityRepo.finishBankSyncRun(companyId, run.id, { status: "Failed", transactionsFetched: feedItemCount, transactionsImported: imported, transactionsDuplicate: duplicate, errorMessage: message }, nowIso);
    // Deliberately NOT calling recordSuccessfulSyncCursor — a failed
    // sync must never move the cursor (brief, Part 7 #10).
    await connectivityRepo.recordFailedSync(companyId, linkedAccount.id, nowIso);
    throw error;
  }
}

export type CompanySyncSummary = { attempted: number; succeeded: number; failed: number };

/**
 * The Scheduler's own entry point (brief, Part 8's pseudocode) — "for
 * each active bank connection: refresh authorisation if required
 * (handled inside `getAuthorizedSession`), determine last successful
 * sync (the cursor), request new transactions, pass through existing
 * ingestion, update cursor, record result." One connection/account
 * failing never stops the others — partial failure across a company's
 * several linked accounts is recorded per-account, not as one
 * all-or-nothing batch.
 */
export async function syncAllConnectedAccounts(companyId: string, nowIso: string, performedBy = "System"): Promise<CompanySyncSummary> {
  const connections = await connectivityRepo.listConnectedBankConnections(companyId);
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const connection of connections) {
    const linkedAccounts = await connectivityRepo.listBankConnectionAccounts(companyId, connection.id);
    for (const linkedAccount of linkedAccounts.filter((a) => a.status === "Active")) {
      attempted++;
      try {
        await syncBankConnectionAccount(companyId, linkedAccount, connection, nowIso, performedBy);
        succeeded++;
      } catch {
        // Already recorded on the bank_sync_runs row/bank_connection_accounts
        // by syncBankConnectionAccount itself — this loop only needs to
        // keep going for the remaining accounts/connections.
        failed++;
      }
    }
  }

  return { attempted, succeeded, failed };
}

/**
 * Application Service for the Cashbook — "a visible, auditable Cashbook
 * workflow with receipts, payments, reconciliation, and enquiry,"
 * treated as a first-class workspace per the Product Review Board's own
 * Workflow Completion Audit. Manual capture writes into the SAME
 * `ae_bank_transactions` table Import Centre already populates (One
 * Business Object) — Receipts Cashbook/Payments Cashbook/Enquiry are all
 * real views over that one table, not a parallel ledger.
 *
 * Posts through the ONE Posting Engine, same as every other module —
 * `Cashbook Receipt`/`Cashbook Payment`/`Bank Transfer` are real,
 * data-driven posting rules (see 0022_cashbook_reconciliation.sql), not
 * a bespoke journal-building path.
 */

import * as repo from "@/server/repositories/cashbook-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { resolveBankGlAccount } from "@/server/services/journal-service";
import { buildJournalFromEvent } from "@/server/services/posting-rule-service";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import { assertNotMonthEndLocked } from "@/server/services/bank-reconciliation-service";
import { isLiveRuleEngineJournal, type BankTransactionRecord } from "@/server/accounting/types";
import type { CashbookBatch, CashbookBatchType } from "@/server/banking/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const listCashbookTransactions = repo.listCashbookTransactions;
export const CASHBOOK_TRANSACTIONS_LIST_CAP = repo.LIST_CAP;
export const listCashbookBatches = repo.listCashbookBatches;
export const listBatchTransactions = repo.listBatchTransactions;

async function requireTransaction(companyId: string, transactionId: number): Promise<BankTransactionRecord> {
  const transaction = await repo.getCashbookTransaction(companyId, transactionId);
  if (!transaction) throw new NotFoundError(`No transaction with id ${transactionId}.`);
  return transaction;
}

/** The bank-side GL code for this Cashbook entry — reuses
 * `journal-service.ts::resolveBankGlAccount` exactly, but (unlike
 * Transaction Explorer's looser fallback) requires the resolved code to
 * be a REAL Chart of Accounts entry before capture is allowed to post,
 * so a Cashbook entry never silently fails deep inside the Posting
 * Engine with a cryptic "no Chart of Accounts entry" error. */
async function requireBankGlAccount(companyId: string, bankAccountId: number): Promise<{ code: string; accountNumber: string }> {
  const bankAccount = await bankAccountRepo.getBankAccount(companyId, bankAccountId);
  if (!bankAccount) throw new ValidationError(`No bank account with id ${bankAccountId}.`);
  const code = resolveBankGlAccount({ glAccount: bankAccount.glAccount, accountNumber: bankAccount.accountNumber }, bankAccount.accountName);
  const accounts = await listChartOfAccounts(companyId);
  if (!accounts.some((a) => a.accountCode === code)) {
    throw new ValidationError(
      `${bankAccount.accountName} has no usable GL Account (resolved to "${code}", which doesn't exist in the Chart of Accounts). Set a GL Account on this bank account (Bank Accounts > Edit), or create a matching Chart of Accounts entry, before capturing a Cashbook entry against it.`,
    );
  }
  return { code, accountNumber: bankAccount.accountNumber };
}

/** Master Implementation Tracker — Programme 2, Root Cause RC-7,
 * Finding #219. The row's own GL Account (distinct from the bank
 * account's own GL, checked separately by `requireBankGlAccount`) was
 * only ever checked for non-empty, never for existing in the Chart of
 * Accounts — "no CoA at all," exactly as the finding names it. */
async function requireGlAccountExists(companyId: string, glAccount: string): Promise<void> {
  const accounts = await listChartOfAccounts(companyId);
  if (!accounts.some((a) => a.accountCode === glAccount.trim())) {
    throw new ValidationError(`GL account '${glAccount.trim()}' does not exist in the Chart of Accounts.`);
  }
}

export type CashbookReceiptInput = { bankAccountId: number; transactionDate: string; amount: number; vatAmount?: number; glAccount: string; reference?: string; description: string; beneficiary?: string; notes?: string; cashbookBatchId?: number | null };

export async function captureCashbookReceipt(companyId: string, input: CashbookReceiptInput): Promise<BankTransactionRecord> {
  if (!input.bankAccountId) throw new ValidationError("Bank account is required.");
  if (!input.transactionDate) throw new ValidationError("Transaction date is required.");
  if (!input.amount || input.amount <= 0) throw new ValidationError("Amount must be greater than zero.");
  if (!input.glAccount?.trim()) throw new ValidationError("A GL account is required for a Cashbook receipt.");
  if (!input.description?.trim()) throw new ValidationError("A description is required.");
  await requireGlAccountExists(companyId, input.glAccount);

  const bankAccount = await bankAccountRepo.getBankAccount(companyId, input.bankAccountId);
  if (!bankAccount) throw new ValidationError(`No bank account with id ${input.bankAccountId}.`);
  await assertNotMonthEndLocked(companyId, input.bankAccountId, input.transactionDate);

  return repo.createManualTransaction(companyId, {
    bankAccountId: input.bankAccountId,
    bankAccount: bankAccount.accountName,
    transactionDate: input.transactionDate,
    reference: input.reference ?? "",
    description: input.description,
    beneficiary: input.beneficiary ?? "",
    debit: 0,
    credit: round2(input.amount),
    glAccount: input.glAccount,
    vat: input.vatAmount ?? 0,
    notes: input.notes ?? "",
    cashbookBatchId: input.cashbookBatchId ?? null,
  });
}

export type CashbookPaymentInput = { bankAccountId: number; transactionDate: string; amount: number; vatAmount?: number; glAccount: string; reference?: string; description: string; beneficiary?: string; notes?: string; cashbookBatchId?: number | null };

export async function captureCashbookPayment(companyId: string, input: CashbookPaymentInput): Promise<BankTransactionRecord> {
  if (!input.bankAccountId) throw new ValidationError("Bank account is required.");
  if (!input.transactionDate) throw new ValidationError("Transaction date is required.");
  if (!input.amount || input.amount <= 0) throw new ValidationError("Amount must be greater than zero.");
  if (!input.glAccount?.trim()) throw new ValidationError("A GL account is required for a Cashbook payment.");
  if (!input.description?.trim()) throw new ValidationError("A description is required.");
  await requireGlAccountExists(companyId, input.glAccount);

  const bankAccount = await bankAccountRepo.getBankAccount(companyId, input.bankAccountId);
  if (!bankAccount) throw new ValidationError(`No bank account with id ${input.bankAccountId}.`);
  await assertNotMonthEndLocked(companyId, input.bankAccountId, input.transactionDate);

  return repo.createManualTransaction(companyId, {
    bankAccountId: input.bankAccountId,
    bankAccount: bankAccount.accountName,
    transactionDate: input.transactionDate,
    reference: input.reference ?? "",
    description: input.description,
    beneficiary: input.beneficiary ?? "",
    debit: round2(input.amount),
    credit: 0,
    glAccount: input.glAccount,
    vat: input.vatAmount ?? 0,
    notes: input.notes ?? "",
    cashbookBatchId: input.cashbookBatchId ?? null,
  });
}

export type BankTransferInput = { fromBankAccountId: number; toBankAccountId: number; transactionDate: string; amount: number; reference?: string; description: string; notes?: string; cashbookBatchId?: number | null };

/** A transfer is real double-entry between two of the company's own bank
 * accounts, so it needs TWO `ae_bank_transactions` rows — one on each
 * account's own feed, exactly as it would appear on both real bank
 * statements — cross-referenced by a shared reference string. */
export async function captureBankTransfer(companyId: string, input: BankTransferInput): Promise<{ from: BankTransactionRecord; to: BankTransactionRecord }> {
  if (!input.fromBankAccountId || !input.toBankAccountId) throw new ValidationError("Both a source and destination bank account are required.");
  if (input.fromBankAccountId === input.toBankAccountId) throw new ValidationError("Source and destination bank accounts must be different.");
  if (!input.transactionDate) throw new ValidationError("Transaction date is required.");
  if (!input.amount || input.amount <= 0) throw new ValidationError("Amount must be greater than zero.");
  if (!input.description?.trim()) throw new ValidationError("A description is required.");

  const [fromAccount, toAccount] = await Promise.all([bankAccountRepo.getBankAccount(companyId, input.fromBankAccountId), bankAccountRepo.getBankAccount(companyId, input.toBankAccountId)]);
  if (!fromAccount) throw new ValidationError(`No bank account with id ${input.fromBankAccountId}.`);
  if (!toAccount) throw new ValidationError(`No bank account with id ${input.toBankAccountId}.`);
  await Promise.all([assertNotMonthEndLocked(companyId, input.fromBankAccountId, input.transactionDate), assertNotMonthEndLocked(companyId, input.toBankAccountId, input.transactionDate)]);

  const reference = input.reference?.trim() || `TRANSFER-${Date.parse(input.transactionDate)}-${input.fromBankAccountId}-${input.toBankAccountId}`;
  const amount = round2(input.amount);

  const from = await repo.createManualTransaction(companyId, {
    bankAccountId: input.fromBankAccountId,
    bankAccount: fromAccount.accountName,
    transactionDate: input.transactionDate,
    reference,
    description: `Transfer to ${toAccount.accountName} — ${input.description}`,
    beneficiary: toAccount.accountName,
    debit: amount,
    credit: 0,
    glAccount: "",
    vat: 0,
    notes: input.notes ?? "",
    cashbookBatchId: input.cashbookBatchId ?? null,
  });
  const to = await repo.createManualTransaction(companyId, {
    bankAccountId: input.toBankAccountId,
    bankAccount: toAccount.accountName,
    transactionDate: input.transactionDate,
    reference,
    description: `Transfer from ${fromAccount.accountName} — ${input.description}`,
    beneficiary: fromAccount.accountName,
    debit: 0,
    credit: amount,
    glAccount: "",
    vat: 0,
    notes: input.notes ?? "",
    cashbookBatchId: input.cashbookBatchId ?? null,
  });

  return { from, to };
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  Draft: ["Submitted", "Cancelled"],
  Submitted: ["Approved", "Draft", "Cancelled"],
  Approved: [],
  Posted: [],
  Cancelled: [],
};

export async function submitCashbookEntry(companyId: string, transactionId: number): Promise<BankTransactionRecord> {
  const transaction = await requireTransaction(companyId, transactionId);
  if (!ALLOWED_TRANSITIONS[transaction.captureStatus ?? "Draft"]?.includes("Submitted")) {
    throw new ValidationError(`Cannot submit this entry from status ${transaction.captureStatus}.`);
  }
  return repo.setCaptureStatus(companyId, transactionId, "Submitted");
}

export type CashbookEntryEdit = { transactionDate: string; amount: number; vatAmount?: number; glAccount: string; reference?: string; description: string; beneficiary?: string };

/** Finding #080 — the only way to correct a Draft/Submitted manually
 * captured entry used to be Cancel it and recapture a brand-new row.
 * Deliberately does NOT touch `captureStatus` — a Submitted entry stays
 * Submitted after editing rather than silently bouncing back to Draft,
 * since re-approval-safety is the caller's judgement call, not this
 * function's; a Posted entry has a real journal, so Reverse (already
 * implemented) remains the only correct path there. */
export async function editCashbookEntry(companyId: string, transactionId: number, input: CashbookEntryEdit): Promise<BankTransactionRecord> {
  const transaction = await requireTransaction(companyId, transactionId);
  if (transaction.entrySource !== "Manual") throw new ValidationError("Only manually captured Cashbook entries can be edited.");
  if (transaction.captureStatus !== "Draft" && transaction.captureStatus !== "Submitted") {
    throw new ValidationError(`Cannot edit this entry from status ${transaction.captureStatus}.`);
  }
  if (!input.transactionDate) throw new ValidationError("Transaction date is required.");
  if (!input.amount || input.amount <= 0) throw new ValidationError("Amount must be greater than zero.");
  if (!input.glAccount?.trim()) throw new ValidationError("A GL account is required.");
  if (!input.description?.trim()) throw new ValidationError("A description is required.");
  const vatAmount = input.vatAmount ?? 0;
  if (vatAmount < 0 || vatAmount >= input.amount) throw new ValidationError("VAT must be zero or a positive amount less than the gross amount.");
  await requireGlAccountExists(companyId, input.glAccount);

  const isReceipt = transaction.credit > 0;
  return repo.updateManualTransaction(companyId, transactionId, {
    transactionDate: input.transactionDate,
    reference: input.reference ?? "",
    description: input.description,
    beneficiary: input.beneficiary ?? "",
    debit: isReceipt ? 0 : round2(input.amount),
    credit: isReceipt ? round2(input.amount) : 0,
    glAccount: input.glAccount.trim(),
    vat: round2(vatAmount),
  });
}

/** Migration 0100 review (H2) — checked BEFORE anything is created or
 * posted. This path writes the ledger (`postApprovedJournals`) before it
 * links the entry (`postCaptureStatus`), so the database's link guard
 * alone would only fire after a second posting had already reached the
 * ledger. An entry that is already linked or flagged posted, or that a
 * live Banking Rule journal already carries, is refused here. (Banking
 * Rules no longer take Manual entries at all; this also covers any taken
 * before that change.) A fully atomic Cashbook post-and-link is a separate
 * change. */
async function assertNotAlreadyInLedger(companyId: string, entries: BankTransactionRecord[]): Promise<void> {
  for (const entry of entries) {
    if (entry.journalId !== null) throw new ValidationError(`Transaction #${entry.id} is already linked to a journal; it cannot be posted again.`);
    if (entry.postedFlag) throw new ValidationError(`Transaction #${entry.id} is already flagged as posted; it cannot be posted again.`);
  }
  const ruleJournals = await journalRepo.listRuleEngineJournalsForTransactions(companyId, entries.map((e) => e.id));
  for (const entry of entries) {
    const journal = ruleJournals.get(entry.id);
    if (journal && isLiveRuleEngineJournal(journal)) {
      throw new ValidationError(`Transaction #${entry.id} is already carried by Banking Rule journal ${journal.journalNumber} (${journal.status}); it cannot also be posted from the Cashbook.`);
    }
  }
}

/** Determines which real posting rule + dynamic account resolution a
 * captured entry needs, then approves and posts it through the ONE
 * Posting Engine — same "approve and post in one call" pattern every
 * other module's own service uses. A Bank Transfer's `from` leg carries
 * the real posting (both legs share one journal); its `to` leg is
 * marked Posted alongside it without a second journal, since one
 * balanced journal already covers both sides of the transfer. */
export async function approveAndPostCashbookEntry(companyId: string, transactionId: number): Promise<BankTransactionRecord> {
  const transaction = await requireTransaction(companyId, transactionId);
  if (transaction.entrySource !== "Manual") throw new ValidationError("Only manually captured Cashbook entries can be approved and posted here.");
  if (transaction.captureStatus === "Posted") throw new ValidationError("This entry is already Posted.");
  if (transaction.captureStatus === "Cancelled") throw new ValidationError("This entry is cancelled.");

  const isTransfer = transaction.reference.startsWith("TRANSFER-");
  if (isTransfer) return approveAndPostTransfer(companyId, transaction);

  await assertNotAlreadyInLedger(companyId, [transaction]);

  const { code: bankCode } = await requireBankGlAccount(companyId, transaction.bankAccountId!);
  const isReceipt = transaction.credit > 0;
  const eventType = isReceipt ? "Cashbook Receipt" : "Cashbook Payment";
  const grossAmount = isReceipt ? transaction.credit : transaction.debit;

  if (!transaction.glAccount?.trim()) throw new ValidationError("This entry has no GL account assigned.");

  const built = await buildJournalFromEvent(companyId, eventType, {
    grossAmount,
    vatRatePercent: transaction.vat && grossAmount > transaction.vat ? round2((transaction.vat / (grossAmount - transaction.vat)) * 100) : 0,
    description: transaction.description,
    accountsByRole: { bank_account: bankCode, dynamic_income: transaction.glAccount, dynamic_expense: transaction.glAccount },
  });
  if (!built.ok) throw new ValidationError(`Could not generate a journal: ${built.reason}`);

  const journal = await journalRepo.createJournal(companyId, {
    journalType: eventType,
    description: `${eventType} — ${transaction.description}`,
    reference: transaction.reference || `CB${transaction.id}`,
    sourceType: "cashbook_entry",
    sourceId: transaction.id,
    status: "Approved",
    lines: built.lines,
  });

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === journal.id);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === journal.id);
    throw new ValidationError(`Approved but could not be posted${skip ? `: ${skip.reason}` : "."} It remains Approved.`);
  }

  // Phase 29C — atomically guarded: `null` means another concurrent
  // request already posted this exact entry between our check above and
  // this write (a real journal has just been created either way — see
  // this function's own doc comment on the repository side for why this
  // can't be a plain unguarded write).
  const posted = await repo.postCaptureStatus(companyId, transactionId, journal.id);
  if (!posted) throw new ValidationError("This entry was already posted by another request.");
  return posted;
}

async function approveAndPostTransfer(companyId: string, fromLeg: BankTransactionRecord): Promise<BankTransactionRecord> {
  const toLeg = (await repo.listCashbookTransactions(companyId, { entrySource: "Manual" })).find(
    (t) => t.reference === fromLeg.reference && t.id !== fromLeg.id && t.captureStatus !== "Posted",
  );
  if (!toLeg) throw new ValidationError("Could not find this transfer's other leg — it may already be posted.");
  await assertNotAlreadyInLedger(companyId, [fromLeg, toLeg]);

  const { code: fromCode } = await requireBankGlAccount(companyId, fromLeg.bankAccountId!);
  const { code: toCode } = await requireBankGlAccount(companyId, toLeg.bankAccountId!);
  if (fromCode === toCode) {
    throw new ValidationError(`Both bank accounts resolve to the same GL account (${fromCode}) — assign each a distinct GL Account (Bank Accounts > Edit) before transferring between them.`);
  }

  const built = await buildJournalFromEvent(companyId, "Bank Transfer", {
    grossAmount: fromLeg.debit,
    vatRatePercent: 0,
    description: fromLeg.description,
    accountsByRole: { bank_account_from: fromCode, bank_account_to: toCode },
  });
  if (!built.ok) throw new ValidationError(`Could not generate a journal: ${built.reason}`);

  const journal = await journalRepo.createJournal(companyId, {
    journalType: "Bank Transfer",
    description: `Bank Transfer — ${fromLeg.description}`,
    reference: fromLeg.reference,
    sourceType: "cashbook_transfer",
    sourceId: fromLeg.id,
    status: "Approved",
    lines: built.lines,
  });

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === journal.id);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === journal.id);
    throw new ValidationError(`Approved but could not be posted${skip ? `: ${skip.reason}` : "."} It remains Approved.`);
  }

  // Phase 29C — same atomic guard as the single-entry path above, for
  // both legs of the transfer.
  const postedTo = await repo.postCaptureStatus(companyId, toLeg.id, journal.id);
  if (!postedTo) throw new ValidationError("This transfer's other leg was already posted by another request.");
  const postedFrom = await repo.postCaptureStatus(companyId, fromLeg.id, journal.id);
  if (!postedFrom) throw new ValidationError("This entry was already posted by another request.");
  return postedFrom;
}

export async function cancelCashbookEntry(companyId: string, transactionId: number): Promise<BankTransactionRecord> {
  const transaction = await requireTransaction(companyId, transactionId);
  if (!ALLOWED_TRANSITIONS[transaction.captureStatus ?? "Draft"]?.includes("Cancelled")) {
    throw new ValidationError(`Cannot cancel this entry from status ${transaction.captureStatus}.`);
  }
  return repo.setCaptureStatus(companyId, transactionId, "Cancelled");
}

/** Cashbook Reversal — creates a brand-new offsetting entry (swapped
 * debit/credit, same GL account) rather than mutating or deleting the
 * original, matching the platform's "reverse via a new document" audit-
 * trail convention (journal reversal, GRN reversal). Approved and posted
 * immediately, since a reversal should take real effect right away. */
export async function reverseCashbookEntry(companyId: string, transactionId: number): Promise<BankTransactionRecord> {
  const original = await requireTransaction(companyId, transactionId);
  if (original.entrySource !== "Manual" || original.captureStatus !== "Posted") {
    throw new ValidationError("Only a Posted Cashbook entry can be reversed.");
  }
  if (!original.bankAccountId) throw new ValidationError("This entry has no bank account.");

  const reversed = await repo.createManualTransaction(companyId, {
    bankAccountId: original.bankAccountId,
    bankAccount: original.bankAccount,
    transactionDate: new Date().toISOString().slice(0, 10),
    reference: `REV-${original.reference || original.id}`,
    description: `Reversal of ${original.description}`,
    beneficiary: original.beneficiary,
    debit: original.credit,
    credit: original.debit,
    glAccount: original.glAccount,
    vat: original.vat ?? 0,
    notes: `Reversal of transaction #${original.id}.`,
    cashbookBatchId: null,
  });

  await repo.setCaptureStatus(companyId, reversed.id, "Submitted");
  return approveAndPostCashbookEntry(companyId, reversed.id);
}

export async function createCashbookBatch(companyId: string, batchDate: string, batchType: CashbookBatchType, notes?: string, createdBy?: string): Promise<CashbookBatch> {
  if (!batchDate) throw new ValidationError("Batch date is required.");
  return repo.createCashbookBatch(companyId, { batchDate, batchType, notes, createdBy });
}

/** Approves and posts every Draft/Submitted transaction in a batch, then
 * marks the batch Posted only if every one of its entries succeeded —
 * a partially-posted batch stays visible as Draft/Approved rather than
 * silently reporting success. */
export async function approveAndPostBatch(companyId: string, batchId: number): Promise<CashbookBatch> {
  const batch = await repo.getCashbookBatch(companyId, batchId);
  if (!batch) throw new NotFoundError(`No cashbook batch with id ${batchId}.`);
  if (batch.status === "Posted") throw new ValidationError(`${batch.batchNumber} is already Posted.`);

  const transactions = await repo.listBatchTransactions(companyId, batchId);
  const pending = transactions.filter((t) => t.captureStatus !== "Posted" && t.captureStatus !== "Cancelled");

  for (const transaction of pending) {
    if (transaction.captureStatus === "Draft") await repo.setCaptureStatus(companyId, transaction.id, "Submitted");
  }
  for (const transaction of pending) {
    await approveAndPostCashbookEntry(companyId, transaction.id);
  }

  await repo.setBatchStatus(companyId, batchId, "Approved");
  return repo.setBatchStatus(companyId, batchId, "Posted");
}

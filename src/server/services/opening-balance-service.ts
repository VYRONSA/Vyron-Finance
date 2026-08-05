/**
 * Service layer for the Opening Balances Management Centre — Pilot
 * Review Round 1, Phase 1+2. Thin validation and orchestration on top
 * of `opening-balance-repository.ts`, matching this codebase's
 * established repository/service split. Posting goes through the one
 * real Posting Engine (`createJournal` + `postApprovedJournals`) — no
 * parallel path, per the directive's own "represented as real
 * accounting journals rather than hidden values" instruction.
 */

import * as repo from "@/server/repositories/opening-balance-repository";
import { getCompany } from "@/server/services/company-service";
import { getBankAccount, updateBankAccount } from "@/server/repositories/bank-account-repository";
import { getCustomer } from "@/server/repositories/customer-repository";
import { getSupplier } from "@/server/repositories/supplier-reconciliation-repository";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { createJournal } from "@/server/repositories/journal-repository";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import { recordPermissionAuditEntry } from "@/server/repositories/permission-repository";
import { OPENING_BALANCE_CATEGORIES, type EditOpeningBalanceEntry, type NewOpeningBalanceEntry, type OpeningBalanceEntry, type OpeningBalanceGovernance } from "@/server/opening-balances/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

/** `companies.status !== 'onboarding'` is used as the practical proxy
 * for "has this company gone live" — there is no dedicated go-live flag
 * on `Company` yet. Disclosed explicitly in the Round 1 completion
 * report as an interpretation, not an assumption hidden from the reader. */
export async function getOpeningBalanceGovernance(companyId: string): Promise<OpeningBalanceGovernance> {
  const company = await getCompany(companyId);
  const requiresGovernance = company?.status !== "onboarding";
  return { requiresGovernance, reasonRequired: requiresGovernance };
}

export async function listOpeningBalanceEntries(companyId: string): Promise<OpeningBalanceEntry[]> {
  return repo.listOpeningBalanceEntries(companyId);
}

async function validateTarget(companyId: string, input: Pick<NewOpeningBalanceEntry, "category" | "accountCode" | "bankAccountId" | "customerId" | "supplierId">): Promise<void> {
  if (!OPENING_BALANCE_CATEGORIES.includes(input.category)) throw new ValidationError(`Invalid category: ${input.category}.`);

  if (input.category === "BankAccount") {
    if (!input.bankAccountId) throw new ValidationError("A bank account must be selected.");
    const account = await getBankAccount(companyId, input.bankAccountId);
    if (!account) throw new NotFoundError(`No bank account with id ${input.bankAccountId}.`);
  } else if (input.category === "Customer") {
    if (!input.customerId) throw new ValidationError("A customer must be selected.");
    const customer = await getCustomer(companyId, input.customerId);
    if (!customer) throw new NotFoundError(`No customer with id ${input.customerId}.`);
  } else if (input.category === "Supplier") {
    if (!input.supplierId) throw new ValidationError("A supplier must be selected.");
    const supplier = await getSupplier(companyId, input.supplierId);
    if (!supplier) throw new NotFoundError(`No supplier with id ${input.supplierId}.`);
  } else {
    // GeneralLedger, VATControl, Loan (and the schema-ready-but-not-yet-
    // UI-supported Inventory/FixedAsset) all resolve to a real Chart of
    // Accounts entry — never a free-text code accepted unchecked.
    if (!input.accountCode) throw new ValidationError("A GL account must be selected.");
    const accounts = await listChartOfAccounts(companyId);
    if (!accounts.some((a) => a.accountCode === input.accountCode)) {
      throw new NotFoundError(`No Chart of Accounts entry with code ${input.accountCode}.`);
    }
  }
}

export type CreateOpeningBalanceRequest = NewOpeningBalanceEntry & { reason?: string; performedBy: string };

export async function createOpeningBalanceEntry(companyId: string, input: CreateOpeningBalanceRequest): Promise<OpeningBalanceEntry> {
  if (!input.description?.trim()) throw new ValidationError("Description is required.");
  if (typeof input.amount !== "number" || Number.isNaN(input.amount)) throw new ValidationError("Amount must be a number.");
  await validateTarget(companyId, input);

  const governance = await getOpeningBalanceGovernance(companyId);
  if (governance.reasonRequired && !input.reason?.trim()) {
    throw new ValidationError("A reason is required for opening balance changes after go-live.");
  }

  const entry = await repo.createOpeningBalanceEntry(
    companyId,
    { ...input, description: input.description.trim(), reference: input.reference?.trim() ?? "" },
    input.performedBy,
  );

  await recordPermissionAuditEntry(
    companyId, "OpeningBalance", String(entry.id), "created", null,
    `${entry.category} ${entry.amount.toFixed(2)} — ${entry.description}`,
    input.reason?.trim() || "Initial capture during implementation.", input.performedBy,
  );

  return entry;
}

export type EditOpeningBalanceRequest = EditOpeningBalanceEntry & { reason?: string; performedBy: string };

export async function editOpeningBalanceEntry(companyId: string, entryId: number, input: EditOpeningBalanceRequest): Promise<OpeningBalanceEntry> {
  const existing = await repo.getOpeningBalanceEntry(companyId, entryId);
  if (!existing) throw new NotFoundError(`No opening balance entry with id ${entryId}.`);
  if (existing.status === "posted") throw new ValidationError("This opening balance has already been posted to the General Ledger and can no longer be edited directly — reverse the journal instead to correct it.");
  if (input.description !== undefined && !input.description.trim()) throw new ValidationError("Description cannot be empty.");
  if (input.amount !== undefined && (typeof input.amount !== "number" || Number.isNaN(input.amount))) throw new ValidationError("Amount must be a number.");

  const governance = await getOpeningBalanceGovernance(companyId);
  if (governance.reasonRequired && !input.reason?.trim()) {
    throw new ValidationError("A reason is required for opening balance changes after go-live.");
  }

  const updated = await repo.updateOpeningBalanceEntry(companyId, entryId, {
    ...(input.description !== undefined && { description: input.description.trim() }),
    ...(input.amount !== undefined && { amount: input.amount }),
    ...(input.reference !== undefined && { reference: input.reference.trim() }),
    ...(input.balanceDate !== undefined && { balanceDate: input.balanceDate }),
  });

  const reason = input.reason?.trim() || "Corrected during implementation.";
  if (input.amount !== undefined && input.amount !== existing.amount) {
    await recordPermissionAuditEntry(companyId, "OpeningBalance", String(entryId), "amount", existing.amount.toFixed(2), input.amount.toFixed(2), reason, input.performedBy);
  }
  if (input.description !== undefined && input.description.trim() !== existing.description) {
    await recordPermissionAuditEntry(companyId, "OpeningBalance", String(entryId), "description", existing.description, input.description.trim(), reason, input.performedBy);
  }
  if (input.reference !== undefined && input.reference.trim() !== existing.reference) {
    await recordPermissionAuditEntry(companyId, "OpeningBalance", String(entryId), "reference", existing.reference, input.reference.trim(), reason, input.performedBy);
  }
  if (input.balanceDate !== undefined && input.balanceDate !== existing.balanceDate) {
    await recordPermissionAuditEntry(companyId, "OpeningBalance", String(entryId), "balanceDate", existing.balanceDate, input.balanceDate, reason, input.performedBy);
  }

  return updated;
}

export async function deleteOpeningBalanceEntry(companyId: string, entryId: number, reason: string | undefined, performedBy: string): Promise<void> {
  const existing = await repo.getOpeningBalanceEntry(companyId, entryId);
  if (!existing) throw new NotFoundError(`No opening balance entry with id ${entryId}.`);
  if (existing.status === "posted") throw new ValidationError("This opening balance has already been posted to the General Ledger and cannot be deleted — reverse the journal instead.");

  const governance = await getOpeningBalanceGovernance(companyId);
  if (governance.reasonRequired && !reason?.trim()) {
    throw new ValidationError("A reason is required for opening balance changes after go-live.");
  }

  await repo.deleteOpeningBalanceEntry(companyId, entryId);
  await recordPermissionAuditEntry(
    companyId, "OpeningBalance", String(entryId), "deleted",
    `${existing.category} ${existing.amount.toFixed(2)} — ${existing.description}`, null,
    reason?.trim() || "Removed during implementation.", performedBy,
  );
}

export type BulkGlOpeningBalanceRow = {
  /** The row's own GL account code — always present, including for a
   * bank-linked row, so the grid can render every row uniformly. */
  accountCode: string;
  /** Set only when this row IS a bank account's own GL code — routes the
   * write to a `BankAccount`-category entry (and, on posting, syncs that
   * account's cached balance — see `postOpeningBalances`) instead of a
   * plain `GeneralLedger` entry. */
  bankAccountId?: number | null;
  /** Signed amount, Dr positive / Cr negative. Zero means "no entry" —
   * clears any existing draft entry for this row. */
  amount: number;
  description: string;
  reference?: string;
  balanceDate?: string;
};

export type BulkUpsertGlOpeningBalancesResult = {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  skipped: { accountCode: string; reason: string }[];
};

/** Pilot Review Round 1 (Board revision) — the Opening Balances Centre's
 * primary surface is now a full Chart-of-Accounts grid, not one form per
 * account. This is the grid's one save path: given the full current
 * state of every editable row, upsert-by-account-code against whatever
 * draft entries already exist, reusing `createOpeningBalanceEntry`/
 * `editOpeningBalanceEntry`/`deleteOpeningBalanceEntry` for every actual
 * write — so validation, governance, and the audit trail all stay in
 * that one place rather than being re-implemented here. A grid row for a
 * Debtors/Creditors control account is silently skipped whenever real
 * per-customer/per-supplier subsidiary entries already exist for it —
 * writing a direct entry at the same resolved account code on top of a
 * subsidiary rollup would double the posted balance (both net to the
 * same GL code — see `resolveAccountCode` below). The UI is expected to
 * render that row read-only in the same situation; this is the backend
 * half of that guarantee, not just a UI nicety. */
export async function bulkUpsertGlOpeningBalances(
  companyId: string,
  rows: BulkGlOpeningBalanceRow[],
  performedBy: string,
  reason?: string,
): Promise<BulkUpsertGlOpeningBalancesResult> {
  const [existing, accounts] = await Promise.all([repo.listOpeningBalanceEntries(companyId), listChartOfAccounts(companyId)]);
  const debtorsControl = accounts.find((a) => a.isControlAccount && a.description === "Debtors");
  const creditorsControl = accounts.find((a) => a.isControlAccount && a.description === "Creditors");
  const hasSubsidiaryDebtors = existing.some((e) => e.category === "Customer" && e.status === "draft");
  const hasSubsidiaryCreditors = existing.some((e) => e.category === "Supplier" && e.status === "draft");

  const result: BulkUpsertGlOpeningBalancesResult = { created: 0, updated: 0, deleted: 0, unchanged: 0, skipped: [] };

  for (const row of rows) {
    if (debtorsControl && row.accountCode === debtorsControl.accountCode && hasSubsidiaryDebtors) {
      result.skipped.push({ accountCode: row.accountCode, reason: "Captured via individual Customer opening balances — edit those instead of the control account." });
      continue;
    }
    if (creditorsControl && row.accountCode === creditorsControl.accountCode && hasSubsidiaryCreditors) {
      result.skipped.push({ accountCode: row.accountCode, reason: "Captured via individual Supplier opening balances — edit those instead of the control account." });
      continue;
    }

    const existingEntry = row.bankAccountId
      ? existing.find((e) => e.category === "BankAccount" && e.bankAccountId === row.bankAccountId)
      : existing.find((e) => (e.category === "GeneralLedger" || e.category === "VATControl" || e.category === "Loan") && e.accountCode === row.accountCode);

    if (existingEntry?.status === "posted") {
      if (Math.round((existingEntry.amount - row.amount) * 100) !== 0) {
        result.skipped.push({ accountCode: row.accountCode, reason: "Already posted to the General Ledger — reverse the journal instead of editing here." });
      } else {
        result.unchanged++;
      }
      continue;
    }

    const isZero = Math.round(row.amount * 100) === 0;

    if (!existingEntry && isZero) continue;

    if (existingEntry && isZero) {
      await deleteOpeningBalanceEntry(companyId, existingEntry.id, reason, performedBy);
      result.deleted++;
      continue;
    }

    if (existingEntry) {
      if (Math.round((existingEntry.amount - row.amount) * 100) === 0 && existingEntry.description === row.description) {
        result.unchanged++;
        continue;
      }
      await editOpeningBalanceEntry(companyId, existingEntry.id, {
        amount: row.amount, description: row.description, reference: row.reference, balanceDate: row.balanceDate, reason, performedBy,
      });
      result.updated++;
      continue;
    }

    await createOpeningBalanceEntry(companyId, {
      category: row.bankAccountId ? "BankAccount" : "GeneralLedger",
      accountCode: row.bankAccountId ? undefined : row.accountCode,
      bankAccountId: row.bankAccountId ?? undefined,
      description: row.description,
      amount: row.amount,
      reference: row.reference,
      balanceDate: row.balanceDate,
      reason,
      performedBy,
    });
    result.created++;
  }

  return result;
}

/** Resolves the real Chart of Accounts control-account code a category
 * posts against. Bank Accounts carry their own `glAccount`; Customer/
 * Supplier entries roll up into the company's single Debtors/Creditors
 * control account (standard accounting practice — individual balances
 * are a subsidiary ledger, the GL only ever carries the control total),
 * resolved by the exact control-account names `seed_company_defaults()`
 * seeds (`0022_cashbook_reconciliation.sql`), never hardcoded account
 * numbers a company may have since renumbered. */
async function resolveAccountCode(companyId: string, entry: OpeningBalanceEntry): Promise<string> {
  if (entry.category === "GeneralLedger" || entry.category === "VATControl" || entry.category === "Loan") {
    if (!entry.accountCode) throw new ValidationError(`Opening balance entry ${entry.id} has no GL account code.`);
    return entry.accountCode;
  }
  if (entry.category === "BankAccount") {
    const account = entry.bankAccountId ? await getBankAccount(companyId, entry.bankAccountId) : null;
    if (!account) throw new NotFoundError(`Bank account for opening balance entry ${entry.id} no longer exists.`);
    return account.glAccount?.trim() || `BANK-${account.accountNumber}`;
  }
  const accounts = await listChartOfAccounts(companyId);
  const controlAccountName = entry.category === "Customer" ? "Debtors" : "Creditors";
  const control = accounts.find((a) => a.isControlAccount && a.description === controlAccountName);
  if (!control) throw new NotFoundError(`No "${controlAccountName}" control account found in Chart of Accounts — configure one before posting opening balances.`);
  return control.accountCode;
}

export type PostOpeningBalancesResult = { journalId: number; journalNumber: string; totalDebit: number; totalCredit: number; entryCount: number };

export type NetJournalLine = { accountCode: string; debit: number; credit: number; description: string };
export type NetOpeningBalanceLinesResult = { lines: NetJournalLine[]; totalDebit: number; totalCredit: number };

/** Pure core of `postOpeningBalances` — netting entries per account code
 * into balanced debit/credit journal lines, with cent-accurate rounding.
 * Extracted so this codebase's most financially significant arithmetic
 * (would a real trial-balance-style journal actually balance?) is
 * directly unit-testable without a live database, matching the pure-
 * core/orchestration split already established for `posting-engine-service.ts`. */
export function netOpeningBalanceLines(entries: { accountCode: string; amount: number }[]): NetOpeningBalanceLinesResult {
  const netByAccount = new Map<string, number>();
  for (const entry of entries) {
    netByAccount.set(entry.accountCode, (netByAccount.get(entry.accountCode) ?? 0) + entry.amount);
  }

  const lines = [...netByAccount.entries()]
    .filter(([, net]) => Math.round(net * 100) !== 0)
    .map(([accountCode, net]) => ({
      accountCode,
      debit: net > 0 ? Math.round(net * 100) / 100 : 0,
      credit: net < 0 ? Math.round(-net * 100) / 100 : 0,
      description: "Opening balance",
    }));

  const totalDebit = Math.round(lines.reduce((sum, l) => sum + l.debit, 0) * 100) / 100;
  const totalCredit = Math.round(lines.reduce((sum, l) => sum + l.credit, 0) * 100) / 100;
  return { lines, totalDebit, totalCredit };
}

/** Posts every current 'draft' opening balance entry as ONE real,
 * balanced journal through the shared Posting Engine — never a
 * per-entry journal, matching how a genuine trial-balance-import journal
 * works in practice. Refuses to post an unbalanced set rather than
 * silently forcing balance with a suspense line the user never asked for. */
export async function postOpeningBalances(companyId: string, performedBy: string): Promise<PostOpeningBalancesResult> {
  const entries = await repo.listOpeningBalanceEntries(companyId);
  const draftEntries = entries.filter((e) => e.status === "draft");
  if (draftEntries.length === 0) throw new ValidationError("There are no draft opening balance entries to post.");

  const entriesWithAccountCode = await Promise.all(
    draftEntries.map(async (entry) => ({ accountCode: await resolveAccountCode(companyId, entry), amount: entry.amount })),
  );
  const { lines, totalDebit, totalCredit } = netOpeningBalanceLines(entriesWithAccountCode);

  if (totalDebit !== totalCredit) {
    const difference = Math.round((totalDebit - totalCredit) * 100) / 100;
    throw new ValidationError(
      `Opening balances do not balance — debits (${totalDebit.toFixed(2)}) and credits (${totalCredit.toFixed(2)}) differ by ${Math.abs(difference).toFixed(2)}. Correct the draft entries before posting.`,
    );
  }
  if (lines.length === 0) {
    throw new ValidationError("Every draft opening balance nets to zero — nothing to post.");
  }

  const journal = await createJournal(companyId, {
    journalType: "Opening Balance",
    description: "Opening balances — company setup",
    reference: "Opening Balances Centre",
    sourceType: "OpeningBalance",
    sourceId: null,
    status: "Approved",
    lines,
  });

  await postApprovedJournals(companyId);
  await repo.markOpeningBalanceEntriesPosted(companyId, draftEntries.map((e) => e.id), journal.id);

  // The journal above is what makes the General Ledger correct; a
  // BankAccount-category entry also needs its bank account's own cached
  // `opening_balance`/`current_balance` (what the Bank Accounts screen and
  // reconciliation module actually read — never derived from GL_transactions,
  // see bank-account-repository.ts) kept in sync, using the same delta
  // mechanic Phase 2's direct edit uses, or the two silently diverge.
  const netByBankAccount = new Map<number, number>();
  for (const entry of draftEntries) {
    if (entry.category === "BankAccount" && entry.bankAccountId) {
      netByBankAccount.set(entry.bankAccountId, (netByBankAccount.get(entry.bankAccountId) ?? 0) + entry.amount);
    }
  }
  for (const [bankAccountId, net] of netByBankAccount) {
    const account = await getBankAccount(companyId, bankAccountId);
    if (!account) continue;
    const updated = await updateBankAccount(companyId, bankAccountId, {
      opening_balance: Math.round((account.openingBalance + net) * 100) / 100,
      current_balance: Math.round((account.currentBalance + net) * 100) / 100,
    });
    await recordPermissionAuditEntry(
      companyId, "BankAccountOpeningBalance", String(bankAccountId), "openingBalance",
      account.openingBalance.toFixed(2), updated.openingBalance.toFixed(2),
      `Posted via Opening Balances Centre (journal ${journal.journalNumber}).`, performedBy,
    );
  }

  await recordPermissionAuditEntry(
    companyId, "OpeningBalance", "batch", "posted", null,
    `${draftEntries.length} entries posted as journal ${journal.journalNumber}`,
    "Opening balances posted to the General Ledger.", performedBy,
  );

  return { journalId: journal.id, journalNumber: journal.journalNumber, totalDebit, totalCredit, entryCount: draftEntries.length };
}

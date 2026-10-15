/**
 * Bulk repair of missing revenue accounts on POSTED sales invoices — one
 * controlled operation in place of one click per invoice (Batch 1B of the
 * Handcrafted Food Products migration: 43 invoices, 132 lines).
 *
 * Each invoice goes through `assignMissingPostedLineAccounts`, unchanged,
 * so every safeguard of the single repair holds per invoice: Posted
 * Invoice only, its own live posted journal, only lines without an
 * account, only `gl_account` written, invoice + journal fingerprinted
 * before and after with undo on any difference, one audit entry, undo if
 * that entry cannot be written. On top of that:
 *  - the caller names invoices, never an account: the account is always
 *    POSTED_LINE_ACCOUNT_REPAIR_CODE (1000), checked once up front;
 *  - at most MAX_POSTED_REPAIR_BATCH invoices per call, so a run cannot
 *    sweep up unrelated documents; a larger selection is sent in pages;
 *  - invoices are looked up in the caller's company only;
 *  - invoices are processed one at a time and each result is reported, so
 *    one failure does not stop or undo the others, and a retry is safe:
 *    an invoice already repaired has no line left to fill, gets no second
 *    write and no second audit entry, and is reported as already repaired.
 *
 * Nothing here posts, reverses, edits or creates a journal.
 */
import * as repo from "@/server/repositories/sales-invoice-repository";
import { countCompanyJournals } from "@/server/repositories/posted-line-account-repair-repository";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { listAuditLogForDocument } from "@/server/services/automation-audit-service";
import {
  assignMissingPostedLineAccounts,
  NotFoundError,
  POSTED_LINE_ACCOUNT_REPAIR_CODE,
  requirePostedInvoiceJournal,
  ValidationError,
} from "@/server/services/sales-invoice-service";
import { findRepairScope, repairScopesForCompany, type PostedLineAccountRepairScope } from "@/server/sales/posted-line-account-repair-scopes";
import type { SalesInvoice } from "@/server/sales/types";

export const MAX_POSTED_REPAIR_BATCH = 50;
export const POSTED_REPAIR_AUDIT_ACTION = "SalesInvoicePostedLineAccountsAssigned";

export type PostedRepairCandidate = {
  invoiceId: number;
  invoiceNumber: string | null;
  documentType: string | null;
  status: string | null;
  customerId: number | null;
  invoiceDate: string | null;
  total: number;
  vatAmount: number;
  outstanding: number;
  lineCount: number;
  missingLines: number;
  journalId: number | null;
  journalNumber: string | null;
  /** Will be repaired if submitted now. */
  eligible: boolean;
  /** No line left without an account, and a repair audit entry exists. */
  alreadyRepaired: boolean;
  /** Why it is not eligible (null when eligible). */
  reason: string | null;
};

export type PostedRepairPreview = {
  account: { code: string; description: string | null; ok: boolean; problem: string | null };
  candidates: PostedRepairCandidate[];
  eligible: { invoices: number; lines: number; total: number; vatAmount: number };
  journalCount: number;
  scope: { id: string; label: string; description: string; expected: PostedLineAccountRepairScope["expected"]; problems: string[] } | null;
  /** True only when the account is usable, there is something to repair
   * and — for a scope — every pinned fact still holds. */
  ready: boolean;
};

export type PostedRepairOutcome = "repaired" | "already-repaired" | "skipped" | "failed";
export type PostedRepairResult = { invoiceId: number; invoiceNumber: string | null; outcome: PostedRepairOutcome; linesAssigned: number; message: string };
export type PostedRepairRun = {
  results: PostedRepairResult[];
  summary: Record<PostedRepairOutcome, number> & { linesAssigned: number };
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const sumCents = (xs: number[]) => r2(xs.reduce((t, x) => t + Math.round(x * 100), 0) / 100);

/** A non-empty list of distinct positive integer ids, at most `max`. */
export function parseInvoiceIds(value: unknown, max = MAX_POSTED_REPAIR_BATCH): number[] {
  if (!Array.isArray(value) || value.length === 0) throw new ValidationError("Choose at least one invoice.");
  if (!value.every((v) => Number.isSafeInteger(v) && (v as number) > 0)) throw new ValidationError("Invoice ids must be positive whole numbers.");
  const ids = [...new Set(value as number[])];
  if (ids.length > max) throw new ValidationError(`At most ${max} invoices can be repaired at once; ${ids.length} were sent. Send them in pages.`);
  return ids;
}

async function checkRepairAccount(companyId: string): Promise<PostedRepairPreview["account"]> {
  const code = POSTED_LINE_ACCOUNT_REPAIR_CODE;
  const account = (await listChartOfAccounts(companyId)).find((a) => a.accountCode === code);
  const problem = !account
    ? `Account ${code} is not in the chart of accounts.`
    : !account.isActive
      ? `Account ${code} is inactive.`
      : account.accountType !== "Income"
        ? `Account ${code} is ${account.accountType}; a sales line needs an Income account.`
        : null;
  return { code, description: account?.description ?? null, ok: problem === null, problem };
}

async function hasRepairAudit(companyId: string, invoiceId: number): Promise<boolean> {
  return (await listAuditLogForDocument(companyId, "SalesInvoice", invoiceId)).some((e) => e.actionType === POSTED_REPAIR_AUDIT_ACTION);
}

async function classify(companyId: string, invoiceId: number, invoice: SalesInvoice | null): Promise<PostedRepairCandidate> {
  const base: PostedRepairCandidate = {
    invoiceId, invoiceNumber: null, documentType: null, status: null, customerId: null, invoiceDate: null,
    total: 0, vatAmount: 0, outstanding: 0, lineCount: 0, missingLines: 0, journalId: null, journalNumber: null,
    eligible: false, alreadyRepaired: false, reason: null,
  };
  if (!invoice) return { ...base, reason: `No sales invoice with id ${invoiceId} in this company.` };
  const c: PostedRepairCandidate = {
    ...base,
    invoiceNumber: invoice.invoiceNumber, documentType: invoice.documentType, status: invoice.status, customerId: invoice.customerId,
    invoiceDate: invoice.invoiceDate, total: invoice.total, vatAmount: invoice.vatAmount, outstanding: invoice.outstanding,
    lineCount: invoice.lines.length, missingLines: invoice.lines.filter((l) => !l.glAccount).length, journalId: invoice.journalId,
  };
  if (invoice.status !== "Posted" || invoice.documentType !== "Invoice") {
    return { ...c, reason: `${invoice.invoiceNumber} is a ${invoice.status} ${invoice.documentType}; only Posted invoices are repaired.` };
  }
  try {
    const journal = await requirePostedInvoiceJournal(companyId, invoice);
    c.journalNumber = journal.journalNumber;
  } catch (error) {
    if (error instanceof ValidationError) return { ...c, reason: error.message };
    throw error;
  }
  if (c.missingLines === 0) {
    const repaired = await hasRepairAudit(companyId, invoiceId);
    return { ...c, alreadyRepaired: repaired, reason: repaired ? "Already repaired." : `Every line on ${invoice.invoiceNumber} already has an account.` };
  }
  return { ...c, eligible: true };
}

function scopeProblems(scope: PostedLineAccountRepairScope, candidates: PostedRepairCandidate[], byNumber: SalesInvoice[], journalCount: number): string[] {
  const problems: string[] = [];
  for (const e of scope.entries) {
    const matches = byNumber.filter((i) => i.invoiceNumber === e.invoiceNumber);
    const c = candidates.find((x) => x.invoiceId === e.invoiceId);
    if (matches.length !== 1 || matches[0].id !== e.invoiceId) {
      problems.push(`${e.invoiceNumber}: expected exactly one document with id ${e.invoiceId}, found ${matches.map((m) => m.id).join(", ") || "none"}.`);
      continue;
    }
    if (!c) continue;
    if (c.journalId !== e.journalId || c.journalNumber !== e.journalNumber) problems.push(`${e.invoiceNumber}: journal is ${c.journalNumber ?? "missing"} (#${c.journalId}), expected ${e.journalNumber} (#${e.journalId}).`);
    if (c.total !== e.total || c.vatAmount !== e.vatAmount) problems.push(`${e.invoiceNumber}: total/VAT ${c.total}/${c.vatAmount}, expected ${e.total}/${e.vatAmount}.`);
    if (c.lineCount !== e.lines) problems.push(`${e.invoiceNumber}: ${c.lineCount} line(s), expected ${e.lines}.`);
    if (!c.eligible && !c.alreadyRepaired) problems.push(`${e.invoiceNumber}: ${c.reason}`);
    else if (c.eligible && c.missingLines !== e.lines) problems.push(`${e.invoiceNumber}: ${c.missingLines} of ${e.lines} line(s) without an account; a partly filled invoice must be checked by hand.`);
  }
  const all = candidates.filter((c) => scope.entries.some((e) => e.invoiceId === c.invoiceId));
  if (all.length !== scope.expected.invoices) problems.push(`Scope covers ${all.length} invoice(s), expected ${scope.expected.invoices}.`);
  if (all.reduce((t, c) => t + c.lineCount, 0) !== scope.expected.lines) problems.push(`Scope has ${all.reduce((t, c) => t + c.lineCount, 0)} line(s), expected ${scope.expected.lines}.`);
  if (sumCents(all.map((c) => c.total)) !== scope.expected.total) problems.push(`Scope total R${sumCents(all.map((c) => c.total))}, expected R${scope.expected.total}.`);
  if (sumCents(all.map((c) => c.vatAmount)) !== scope.expected.vatAmount) problems.push(`Scope VAT R${sumCents(all.map((c) => c.vatAmount))}, expected R${scope.expected.vatAmount}.`);
  if (journalCount !== scope.expected.journals) problems.push(`The company has ${journalCount} journals, expected ${scope.expected.journals}; something else changed — check before repairing.`);
  return problems;
}

/** Read-only: exactly what a repair of these invoices — or of a named
 * scope — would do now, and whether it is safe to run. Writes nothing. */
export async function previewPostedLineAccountRepair(companyId: string, input: { invoiceIds?: unknown; scopeId?: unknown }): Promise<PostedRepairPreview> {
  let scope: PostedLineAccountRepairScope | null = null;
  let ids: number[];
  if (input.scopeId !== undefined) {
    scope = typeof input.scopeId === "string" ? findRepairScope(companyId, input.scopeId) : null;
    if (!scope) throw new ValidationError(`There is no repair scope "${String(input.scopeId)}" for this company.`);
    ids = scope.entries.map((e) => e.invoiceId);
  } else {
    ids = parseInvoiceIds(input.invoiceIds);
  }
  const [account, journalCount, byNumber] = await Promise.all([
    checkRepairAccount(companyId),
    countCompanyJournals(companyId),
    scope ? repo.listSalesInvoicesByNumbers(companyId, scope.entries.map((e) => e.invoiceNumber)) : Promise.resolve([]),
  ]);
  const candidates: PostedRepairCandidate[] = [];
  for (const id of ids) candidates.push(await classify(companyId, id, await repo.getSalesInvoice(companyId, id)));
  const eligible = candidates.filter((c) => c.eligible);
  const problems = scope ? scopeProblems(scope, candidates, byNumber, journalCount) : [];
  return {
    account,
    candidates,
    eligible: { invoices: eligible.length, lines: eligible.reduce((t, c) => t + c.missingLines, 0), total: sumCents(eligible.map((c) => c.total)), vatAmount: sumCents(eligible.map((c) => c.vatAmount)) },
    journalCount,
    scope: scope ? { id: scope.id, label: scope.label, description: scope.description, expected: scope.expected, problems } : null,
    ready: account.ok && eligible.length > 0 && problems.length === 0,
  };
}

export function listRepairScopes(companyId: string) {
  return repairScopesForCompany(companyId).map(({ id, label, description, expected }) => ({ id, label, description, expected }));
}

/**
 * Repairs up to MAX_POSTED_REPAIR_BATCH Posted invoices of this company,
 * one at a time, assigning account 1000 to their lines without an account.
 * Returns one result per invoice; never throws for a single invoice's
 * failure (only for an invalid request or an unusable account, before
 * anything is written).
 */
export async function bulkAssignMissingPostedLineAccounts(companyId: string, invoiceIds: unknown, performedBy: string): Promise<PostedRepairRun> {
  const ids = parseInvoiceIds(invoiceIds);
  const account = await checkRepairAccount(companyId);
  if (!account.ok) throw new ValidationError(`${account.problem} Nothing was changed.`);

  const results: PostedRepairResult[] = [];
  for (const id of ids) {
    let invoiceNumber: string | null = null;
    try {
      const c = await classify(companyId, id, await repo.getSalesInvoice(companyId, id));
      invoiceNumber = c.invoiceNumber;
      if (!c.eligible) {
        results.push({
          invoiceId: id, invoiceNumber, linesAssigned: 0,
          outcome: c.alreadyRepaired ? "already-repaired" : c.invoiceNumber === null ? "failed" : "skipped",
          message: c.alreadyRepaired ? "Already repaired; nothing changed." : `${c.reason} Nothing changed.`,
        });
        continue;
      }
      const after = await assignMissingPostedLineAccounts(companyId, id, POSTED_LINE_ACCOUNT_REPAIR_CODE, performedBy);
      const assigned = c.missingLines - after.lines.filter((l) => !l.glAccount).length;
      results.push({ invoiceId: id, invoiceNumber, outcome: "repaired", linesAssigned: assigned, message: `${assigned} line(s) set to ${POSTED_LINE_ACCOUNT_REPAIR_CODE}; journal ${c.journalNumber} unchanged.` });
    } catch (error) {
      const message = error instanceof ValidationError || error instanceof NotFoundError || error instanceof Error ? error.message : String(error);
      results.push({ invoiceId: id, invoiceNumber, outcome: "failed", linesAssigned: 0, message });
    }
  }
  const summary = { repaired: 0, "already-repaired": 0, skipped: 0, failed: 0, linesAssigned: 0 };
  for (const r of results) {
    summary[r.outcome]++;
    summary.linesAssigned += r.linesAssigned;
  }
  return { results, summary };
}

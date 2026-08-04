/**
 * Application Service layer for GL Inquiry — request-shape parsing,
 * pagination cursor handling, and running-balance computation on top of
 * `gl-repository.ts`. Cursor shape mirrors
 * `transaction-explorer-service.ts::encodeCursor`/`decodeCursor` (same
 * base64url-JSON approach) but isn't shared code with it — the two
 * modules' cursor shapes differ (posting-date-only sort here vs. a
 * configurable sort column there), matching how Transaction Explorer
 * itself keeps its pagination module-local rather than factored into a
 * shared generic.
 */

import * as repo from "@/server/repositories/gl-repository";
import { getChartOfAccount } from "@/server/repositories/chart-of-accounts-repository";
import type { GlInquiryCursor, GlInquiryFilters, GlInquiryPage, GlTransaction, NormalBalance } from "@/server/general-ledger/types";

export class ValidationError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseGlInquiryFilters(params: URLSearchParams): GlInquiryFilters {
  const dateFrom = params.get("dateFrom");
  if (dateFrom && !DATE_RE.test(dateFrom)) throw new ValidationError(`Invalid dateFrom '${dateFrom}' — expected YYYY-MM-DD.`);
  const dateTo = params.get("dateTo");
  if (dateTo && !DATE_RE.test(dateTo)) throw new ValidationError(`Invalid dateTo '${dateTo}' — expected YYYY-MM-DD.`);

  const accountIdRaw = params.get("accountId");
  const accountId = accountIdRaw !== null ? Number(accountIdRaw) : null;
  if (accountId !== null && !Number.isInteger(accountId)) throw new ValidationError(`Invalid accountId '${accountIdRaw}'.`);

  const branchIdRaw = params.get("branchId");
  const branchId = branchIdRaw !== null ? Number(branchIdRaw) : null;
  if (branchId !== null && !Number.isInteger(branchId)) throw new ValidationError(`Invalid branchId '${branchIdRaw}'.`);

  const departmentIdRaw = params.get("departmentId");
  const departmentId = departmentIdRaw !== null ? Number(departmentIdRaw) : null;
  if (departmentId !== null && !Number.isInteger(departmentId)) throw new ValidationError(`Invalid departmentId '${departmentIdRaw}'.`);

  const costCentreIdRaw = params.get("costCentreId");
  const costCentreId = costCentreIdRaw !== null ? Number(costCentreIdRaw) : null;
  if (costCentreId !== null && !Number.isInteger(costCentreId)) throw new ValidationError(`Invalid costCentreId '${costCentreIdRaw}'.`);

  return {
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    accountId,
    reference: params.get("reference")?.trim() || null,
    search: params.get("search")?.trim() || null,
    branchId,
    departmentId,
    costCentreId,
    sourceType: params.get("sourceType")?.trim() || null,
  };
}

export function encodeGlCursor(cursor: GlInquiryCursor | null): string | null {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeGlCursor(raw: string | null): GlInquiryCursor | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
  } catch {
    throw new ValidationError("Invalid pagination cursor.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { id: unknown }).id !== "number" ||
    typeof (parsed as { postingDate: unknown }).postingDate !== "string"
  ) {
    throw new ValidationError("Invalid pagination cursor.");
  }
  return parsed as GlInquiryCursor;
}

/** Pure — unit tested. Walks `transactions` (assumed chronological
 * ascending) forward from `openingBalance`, signing each row's movement by
 * the account's own `normalBalance` (ported convention: a Debit-normal
 * account's balance rises with debits, a Credit-normal account's rises
 * with credits). */
export function computeRunningBalances(transactions: Pick<GlTransaction, "debit" | "credit">[], openingBalance: number, normalBalance: NormalBalance): number[] {
  let balance = openingBalance;
  const balances: number[] = [];
  for (const t of transactions) {
    const movement = normalBalance === "Debit" ? t.debit - t.credit : t.credit - t.debit;
    balance = Math.round((balance + movement) * 100) / 100;
    balances.push(balance);
  }
  return balances;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

export async function listGlTransactions(
  companyId: string,
  filters: GlInquiryFilters,
  cursorParam: string | null,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<GlInquiryPage> {
  const limit = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
  const cursor = decodeGlCursor(cursorParam);
  const { transactions, nextRawCursor, hasMore } = await repo.queryGlTransactions(companyId, filters, cursor, limit);

  let runningBalances: number[] | null = null;
  if (filters.accountId !== null && transactions.length > 0) {
    const account = await getChartOfAccount(companyId, filters.accountId);
    if (account) {
      // Results are in posting_date/id DESCENDING order — the oldest row
      // shown is the last element. Opening balance is "everything strictly
      // before that row's date"; same-date rows split across a page
      // boundary are a known, documented approximation (see
      // GlInquiryPage.runningBalances' own doc comment).
      const oldest = transactions[transactions.length - 1];
      const before = await repo.getAccountBalanceBefore(companyId, filters.accountId, oldest.postingDate);
      const openingBalance =
        account.normalBalance === "Debit" ? before.totalDebit - before.totalCredit : before.totalCredit - before.totalDebit;
      const ascending = [...transactions].reverse();
      runningBalances = computeRunningBalances(ascending, openingBalance, account.normalBalance).reverse();
    }
  }

  return { transactions, nextCursor: encodeGlCursor(nextRawCursor), hasMore, runningBalances };
}

/**
 * Bulk Unallocate Bank Transactions (migration 0119).
 *
 * PREVIEW -> SELECT -> CONFIRM -> EXECUTE, never straight to a change. The
 * execute step never trusts the preview: the database re-checks every row
 * under a lock (still in this company, in the range, on the chosen bank
 * account, still eligible, GL unchanged since the preview) and reports each
 * one as unallocated, skipped or failed. Nothing here posts, journals or
 * re-allocates anything.
 */

import * as repo from "@/server/repositories/bank-unallocation-repository";
import {
  MAX_UNALLOCATION_ROWS,
  isRequestKey,
  validateDateRange,
  type UnallocationPreview,
  type UnallocationRequest,
  type UnallocationResult,
  type UnpostingPreview,
  type UnpostingRequest,
  type UnpostingResult,
} from "@/server/banking/bulk-unallocation";

export class ValidationError extends Error {}
/** The same preview was already executed (double click, retry). */
export class DuplicateRunError extends Error {}
/** The database refused the caller (no Banking:Edit in this company). */
export class ForbiddenError extends Error {}

function parseBankAccountId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError("Choose a valid bank account.");
  return id;
}

/** Database refusals become typed errors; anything else is a real failure
 * and propagates unchanged. */
function translateDatabaseError(error: unknown, forbidden = "You do not have permission to unallocate bank transactions in this company."): never {
  const e = error as { code?: string; message?: string } | null;
  const message = e?.message ?? "";
  if (message.includes("PRECISIA_UNALLOCATION_DUPLICATE")) {
    throw new DuplicateRunError("This preview has already been executed. Preview again to start a new run.");
  }
  if (message.includes("PRECISIA_UNALLOCATION_INVALID")) {
    throw new ValidationError(message.replace(/^.*PRECISIA_UNALLOCATION_INVALID:\s*/, ""));
  }
  if (e?.code === "42501") throw new ForbiddenError(forbidden);
  throw error;
}

export async function previewUnallocation(
  companyId: string,
  input: { dateFrom?: unknown; dateTo?: unknown; bankAccountId?: unknown },
): Promise<UnallocationPreview> {
  const dateFrom = typeof input.dateFrom === "string" ? input.dateFrom : "";
  const dateTo = typeof input.dateTo === "string" ? input.dateTo : "";
  const rangeError = validateDateRange(dateFrom, dateTo);
  if (rangeError) throw new ValidationError(rangeError);
  const bankAccountId = parseBankAccountId(input.bankAccountId);

  let rows;
  try {
    // One more than the ceiling, so an over-large range is detected rather
    // than silently cut short.
    rows = await repo.previewBankUnallocation(companyId, dateFrom, dateTo, bankAccountId, MAX_UNALLOCATION_ROWS + 1);
  } catch (error) {
    translateDatabaseError(error);
  }
  return {
    dateFrom,
    dateTo,
    bankAccountId,
    candidates: rows.slice(0, MAX_UNALLOCATION_ROWS),
    truncated: rows.length > MAX_UNALLOCATION_ROWS,
  };
}

export function parseExecuteRequest(body: unknown): UnallocationRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isRequestKey(b.requestKey)) throw new ValidationError("This request has no preview key. Preview again.");
  const dateFrom = typeof b.dateFrom === "string" ? b.dateFrom : "";
  const dateTo = typeof b.dateTo === "string" ? b.dateTo : "";
  const rangeError = validateDateRange(dateFrom, dateTo);
  if (rangeError) throw new ValidationError(rangeError);
  if (!Array.isArray(b.items) || b.items.length === 0) throw new ValidationError("Select at least one transaction.");
  if (b.items.length > MAX_UNALLOCATION_ROWS) {
    throw new ValidationError(`At most ${MAX_UNALLOCATION_ROWS} transactions per run; narrow the date range.`);
  }
  const items = b.items.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const id = Number(item.id);
    if (!Number.isInteger(id) || id <= 0) throw new ValidationError("Every selected transaction needs a valid id.");
    return { id, glAccount: typeof item.glAccount === "string" ? item.glAccount : "" };
  });
  return { requestKey: b.requestKey, dateFrom, dateTo, bankAccountId: parseBankAccountId(b.bankAccountId), items };
}

export async function executeUnallocation(companyId: string, body: unknown): Promise<UnallocationResult> {
  const request = parseExecuteRequest(body);
  try {
    return await repo.executeBankUnallocation(companyId, request);
  } catch (error) {
    translateDatabaseError(error);
  }
}

// ---------------------------------------------------------------------
// Posted transactions — Bulk Unpost and Unallocate (migration 0120). Same
// PREVIEW -> SELECT -> CONFIRM -> EXECUTE discipline. The database reverses
// each journal whole, through PRECISIA's reversal-journal shape, dated at
// the original journal date, or reports why it did not.
// ---------------------------------------------------------------------

const UNPOST_FORBIDDEN = "Unposting bank transactions needs both the Banking Edit and the General Ledger Reverse permission in this company.";

export async function previewUnposting(
  companyId: string,
  input: { dateFrom?: unknown; dateTo?: unknown; bankAccountId?: unknown },
): Promise<UnpostingPreview> {
  const dateFrom = typeof input.dateFrom === "string" ? input.dateFrom : "";
  const dateTo = typeof input.dateTo === "string" ? input.dateTo : "";
  const rangeError = validateDateRange(dateFrom, dateTo);
  if (rangeError) throw new ValidationError(rangeError);
  const bankAccountId = parseBankAccountId(input.bankAccountId);

  let rows;
  try {
    rows = await repo.previewBankUnposting(companyId, dateFrom, dateTo, bankAccountId, MAX_UNALLOCATION_ROWS + 1);
  } catch (error) {
    translateDatabaseError(error, UNPOST_FORBIDDEN);
  }
  return {
    dateFrom,
    dateTo,
    bankAccountId,
    candidates: rows.slice(0, MAX_UNALLOCATION_ROWS),
    truncated: rows.length > MAX_UNALLOCATION_ROWS,
  };
}

function optionalId(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError("Every selected transaction needs valid allocation details. Preview again.");
  return id;
}

export function parseUnpostRequest(body: unknown): UnpostingRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isRequestKey(b.requestKey)) throw new ValidationError("This request has no preview key. Preview again.");
  const dateFrom = typeof b.dateFrom === "string" ? b.dateFrom : "";
  const dateTo = typeof b.dateTo === "string" ? b.dateTo : "";
  const rangeError = validateDateRange(dateFrom, dateTo);
  if (rangeError) throw new ValidationError(rangeError);
  if (!Array.isArray(b.items) || b.items.length === 0) throw new ValidationError("Select at least one transaction.");
  if (b.items.length > MAX_UNALLOCATION_ROWS) {
    throw new ValidationError(`At most ${MAX_UNALLOCATION_ROWS} transactions per run; narrow the date range.`);
  }
  const items = b.items.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const id = Number(item.id);
    const journalId = Number(item.journalId);
    if (!Number.isInteger(id) || id <= 0) throw new ValidationError("Every selected transaction needs a valid id.");
    if (!Number.isInteger(journalId) || journalId <= 0) throw new ValidationError("Every selected transaction needs the journal it was posted on. Preview again.");
    return {
      id,
      journalId,
      glAccount: typeof item.glAccount === "string" ? item.glAccount : "",
      customerId: optionalId(item.customerId),
      supplierId: optionalId(item.supplierId),
    };
  });
  return { requestKey: b.requestKey, dateFrom, dateTo, bankAccountId: parseBankAccountId(b.bankAccountId), items };
}

export async function executeUnposting(companyId: string, body: unknown): Promise<UnpostingResult> {
  const request = parseUnpostRequest(body);
  try {
    return await repo.executeBankUnposting(companyId, request);
  } catch (error) {
    translateDatabaseError(error, UNPOST_FORBIDDEN);
  }
}

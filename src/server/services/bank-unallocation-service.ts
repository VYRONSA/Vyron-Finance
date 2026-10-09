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
function translateDatabaseError(error: unknown): never {
  const e = error as { code?: string; message?: string } | null;
  const message = e?.message ?? "";
  if (message.includes("PRECISIA_UNALLOCATION_DUPLICATE")) {
    throw new DuplicateRunError("This preview has already been executed. Preview again to start a new run.");
  }
  if (message.includes("PRECISIA_UNALLOCATION_INVALID")) {
    throw new ValidationError(message.replace(/^.*PRECISIA_UNALLOCATION_INVALID:\s*/, ""));
  }
  if (e?.code === "42501") throw new ForbiddenError("You do not have permission to unallocate bank transactions in this company.");
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

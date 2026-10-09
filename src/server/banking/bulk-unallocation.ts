/**
 * Bulk Unallocate Bank Transactions (migration 0119) — shared types and the
 * pure checks both the route and the screen use. The database functions
 * (`fn_preview_bank_unallocation`, `fn_bulk_unallocate_bank_transactions`)
 * are the authority on eligibility; nothing here decides whether a
 * transaction may be unallocated.
 */

/** More than this in one range and the preview asks for a narrower one;
 * also the database's per-run ceiling. */
export const MAX_UNALLOCATION_ROWS = 5000;

export type UnallocationCandidate = {
  id: number;
  transactionDate: string;
  description: string;
  reference: string;
  /** Signed: money in positive, money out negative. */
  amount: number;
  bankAccountId: number | null;
  bankAccountName: string | null;
  allocationStatus: string;
  allocationMethod: string | null;
  glAccountCode: string | null;
  glAccountName: string | null;
  /** null = eligible; otherwise why this transaction will not be touched. */
  exclusionReason: string | null;
};

export type UnallocationPreview = {
  dateFrom: string;
  dateTo: string;
  bankAccountId: number | null;
  candidates: UnallocationCandidate[];
  /** The range holds more allocated transactions than one run may take. */
  truncated: boolean;
};

export type UnallocationItemOutcome = {
  transactionId: number;
  outcome: "unallocated" | "skipped" | "failed";
  reason: string;
  glAccount: string | null;
  glAccountName: string | null;
};

export type UnallocationResult = {
  runId: number;
  requested: number;
  unallocated: number;
  skipped: number;
  failed: number;
  items: UnallocationItemOutcome[];
};

export type UnallocationRequest = {
  requestKey: string;
  dateFrom: string;
  dateTo: string;
  bankAccountId: number | null;
  /** The GL each transaction showed in the preview; a row whose GL has
   * changed since is skipped by the database, not unallocated. */
  items: { id: number; glAccount: string }[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** null when the range is usable, otherwise the message to show. */
export function validateDateRange(dateFrom: string, dateTo: string): string | null {
  if (!dateFrom || !dateTo) return "Choose a From Date and a To Date.";
  if (!isRealDate(dateFrom) || !isRealDate(dateTo)) return "Dates must be real calendar dates (YYYY-MM-DD).";
  // ISO dates compare correctly as strings.
  if (dateFrom > dateTo) return "From Date cannot be later than To Date.";
  return null;
}

export function isRequestKey(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function sumAmounts(candidates: Pick<UnallocationCandidate, "amount">[]): number {
  // Cents, so a long list of 2-decimal amounts adds up exactly.
  return candidates.reduce((total, c) => total + Math.round(c.amount * 100), 0) / 100;
}

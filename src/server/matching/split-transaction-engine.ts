/**
 * Pure Split Transaction engine — no Supabase. "A single imported
 * transaction must support Multiple GL Accounts/Suppliers/Customers/VAT
 * codes/Projects/Cost Centres/Departments/Branches." Every split line
 * carries its own full dimensional set; the only invariant this file
 * enforces is the one that makes a split honest — the lines must sum to
 * exactly the transaction's own amount, or it isn't a split, it's a
 * fabrication.
 */

export type SplitLineInput = {
  amount: number;
  description: string;
  glAccount: string;
  vatCode?: string;
  supplierId?: number | null;
  customerId?: number | null;
  projectId?: number | null;
  costCentreId?: number | null;
  departmentId?: number | null;
  branchId?: number | null;
  inventoryItemId?: number | null;
};

export type SplitValidationResult = { ok: true } | { ok: false; reason: string };

const TOLERANCE = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Pure — a split is only valid if it has at least 2 lines (one line
 * isn't a split), every line has a positive amount and a GL account, and
 * the lines sum to exactly the transaction's own total. */
export function validateSplitLines(lines: SplitLineInput[], transactionAmount: number): SplitValidationResult {
  if (lines.length < 2) return { ok: false, reason: "A split needs at least 2 lines — one line is not a split." };
  for (const line of lines) {
    if (!line.amount || line.amount <= 0) return { ok: false, reason: "Every split line needs an amount greater than zero." };
    if (!line.glAccount?.trim()) return { ok: false, reason: "Every split line needs a GL account." };
  }
  const total = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const target = round2(transactionAmount);
  if (Math.abs(total - target) > TOLERANCE) {
    return { ok: false, reason: `Split lines total ${total} but the transaction is ${target} — they must sum exactly.` };
  }
  return { ok: true };
}

export type SplitJournalLine = { accountCode: string; debit: number; credit: number; description: string };

/** Pure — one GL-side journal line per split, still balanced against the
 * ONE bank-side line the caller supplies for the full transaction
 * amount. Reused by `journal-service.ts` rather than a second journal-
 * line builder — the split case is additive to the existing unsplit
 * path, not a fork of it. */
export function buildSplitGlLines(lines: SplitLineInput[], isPayment: boolean): SplitJournalLine[] {
  return lines.map((line) => ({
    accountCode: line.glAccount,
    debit: isPayment ? round2(line.amount) : 0,
    credit: isPayment ? 0 : round2(line.amount),
    description: line.description || "",
  }));
}

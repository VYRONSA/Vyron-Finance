/**
 * Pilot Review Round 1 — PDF Bank Statement Import, Product Review
 * Board's Final Outstanding Requirement. The first real, bank-specific
 * PDF parser, built against a genuine FNB "Platinum Business Account"
 * statement the Board supplied in-conversation (Northwood Management
 * Investments, account 62050837304, period 31 Jan – 28 Feb 2026).
 *
 * IMPORTANT — status is "implemented-unvalidated", not "validated": the
 * text this was built against is a rendered/OCR reconstruction of the
 * real PDF (via document ingestion in the review conversation), not the
 * output of this app's own `extractPdfText` (pdf-parse) run against the
 * actual file bytes. A real, concrete discrepancy was found while
 * building this — e.g. the row "03 Feb #Monthly Credit Fee 1,875.00
 * 1,324,355.87" loses its own description ("#Monthly Credit Fee") in
 * that rendering, visible only in the statement's image. That gap means
 * this parser cannot honestly be called "validated" until it's run
 * against the real PDF file through the real extraction pipeline — see
 * `REQUIRED_SAMPLE_STATEMENTS`. Built defensively (missing description
 * is tolerated, never crashes) precisely because of this known gap.
 *
 * Sign convention (derived, not assumed): this statement's own
 * "Turnover for Statement Period" summary was used to confirm it —
 * opening (1,229,915.14 Dr) + total credits (3,524,738.43) − total
 * debits (3,323,468.25) = 1,028,644.96, the statement's own printed
 * closing balance. So "Dr" is represented internally as a NEGATIVE
 * number (the customer's own overdrawn/liability position) and "Cr" as
 * positive — this is what makes `pdf-statement-validation.ts`'s
 * `reconcileStatementBalances` (opening + credits − debits = closing)
 * hold for an account that spends the whole period in overdraft, not a
 * sign flip applied arbitrarily. A transaction amount with a trailing
 * "Cr" is a credit (inflow, reduces the overdraft); with no suffix it's
 * a debit (outflow, grows the overdraft) — confirmed against multiple
 * real rows by checking the running balance moved by exactly that
 * amount in the expected direction.
 *
 * Known limitation, disclosed rather than silently assumed: the
 * per-transaction running "Balance" column in this statement format
 * never carries its own Dr/Cr marker (only the Opening/Closing Balance
 * summary lines do) — every row's balance is assumed to share the
 * statement's overall Dr/Cr sign throughout. A statement that crosses
 * from overdrawn to in-credit (or back) mid-period would need a real
 * sample to confirm whether FNB marks that transition inline; this
 * parser doesn't yet handle it.
 */

import type { BankStatementMetadata, ParsedBankTransaction } from "../types";

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

function parseAmount(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function toIso(year: number, month: number, day: number): string {
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
}

/** "31 January 2026" -> {day, month, year}. Full month names, unlike
 * transaction rows which use the 3-letter form. */
const FULL_MONTHS: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

export type FnbAccountHeader = { branchNumber: string; accountNumber: string; statementDate: string | null };

/** The "Branch Number Account Number Date" table that repeats at the
 * top and bottom of every page — the most reliable machine-readable
 * anchor in the whole document (unlike the free-text customer address
 * block), so used as the primary source for the account number. */
export function extractFnbAccountHeader(text: string): FnbAccountHeader | null {
  const match = text.match(/(\d{3})\s+(\d{9,12})\s+(\d{4}\/\d{2}\/\d{2})/);
  if (!match) return null;
  const [, branchNumber, accountNumber, dateRaw] = match;
  const [y, m, d] = dateRaw.split("/");
  return { branchNumber, accountNumber, statementDate: `${y}-${m}-${d}` };
}

export function extractFnbStatementMetadata(text: string): BankStatementMetadata {
  const header = extractFnbAccountHeader(text);

  const periodMatch = text.match(/Statement Period\s*:\s*(\d{1,2}) (\w+) (\d{4})\s+to\s+(\d{1,2}) (\w+) (\d{4})/i);
  let statementPeriodStart: string | null = null;
  let statementPeriodEnd: string | null = null;
  if (periodMatch) {
    const [, d1, m1, y1, d2, m2, y2] = periodMatch;
    const month1 = FULL_MONTHS[m1];
    const month2 = FULL_MONTHS[m2];
    if (month1 && month2) {
      statementPeriodStart = toIso(Number(y1), month1, Number(d1));
      statementPeriodEnd = toIso(Number(y2), month2, Number(d2));
    }
  }

  function signedBalance(label: "Opening Balance" | "Closing Balance"): number | null {
    const re = new RegExp(`${label}\\s+([\\d,]+\\.\\d{2})\\s*(Dr|Cr)?`, "i");
    const m = text.match(re);
    if (!m) return null;
    const amount = parseAmount(m[1]);
    return m[2]?.toLowerCase() === "dr" ? -amount : amount;
  }

  // The customer name block follows FNB's own "*NAME\nCONTINUATION"
  // convention (the leading "*" marks the start of the address block
  // on this statement type) — captured defensively, stopping before an
  // address-shaped line (P O Box / a postal code line) rather than
  // assuming a fixed number of lines, since a one-line vs. two-line
  // registered name is genuinely variable.
  let accountHolder: string | null = null;
  const nameMatch = text.match(/\*\s*([^\n]+)\n([^\n]*)/);
  if (nameMatch) {
    const first = nameMatch[1].trim();
    const second = nameMatch[2].trim();
    const looksLikeAddress = (line: string) => /^P[.\s]?O[.\s]?BOX|^\d+\s|^[A-Z]+\s+\d{4}$/i.test(line);
    accountHolder = !looksLikeAddress(second) && second.length > 0 && /^[A-Z]/.test(second) ? `${first} ${second}` : first;
  }

  return {
    accountHolder,
    accountNumber: header?.accountNumber ?? null,
    statementPeriodStart,
    statementPeriodEnd,
    openingBalance: signedBalance("Opening Balance"),
    closingBalance: signedBalance("Closing Balance"),
  };
}

export type FnbTurnoverSummary = { creditTransactionCount: number; creditTotal: number; debitTransactionCount: number; debitTotal: number };

/** The statement's own printed transaction-count/total footer — real,
 * machine-checkable ground truth this parser's own output can be cross-
 * checked against (see the "missing transactions" validation this
 * powers in `pdf-statement-validation.ts`). */
export function extractFnbTurnoverSummary(text: string): FnbTurnoverSummary | null {
  const creditMatch = text.match(/No\.\s*Credit\s*Transactions\s+(\d+)\s+([\d,]+\.\d{2})/i);
  const debitMatch = text.match(/No\.\s*Debit\s*Transactions\s+(\d+)\s+([\d,]+\.\d{2})/i);
  if (!creditMatch || !debitMatch) return null;
  return {
    creditTransactionCount: Number(creditMatch[1]),
    creditTotal: parseAmount(creditMatch[2]),
    debitTransactionCount: Number(debitMatch[1]),
    debitTotal: parseAmount(debitMatch[2]),
  };
}

// Two-stage match, not one regex: a single `(.*?)\s+(amount)\s+(balance)`
// pattern mis-parses a description-less row (a real case found in this
// exact statement — see module docstring) because `\s+` demands a space
// before the amount that doesn't exist when there's no description text
// to separate it from. Stage 1 only peels off the date; stage 2 finds
// the amount/balance from the END of the remainder, letting description
// be a true zero-width match when the row has none.
const DATE_PREFIX = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(.*)$/;
const TRAILING_AMOUNTS = /^(.*?)\s*([\d,]+\.\d{2})(Cr)?\s+([\d,]+\.\d{2})(Cr)?(?:\s+([\d,]+\.\d{2}))?$/;

/** Parses every line matching the transaction-row shape; every other
 * line (repeated page headers/footers, the turnover summary, balance
 * summary lines) simply doesn't match and is skipped — no separate
 * "is this a header line" detection needed. `statementPeriodStart`/`End`
 * resolve each row's year (and handle a period that spans a December→
 * January year boundary). */
export function extractFnbTransactions(
  text: string,
  accountNumber: string,
  statementPeriodStart: string,
  statementPeriodEnd: string,
  filename: string,
  importBatch: string,
  /** Sign to apply to every row's running balance, matching
   * `openingBalance`'s own sign convention (see module docstring) —
   * +1 when the statement opens in credit, -1 when it opens overdrawn
   * (Dr). Every row is assumed to share the statement's overall Dr/Cr
   * position throughout (see the module docstring's disclosed
   * limitation); defaults to +1 when unknown. */
  balanceSign: 1 | -1 = 1,
): ParsedBankTransaction[] {
  const startYear = Number(statementPeriodStart.slice(0, 4));
  const startMonth = Number(statementPeriodStart.slice(5, 7));
  const endYear = Number(statementPeriodEnd.slice(0, 4));

  const lines = text.split(/\r?\n/);
  const transactions: ParsedBankTransaction[] = [];
  let rowNumber = 0;

  for (const line of lines) {
    const dateMatch = line.trim().match(DATE_PREFIX);
    if (!dateMatch) continue;
    const [, dayRaw, monthAbbr, rest] = dateMatch;
    const amountsMatch = rest.match(TRAILING_AMOUNTS);
    if (!amountsMatch) continue;
    rowNumber++;

    const [, description, amountRaw, amountIsCredit, balanceRaw] = amountsMatch;
    const month = MONTHS[monthAbbr];
    // A period spanning a year boundary (e.g. Dec 2025 -> Jan 2026) needs
    // the earlier calendar month attributed to the later year once we've
    // moved past the start month; a same-year period just uses startYear.
    const year = month < startMonth ? endYear : startYear;

    const amount = parseAmount(amountRaw);
    const isCredit = Boolean(amountIsCredit);
    const balanceMagnitude = parseAmount(balanceRaw);

    transactions.push({
      transactionDate: toIso(year, month, Number(dayRaw)),
      reference: "",
      description: description.trim(),
      beneficiary: description.trim(),
      debit: isCredit ? 0 : amount,
      credit: isCredit ? amount : 0,
      // Known limitation (see module docstring): sign follows the
      // statement's overall Dr/Cr position, not a per-row marker.
      balance: balanceMagnitude * balanceSign,
      bankAccount: accountNumber,
      vat: null,
      glAccount: "",
      notes: "",
      sourceFilename: filename,
      importBatch,
      rowNumber,
    });
  }

  return transactions;
}

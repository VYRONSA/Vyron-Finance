/**
 * Pilot Review Round 1 — Final Certification round. FNB's second real
 * statement type, supplied by the Product Review Board alongside the
 * Platinum Business Account (current/cheque) sample this module's
 * sibling (`fnb-bank-statement-parser.ts`) was built against: a
 * "Business Credit Card" control-account statement (Northwood
 * Management Investments, control account 8812 7100 1280 6001,
 * statement 254, 09 April 2025). Genuinely different in kind, not just
 * layout — this is a multi-cardholder control account (several named
 * cardholders, each with their own card limit and sub-balance, rolling
 * up into one control-account Amount Owing), and critically has NO
 * per-transaction running balance column at all (only a per-card
 * "Balance Brought Forward"/"Card Total" and the control account's own
 * Opening/Closing figures) — confirmed against the real PDF bytes via
 * this app's own `extractPdfText`, not assumed.
 *
 * Two further real, confirmed (not assumed) extraction-order quirks in
 * this statement's own PDF, both worked around below rather than
 * guessed past:
 *   1. The page-1 letterhead's "Statement Date / Statement Number /
 *      Payment Due Date" LABELS extract as one contiguous block, and
 *      their VALUES as a separate later block ("09 April 2025" / "254"
 *      / "Page 1 of 6" / "14 April 2025") — a paint-order artifact of
 *      the source PDF, not a reading-order one. `HEADER_VALUES_BLOCK`
 *      below matches that specific value-only sequence positionally
 *      rather than by label adjacency.
 *   2. At least one cardholder's own card-number/limit header line is
 *      missing from the extracted text entirely (their name, Balance
 *      Brought Forward, and Card Total print, but not their card
 *      number line) — transactions are therefore attributed to
 *      whichever named cardholder most recently appeared in the text,
 *      not to a specific card number, since that's the only anchor
 *      reliably present for every cardholder.
 *
 * Sign convention: unlike the Platinum (cheque) statement, this
 * statement never marks its Balance Brought Forward/Amount Owing/
 * Closing Balance figures with a Dr/Cr suffix — they're printed as
 * plain positive "amount owed" figures throughout (a credit-card
 * control account has no overdrawn-vs-in-credit ambiguity the way a
 * cheque account does). Opening/closing balance are therefore stored
 * as positive numbers here, not negated — a genuinely different, but
 * equally real, convention from the sibling parser's Dr-is-negative one.
 *
 * No per-row running balance is printed for this statement type at
 * all, so every extracted transaction's `balance` is honestly `null`
 * (never fabricated by accumulating from Balance Brought Forward,
 * which this codebase's own "never derive what isn't printed"
 * precedent rules out). Statement Period is likewise never printed on
 * this statement (only a single Statement Date and Payment Due Date) —
 * left null rather than guessed from the transaction date range, which
 * means the existing same-period duplicate-statement check does not
 * yet apply to this statement type (disclosed, not silently dropped).
 */

import type { BankStatementMetadata, ParsedBankTransaction } from "../types";

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const FULL_MONTHS: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function parseAmount(raw: string): number {
  return Number(raw.replace(/,/g, "").replace(/\s/g, ""));
}

// This statement's own thousands separator is a plain space ("1 426.54",
// "35 413.88"), unlike the sibling Platinum statement's comma — confirmed
// against the real PDF bytes, not assumed. A bare `[\d,]+\.\d{2}` class
// (the sibling parser's pattern) silently truncates these to "426.54",
// leaving the stray "1"/leading digit group attached to the description
// — a real, confirmed bug fixed here, not a hypothetical one. Matches
// digit groups of 1-3 optionally repeated with a comma-or-space
// separator, e.g. "0.00", "336.48", "1 426.54", "35 413.88".
const AMOUNT = String.raw`\d{1,3}(?:[,\s]\d{3})*\.\d{2}`;

function toIso(year: number, month: number, day: number): string {
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
}

/** "09 April 2025" -> ISO. Full month name, unlike transaction rows'
 * 3-letter abbreviation. */
function parseFullDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2}) (\w+) (\d{4})$/);
  if (!m) return null;
  const month = FULL_MONTHS[m[2]];
  if (!month) return null;
  return toIso(Number(m[3]), month, Number(m[1]));
}

export type FnbCreditCardMetadataExtra = {
  statementDate: string | null;
  paymentDueDate: string | null;
};

export function extractFnbCreditCardMetadata(text: string): BankStatementMetadata & FnbCreditCardMetadataExtra {
  // Point 1 in the module docstring — the value-only block, matched
  // positionally since it isn't adjacent to its own labels in the text.
  const headerValuesMatch = text.match(/(\d{1,2} \w+ \d{4})\s*\n(\d+)\s*\nPage \d+ of \d+\s*\n(\d{1,2} \w+ \d{4})/);
  const statementDate = headerValuesMatch ? parseFullDate(headerValuesMatch[1]) : null;
  const statementNumber = headerValuesMatch ? headerValuesMatch[2] : null;
  const paymentDueDate = headerValuesMatch ? parseFullDate(headerValuesMatch[3]) : null;

  // The control account number — "Business Card Account NNNN NNNN NNNN
  // NNNN" is the self-labelled anchor repeated on every transaction
  // page, more reliable than the unlabelled standalone occurrence on
  // page 1.
  const accountMatch = text.match(/Business Card Account\s+(\d{4}\s\d{4}\s\d{4}\s\d{4})/);
  const accountNumber = accountMatch ? accountMatch[1].replace(/\s/g, "") : null;

  // Account-holder block — this statement type has no "*NAME" marker
  // (unlike the Platinum/cheque statement); the registered name is
  // simply the first line, and its continuation line is only real when
  // it doesn't look like the start of the address block that follows.
  const lines = text.split(/\r?\n/);
  let accountHolder: string | null = null;
  if (lines.length > 0) {
    const first = lines[0].trim();
    const second = (lines[1] ?? "").trim();
    const looksLikeAddress = (line: string) => /^P[.\s]?O[.\s]?BOX|^\d+\s|^[A-Z]+\s+\d{4}$/i.test(line);
    accountHolder = !looksLikeAddress(second) && second.length > 0 && /^[A-Z]/.test(second) ? `${first} ${second}` : first;
  }

  // Opening/closing balance — see module docstring's sign-convention
  // note (positive throughout, no Dr/Cr marker on this statement type).
  const openingMatch = text.match(new RegExp(`Balance Brought Forward\\s+(${AMOUNT})`));
  const openingBalance = openingMatch ? parseAmount(openingMatch[1]) : null;
  // Prefer the explicit final "Closing Balance" label; fall back to the
  // page-1 "Amount Owing" figure (the same value, differently labelled)
  // if the statement's own layout ever omits the former.
  const closingMatch = text.match(new RegExp(`Closing Balance\\s+(${AMOUNT})`)) ?? text.match(new RegExp(`Amount Owing\\s+(${AMOUNT})`));
  const closingBalance = closingMatch ? parseAmount(closingMatch[1]) : null;

  const creditLimitMatch = text.match(new RegExp(`Credit Limit\\s+(${AMOUNT})`));
  const creditLimit = creditLimitMatch ? parseAmount(creditLimitMatch[1]) : null;

  // "Credit Balance" is this statement's own term for funds available
  // in credit on the control account — the closest real analogue to
  // "Available Balance" this statement actually prints (disclosed
  // mapping, not assumed equivalence).
  const availableMatch = text.match(new RegExp(`Credit Balance\\s+(${AMOUNT})\\s*(Cr)?`, "i"));
  const availableBalance = availableMatch ? parseAmount(availableMatch[1]) : null;

  const vatMatch = text.match(new RegExp(`Vat on Fees\\s+(${AMOUNT})`, "i"));
  const vat = vatMatch ? parseAmount(vatMatch[1]) : null;
  // No separate aggregate "Fees" figure is printed on this statement
  // type beyond VAT on Fees itself — left equal to `vat` would be
  // misleading (they're not the same concept), so left null rather
  // than fabricated from a total that isn't printed.
  const fees = null;

  const purchaseRateMatch = text.match(/Purchases\s+([\d.]+%)/);
  const cashRateMatch = text.match(/Cash\s+([\d.]+%)/);
  const petrolRateMatch = text.match(/Petrol\s+([\d.]+%)/);
  const interestParts: string[] = [];
  if (purchaseRateMatch) interestParts.push(`Purchases: ${purchaseRateMatch[1]}`);
  if (cashRateMatch) interestParts.push(`Cash: ${cashRateMatch[1]}`);
  if (petrolRateMatch) interestParts.push(`Petrol: ${petrolRateMatch[1]}`);
  const interestSummary = interestParts.length > 0 ? interestParts.join("; ") : null;

  return {
    accountHolder,
    accountNumber,
    // Never printed on this statement type — see module docstring.
    statementPeriodStart: null,
    statementPeriodEnd: null,
    openingBalance,
    closingBalance,
    statementNumber,
    creditLimit,
    availableBalance,
    interestSummary,
    vat,
    fees,
    statementDate,
    paymentDueDate,
  };
}

const DATE_PREFIX = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(.*)$/;
// No running-balance column on this statement type (see module
// docstring) — the trailing token is always just the amount, optionally
// "Cr"-suffixed; everything before it is the description.
const TRAILING_AMOUNT_ONLY = new RegExp(`^(.*?)\\s*(${AMOUNT})\\s*(Cr)?$`);

/** A row whose whole description is exactly "Balance Transferred" is an
 * internal consolidation entry moving a card's own sub-balance into the
 * control account total, not a real third-party transaction — confirmed
 * (not assumed) against the real statement: this statement also prints
 * a second, later summary block re-listing the exact same 5 transferred
 * amounts one more time, this time labelled by cardholder name instead
 * of "Balance Transferred" (e.g. "09 Apr Christopher C Beagr 22,935.27"
 * — the same figure as an earlier "09 Apr Balance Transferred 22,935.27
 * Cr" row, for the same card). Including either form once is correct;
 * including both is a real duplicate the Board's certification
 * explicitly checks for — `transferredAmounts` (populated as each
 * "Balance Transferred" row is excluded) is what lets the second,
 * name-labelled occurrence be recognised and excluded too. */
function isInternalConsolidationRow(description: string): boolean {
  return /^Balance Transferred$/i.test(description.trim());
}

/** Cardholder-name line: distinguished from every other non-transaction
 * line in this statement by NOT matching any of the label lines this
 * layout repeats ("Balance Brought Forward", "Card Total", the masked
 * card-number/limit line, page furniture) and by looking like a human
 * name (Title-Case words, no digits). Best-effort, per the module
 * docstring's point 2 — used only to label rows, never to gate
 * extraction. */
const NAME_LINE = /^[A-Z][a-zA-Z.'-]*(\s[A-Z][a-zA-Z.'-]*)+$/;
const NOISE_LINE = /^(Balance Brought Forward|Card Total|Tran|Date Transaction Details Credit|Facility|Budget|Items marked #|Business Card Account|Closing Balance)/i;

export type FnbCreditCardTurnoverSummary = { creditTransactionCount: number; creditTotal: number; debitTransactionCount: number; debitTotal: number };

/** The statement's own printed "Turnover for Statement Period" footer —
 * ground truth this parser's own row count is cross-checked against,
 * same role as the sibling cheque parser's turnover check. */
export function extractFnbCreditCardTurnoverSummary(text: string): FnbCreditCardTurnoverSummary | null {
  const creditMatch = text.match(new RegExp(`No\\.\\s*Credit\\s*Transactions\\s+(\\d+)\\s+(${AMOUNT})`, "i"));
  const debitMatch = text.match(new RegExp(`No\\.\\s*Debit\\s*Transactions\\s+(\\d+)\\s+(${AMOUNT})`, "i"));
  if (!creditMatch || !debitMatch) return null;
  return {
    creditTransactionCount: Number(creditMatch[1]),
    creditTotal: parseAmount(creditMatch[2]),
    debitTransactionCount: Number(debitMatch[1]),
    debitTotal: parseAmount(debitMatch[2]),
  };
}

export function extractFnbCreditCardTransactions(
  text: string,
  accountNumber: string,
  filename: string,
  importBatch: string,
): ParsedBankTransaction[] {
  const lines = text.split(/\r?\n/);
  const transactions: ParsedBankTransaction[] = [];
  // A statement spanning a Dec->Jan boundary would need real disambiguation
  // this parser doesn't yet attempt (no sample crossing a year boundary
  // has been supplied) — every row is attributed to the statement date's
  // own year, disclosed rather than silently assumed to always be right.
  const headerMatch = text.match(/(\d{1,2} \w+ \d{4})\s*\n(\d+)\s*\nPage \d+ of \d+\s*\n(\d{1,2} \w+ \d{4})/);
  const statementYear = headerMatch ? Number(headerMatch[1].match(/\d{4}$/)?.[0]) : new Date().getUTCFullYear();

  let currentCardholder = "";
  let rowNumber = 0;
  const transferredAmounts = new Set<number>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (NAME_LINE.test(line) && !NOISE_LINE.test(line)) {
      currentCardholder = line;
      continue;
    }

    const dateMatch = line.match(DATE_PREFIX);
    if (!dateMatch) continue;
    const [, dayRaw, monthAbbr, rest] = dateMatch;
    const amountMatch = rest.match(TRAILING_AMOUNT_ONLY);
    if (!amountMatch) continue;

    const [, descriptionRaw, amountRaw, creditFlag] = amountMatch;
    // The source PDF renders "merchant" and "location"/"reference" as
    // separate table columns joined by a raw tab in extracted text —
    // collapsed into one readable description (never split into a
    // second field: see module docstring on why `reference` stays "",
    // matching the sibling cheque parser's own precedent).
    const description = descriptionRaw.trim().replace(/\s*\t+\s*/g, " - ");
    const amount = parseAmount(amountRaw);

    if (isInternalConsolidationRow(description)) {
      transferredAmounts.add(amount);
      continue;
    }
    // The later name-labelled re-statement of the same transferred
    // amounts (see `isInternalConsolidationRow`'s docstring) — a
    // description matching NAME_LINE with no location/reference field
    // and an amount already seen as a "Balance Transferred" row.
    if (NAME_LINE.test(description) && transferredAmounts.has(amount)) continue;

    const month = MONTHS[monthAbbr];
    if (!month) continue;
    rowNumber++;

    const isCredit = Boolean(creditFlag);

    transactions.push({
      transactionDate: toIso(statementYear, month, Number(dayRaw)),
      reference: "",
      description,
      beneficiary: currentCardholder ? `${description} (${currentCardholder})` : description,
      debit: isCredit ? 0 : amount,
      credit: isCredit ? amount : 0,
      // No per-row running balance is printed on this statement type —
      // see module docstring. Never derived/guessed.
      balance: null,
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

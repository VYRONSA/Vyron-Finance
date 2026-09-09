/**
 * Xero Client Import — "Account Transactions by date" .xlsx parser.
 * Xero's own report export shape (confirmed by reading the real file):
 * ONE worksheet, containing one section PER BANK ACCOUNT, each delimited
 * by a row whose first cell is the account name prefixed " - " (Xero's
 * own report-section convention when the account has no code), an
 * "Opening Balance" row, N transaction rows (Date, Contact, Source,
 * Reference, Debit, Credit, Running Balance, Gross, Tax, Related
 * Account), a "Total <account>" subtotal row, a "Closing Balance" row,
 * and a blank separator row before the next section. A single caller
 * file can therefore represent MULTIPLE real bank accounts — this
 * parser returns one group per account, not one flat transaction list.
 */
import ExcelJS from "exceljs";

/**
 * `moneyIn`/`moneyOut` rather than `debit`/`credit` — deliberately, and
 * not cosmetically.
 *
 * Xero's report states Debit/Credit from the BANK ACCOUNT's own ledger
 * perspective, where the bank is an asset: its Debit column is money
 * arriving, its Credit column is money leaving. VYRON's
 * `ae_bank_transactions` uses the opposite, cashbook convention — `debit`
 * is a payment out, `credit` is a receipt in (see
 * `cashbook-service.ts::captureCashbookReceipt`, which writes a receipt
 * to `credit`, and `journal-service.ts::buildJournalLinesForTransaction`,
 * which credits the bank for a row with a `debit`).
 *
 * Those two conventions are exact opposites, and this parser previously
 * carried Xero's column names straight through to fields with VYRON's
 * meaning. Every one of the 480 rows in the live Metanoia Hospitality /
 * New Handcrafted Food Products migration is inverted as a result: all
 * 108 "Receivable Payment" and 107 "Receivable Overpayment" rows (money
 * arriving) sit in `debit`, and all 145 "Spend Money", 42 "Payable
 * Payment" and 77 "Payable Overpayment" rows (money leaving) sit in
 * `credit`. Posting those to the ledger would credit the bank for every
 * customer receipt and debit it for every supplier payment.
 *
 * Naming the fields for the direction of the money — which is
 * unambiguous, and identical in both conventions — is what stops the
 * mapping being got wrong again at the next call site.
 */
export type XeroBankTxnRow = {
  date: string;
  contact: string;
  source: string;
  reference: string;
  /** Xero's Debit column: money INTO the bank account. */
  moneyIn: number;
  /** Xero's Credit column: money OUT of the bank account. */
  moneyOut: number;
  gross: number;
  tax: number;
  relatedAccount: string;
  rowNumber: number;
};

export type XeroBankAccountSection = {
  accountName: string;
  openingBalance: number;
  closingBalance: number;
  transactions: XeroBankTxnRow[];
};

export type XeroBankTransactionsParseResult = {
  accounts: XeroBankAccountSection[];
  skipped: { rowNumber: number; reason: string }[];
};

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return null;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "result" in (value as Record<string, unknown>)) {
    const result = (value as { result?: unknown }).result;
    return typeof result === "number" ? result : 0;
  }
  return 0;
}

function toText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export async function parseXeroBankTransactionsXlsx(buffer: Buffer | ArrayBuffer, sourceFilename: string): Promise<XeroBankTransactionsParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  const skipped: XeroBankTransactionsParseResult["skipped"] = [];
  const accounts: XeroBankAccountSection[] = [];
  if (!sheet) {
    skipped.push({ rowNumber: 0, reason: `${sourceFilename}: no worksheet found.` });
    return { accounts, skipped };
  }

  let current: XeroBankAccountSection | null = null;

  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => cells.push(cell.value));
    if (cells.length === 0 || cells.every((c) => c == null)) continue;

    const first = cells[0];
    const firstText = toText(first);

    // New account section — a row whose only populated cell is a label
    // starting with " - " (Xero's report-section header convention).
    if (typeof first === "string" && first.trim().startsWith("-") && cells.slice(1).every((c) => c == null)) {
      current = { accountName: first.replace(/^\s*-\s*/, "").trim(), openingBalance: 0, closingBalance: 0, transactions: [] };
      accounts.push(current);
      continue;
    }

    if (!current) continue; // report title/period/header rows before the first section

    // moneyIn - moneyOut: the bank account's balance as an asset, which
    // is what `ae_bank_accounts.opening_balance` holds. Unchanged by the
    // moneyIn/moneyOut rename — this arithmetic was always right.
    if (firstText === "Opening Balance") {
      current.openingBalance = toNumber(cells[4]) - toNumber(cells[5]);
      continue;
    }
    if (firstText === "Closing Balance") {
      current.closingBalance = toNumber(cells[4]) - toNumber(cells[5]);
      continue;
    }
    if (firstText.startsWith("Total")) continue; // subtotal row
    if (firstText === "" && cells.slice(1).every((c) => c == null)) continue; // blank separator row

    const date = toIsoDate(first);
    if (!date) {
      skipped.push({ rowNumber: r, reason: `Unrecognised row in section "${current.accountName}" (first cell: "${firstText}").` });
      continue;
    }

    current.transactions.push({
      date,
      contact: toText(cells[1]),
      source: toText(cells[2]),
      reference: toText(cells[3]),
      moneyIn: toNumber(cells[4]),
      moneyOut: toNumber(cells[5]),
      gross: toNumber(cells[7]),
      tax: toNumber(cells[8]),
      relatedAccount: toText(cells[9]),
      rowNumber: r,
    });
  }

  return { accounts, skipped };
}

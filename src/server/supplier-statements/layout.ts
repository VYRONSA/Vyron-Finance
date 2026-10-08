/**
 * SD-3C — reading a supplier statement from the POSITIONS of its text.
 *
 * Supplier statements are not one format. This does not keep a template per
 * supplier; it reads the page the way a person does:
 *
 *   1. text pieces at the same height form a ROW; pieces close together in a
 *      row form a CELL;
 *   2. a row whose cells are column headings ("Date", "Reference", "Debit",
 *      "Credit", "Balance", …) defines the table's COLUMNS by their x-range;
 *      a repeated heading on a later page re-anchors them, and a later page
 *      with no heading inherits them;
 *   3. each row under it is classified: a transaction, a wrapped description
 *      line, brought/carried forward, a page or sub-total, the statement
 *      totals, or the closing balance;
 *   4. header facts (account number, statement date, VAT number, period) are
 *      read from labelled cells; the supplier's name from the letterhead —
 *      always as a PROPOSAL.
 *
 * SD-3G (production UAT, a real supplier's statement) also handles: credits
 * printed with a minus sign in the Credit column when the whole statement
 * does so; an ageing block with "90+ Days", "Overdue" and "Total Due" whose
 * values sit beneath the headings (on any page; never read as transactions);
 * monthly subtotal rows ("Total: October 2026 …"), which are not the
 * statement's totals; a bare "Date" label in the header; and a letterhead
 * whose largest line is a telephone number.
 *
 * What it never does: guess. An amount or date it cannot read reliably is
 * left empty, its raw text kept, and the field marked unresolved for a
 * reviewer. A line's type is never decided from the sign of its amount.
 * When no table can be found, it says so and extracts nothing.
 *
 * Pure: it takes positioned tokens (from `extractPdfLayout`) and returns a
 * `StatementExtraction`. No I/O, no AI.
 */

import {
  inferDecimalStyle,
  looksLikeDate,
  looksLikeMoney,
  parseStatementAmount,
  parseStatementDate,
  type DecimalStyle,
} from "./amounts";
import {
  EMPTY_HEADER,
  type ExclusionReason,
  type ExtractedStatementLine,
  type PrintedAgeing,
  type StatementExtraction,
  type StatementHeader,
  type StatementTransactionType,
  type UnresolvedField,
} from "./types";

/** A positioned piece of text. `y` is the BASELINE measured from the TOP of
 * the page; `height` is the font size. */
export type LayoutToken = { text: string; x: number; y: number; width: number; height: number };
export type LayoutPage = { pageNumber: number; width: number; height: number; tokens: LayoutToken[] };

type Cell = { text: string; x0: number; x1: number; y: number; height: number };
type Row = { pageNumber: number; rowOnPage: number; y: number; height: number; cells: Cell[]; text: string };

type Role = "date" | "reference" | "description" | "type" | "debit" | "credit" | "amount" | "balance" | "extra";
type Column = { role: Role; x0: number; x1: number; left: number; right: number };

// ---------------------------------------------------------------------
// 1. Rows and cells
// ---------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function buildRows(page: LayoutPage): Row[] {
  const tokens = page.tokens.filter((t) => t.text.trim() !== "");
  if (tokens.length === 0) return [];
  const tol = Math.max(2, median(tokens.map((t) => t.height)) * 0.45);
  const sorted = [...tokens].sort((a, b) => a.y - b.y || a.x - b.x);

  const groups: LayoutToken[][] = [];
  for (const token of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(token.y - last[0].y) <= tol) last.push(token);
    else groups.push([token]);
  }

  return groups.map((group, index) => {
    const ordered = [...group].sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    for (const token of ordered) {
      const prev = cells[cells.length - 1];
      const gap = prev ? token.x - prev.x1 : Infinity;
      const joinGap = Math.max(1.5, token.height * 0.6);
      if (prev && gap <= joinGap) {
        prev.text += gap > token.height * 0.12 ? ` ${token.text}` : token.text;
        prev.x1 = Math.max(prev.x1, token.x + token.width);
        prev.height = Math.max(prev.height, token.height);
      } else {
        cells.push({ text: token.text, x0: token.x, x1: token.x + token.width, y: token.y, height: token.height });
      }
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
    const kept = cells.filter((c) => c.text !== "");
    return {
      pageNumber: page.pageNumber,
      rowOnPage: index + 1,
      y: median(group.map((t) => t.y)),
      height: Math.max(...group.map((t) => t.height)),
      cells: kept,
      text: kept.map((c) => c.text).join("  "),
    };
  }).filter((r) => r.cells.length > 0);
}

// ---------------------------------------------------------------------
// 2. Column headings
// ---------------------------------------------------------------------

function headingKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9/ +]/g, " ").replace(/\s+/g, " ").trim();
}

const ROLE_PATTERNS: [Role, RegExp][] = [
  ["date", /^(date|txn date|trans date|transaction date|doc date|document date|inv date|invoice date)$/],
  ["type", /^(type|trans type|transaction type|doc type|document type|tx type)$/],
  ["reference", /^(ref|reference|doc|doc no|document|document no|document number|inv no|invoice no|invoice number|invoice|our ref|reference no|ref no|transaction no|tran no|number|no)$/],
  ["description", /^(description|details|particulars|narrative|transaction|memo|transaction details)$/],
  ["debit", /^(debit|debits|dr|charges|invoices|debit amount|debit r|debits r)$/],
  ["credit", /^(credit|credits|cr|payments|receipts|credit amount|payments\/credits|credits\/payments|credit r|credits r)$/],
  ["amount", /^(amount|value|amount r|amount zar|transaction amount|amt)$/],
  ["balance", /^(balance|running balance|bal|balance r|cumulative balance|outstanding|running total)$/],
];

function roleOf(text: string): Role | null {
  const key = headingKey(text);
  for (const [role, pattern] of ROLE_PATTERNS) if (pattern.test(key)) return role;
  return null;
}

/** A row is the table's heading when it names a date column and at least
 * one money column among three or more recognised headings. */
function detectHeading(row: Row): Column[] | null {
  const roles = row.cells.map((c) => roleOf(c.text));
  const recognised = roles.filter((r) => r !== null);
  if (recognised.length < 3) return null;
  if (!roles.includes("date")) return null;
  if (!roles.some((r) => r === "debit" || r === "credit" || r === "amount" || r === "balance")) return null;

  const seen = new Set<Role>();
  const columns: Column[] = row.cells.map((cell, i) => {
    let role: Role = roles[i] ?? "extra";
    if (role !== "extra" && seen.has(role)) role = "extra";
    seen.add(role);
    return { role, x0: cell.x0, x1: cell.x1, left: 0, right: 0 };
  });
  columns.sort((a, b) => a.x0 - b.x0);
  columns.forEach((col, i) => {
    col.left = i === 0 ? -Infinity : (columns[i - 1].x1 + col.x0) / 2;
    col.right = i === columns.length - 1 ? Infinity : (col.x1 + columns[i + 1].x0) / 2;
  });
  return columns;
}

const NUMERIC_ROLES: ReadonlySet<Role> = new Set(["debit", "credit", "amount", "balance"]);

/** Which column a cell belongs to. Money aligns with its heading's edge or
 * centre (statements right-align amounts); text by overlap. */
function columnFor(cell: Cell, columns: Column[]): Column | null {
  if (looksLikeMoney(cell.text)) {
    let best: Column | null = null;
    let bestDistance = Infinity;
    for (const col of columns) {
      if (!NUMERIC_ROLES.has(col.role)) continue;
      const distance = Math.min(
        Math.abs(cell.x1 - col.x1),
        Math.abs(cell.x0 - col.x0),
        Math.abs((cell.x0 + cell.x1) / 2 - (col.x0 + col.x1) / 2),
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = col;
      }
    }
    if (best && bestDistance <= Math.max(40, (best.x1 - best.x0) * 2)) return best;
  }
  let best: Column | null = null;
  let bestOverlap = 0;
  for (const col of columns) {
    const overlap = Math.min(cell.x1, col.right) - Math.max(cell.x0, col.left);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = col;
    }
  }
  return best;
}

type Mapped = Partial<Record<Role, string>>;

function mapRow(row: Row, columns: Column[]): Mapped {
  const mapped: Mapped = {};
  for (const cell of row.cells) {
    const col = columnFor(cell, columns);
    const role = col?.role ?? "extra";
    mapped[role] = mapped[role] ? `${mapped[role]} ${cell.text}` : cell.text;
  }
  return mapped;
}

// ---------------------------------------------------------------------
// 3. Row kinds
// ---------------------------------------------------------------------

const BROUGHT_FORWARD = /\b(balance\s*(b\/f|bf|brought\s*forward|forward)|brought\s*forward|b\/f|bal\s*b\/f|opening\s*balance)\b/i;
const CARRIED_FORWARD = /\b(c\/f|carried\s*forward|balance\s*c\/f)\b/i;
const PAGE_TOTAL = /\bpage\s*totals?\b/i;
const SUBTOTAL = /\bsub-?\s*totals?\b/i;
const STATEMENT_TOTAL = /^\s*(totals?|statement\s*totals?)\b/i;
/** "Total: October 2026", "Totals for Sep 2026", "Total 01/09/2026 - 30/09/2026": a
 * PERIOD subtotal within the statement, not the statement's own totals. */
const PERIOD_SUBTOTAL =
  /^\s*totals?\s*:?\s*(for\s+)?((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}[/.-]\d{1,2}([/.-]\d{1,2})?)\b/i;
const CLOSING = /\b(closing\s*balance|balance\s*due|amount\s*due|total\s*due|balance\s*owing|amount\s*owing|total\s*outstanding|account\s*balance|amount\s*payable)\b/i;
const AGEING_LABEL =
  /^(current|30\s*days?|60\s*days?|90\s*days?|90\s*\+\s*days?|90\s*days?\s*\+|over\s*90\s*days?|90\+|120\s*\+?\s*days?|120\s*days?\s*\+|over\s*120\s*days?|120\+|150\+?\s*days?|overdue|total\s*overdue|total|totals?\s*due|amount\s*due|balance\s*due)$/i;

function lastMoney(row: Row): string | null {
  const money = row.cells.filter((c) => looksLikeMoney(c.text));
  if (money.length > 0) return money[money.length - 1].text;
  const numbers = row.cells.filter((c) => /^\(?-?\s*(R\s*)?[0-9][0-9 .,']*\)?-?(\s*(CR|DR))?$/i.test(c.text.trim()));
  return numbers.length > 0 ? numbers[numbers.length - 1].text : null;
}

// ---------------------------------------------------------------------
// 4. Types
// ---------------------------------------------------------------------

const TYPE_CODES: [RegExp, StatementTransactionType][] = [
  [/^(inv|in|tax inv|tax invoice|invoice|tinv)$/i, "invoice"],
  [/^(cn|crn|cr note|credit note|c\/n|ccn)$/i, "credit-note"],
  [/^(dn|drn|dr note|debit note|d\/n)$/i, "debit-note"],
  [/^(pmt|pay|payment|rct|rcpt|receipt|eft|dep|deposit|py)$/i, "payment"],
  [/^(int|interest)$/i, "interest"],
  [/^(jnl|jn|journal|adj|adjustment)$/i, "adjustment"],
];

const TYPE_WORDS: [RegExp, StatementTransactionType][] = [
  [/\bcredit\s*note\b|\bc\/n\b/i, "credit-note"],
  [/\bdebit\s*note\b/i, "debit-note"],
  [/\b(tax\s*)?invoice\b/i, "invoice"],
  // "Unapplied cash": a receipt not yet allocated to an invoice — a payment.
  [/\b(payment|receipt|eft|deposit|paid|remittance)\b|\bunapplied\s+cash\b|\bcash\s+(received|receipt)\b/i, "payment"],
  [/\binterest\b/i, "interest"],
  [/\b(journal|adjustment)\b/i, "adjustment"],
];

const REFERENCE_PREFIX: [RegExp, StatementTransactionType][] = [
  [/^(INV|IN|TI)[-\s/]?\d/i, "invoice"],
  [/^(CN|CRN)[-\s/]?\d/i, "credit-note"],
  [/^(DN)[-\s/]?\d/i, "debit-note"],
  [/^(PMT|PAY|RCT|RCPT|EFT)[-\s/]?\d/i, "payment"],
  [/^(JNL)[-\s/]?\d/i, "adjustment"],
];

export function inferTransactionType(
  typeText: string | null,
  reference: string | null,
  description: string | null,
): { type: StatementTransactionType; source: "printed" | "inferred" } {
  if (typeText) {
    const code = typeText.trim();
    for (const [pattern, type] of TYPE_CODES) if (pattern.test(code)) return { type, source: "printed" };
  }
  if (reference) {
    for (const [pattern, type] of REFERENCE_PREFIX) if (pattern.test(reference.trim())) return { type, source: "inferred" };
  }
  if (description) {
    for (const [pattern, type] of TYPE_WORDS) if (pattern.test(description)) return { type, source: "inferred" };
  }
  // Never from the sign of the amount: a credit is a credit note OR a
  // payment, and only the document (or a reviewer) can say which.
  return { type: "unknown", source: "inferred" };
}

// ---------------------------------------------------------------------
// 5. Header facts
// ---------------------------------------------------------------------

type LabelField = "account" | "statementDate" | "vat" | "registration" | "period" | "currency" | "opening" | "closing";
/** `anywhere`: the label may follow other text in its cell. `headerOnly`:
 * only above the transaction table (a bare "Date" is also a column heading). */
type LabelRule = { field: LabelField; pattern: RegExp; anywhere?: boolean; headerOnly?: boolean };

/** Matched against the cell's NORMALISED text (dotted abbreviations closed up:
 * "V.A.T. REG. No." → "VAT REG. No."). */
const LABELS: LabelRule[] = [
  { field: "account", pattern: /^(?:our\s+)?(?:acc(?:ount)?|customer|debtor|client)\.?\s*(?:no|number|code|#|ref(?:erence)?)\.?\s*:?\s*(.*)$/i },
  { field: "statementDate", pattern: /^(?:statement\s*date|date\s*of\s*statement|as\s*at(?:\s*date)?)\s*:?\s*(.*)$/i },
  { field: "statementDate", pattern: /\b(?:statement\s*date|date\s*of\s*statement)\s*:?\s*(.*)$/i, anywhere: true },
  { field: "statementDate", pattern: /^date\s*:?\s*(.*)$/i, headerOnly: true },
  { field: "vat", pattern: /^vat\s*(?:reg(?:istration)?\.?)?\s*(?:no|number)?\.?\s*:?\s*(.*)$/i },
  { field: "registration", pattern: /^(?:co(?:mpany)?\.?\s*)?reg(?:istration)?\.?\s*(?:no|number)\.?\s*:?\s*(.*)$/i },
  { field: "period", pattern: /^(?:statement\s*)?(?:period|for\s*the\s*period)\s*:?\s*(.*)$/i },
  { field: "currency", pattern: /^currency\s*:?\s*(.*)$/i },
  { field: "opening", pattern: /^(?:opening\s*balance|balance\s*b\/f|balance\s*brought\s*forward)\s*:?\s*(.*)$/i },
  { field: "closing", pattern: /^(?:closing\s*balance|balance\s*due|amount\s*due|total\s*due|amount\s*payable)\s*:?\s*(.*)$/i },
];

type LabelHits = Partial<Record<LabelField, string>>;

/** "V.A.T." → "VAT", "P.O." → "PO": labels are printed both ways. */
export function normaliseLabelText(text: string): string {
  return text.replace(/\b(?:[A-Za-z]\.){2,}/g, (m) => m.replace(/\./g, "")).replace(/\s+/g, " ").trim();
}

/** Does a candidate value look like what the label names? A value found in
 * the next cell, further along the row or BELOW the label must — otherwise a
 * neighbouring heading ("Page", "Current") would be read as the value. */
function plausible(field: LabelField, value: string): boolean {
  const v = value.trim();
  if (v === "") return false;
  switch (field) {
    case "opening":
    case "closing":
      return looksLikeMoney(v) || /^\(?-?\s*(R\s*)?[0-9][0-9 .,']*\)?$/i.test(v);
    case "statementDate":
      return looksLikeDate(v);
    case "period":
      return /\d/.test(v);
    case "currency":
      return /^[A-Za-z]{3}\b/.test(v) || /^R$/i.test(v);
    default:
      return /\d/.test(v) && !looksLikeDate(v) && !looksLikeMoney(v);
  }
}

/** The bank/payment details a supplier prints for remittance: a "Bank" line
 * with an account number or branch code beneath it, in one column. Its first
 * line, when it is a name, is the PAYEE — the supplier; its account number is
 * the SUPPLIER's bank account, never our account number with the supplier. */
type BankBlock = { payee: string | null; cells: Set<Cell>; accountNumber: string | null };

const BANK_LINE = /\b(bank|banking)\b/i;
const BANK_ACCOUNT_LINE = /\b(acc(?:ount)?\.?\s*(?:no|number|#)|branch\s*(?:code|no|number))\b/i;
const PAYEE_LABEL = /^(?:account\s*(?:name|holder)|beneficiary|payee)\s*:?\s*(.+)$/i;

function findBankBlock(rows: Row[]): BankBlock | null {
  for (let i = 0; i < rows.length; i++) {
    for (const bankCell of rows[i].cells) {
      if (!BANK_LINE.test(bankCell.text) || /\bcharges?\b/i.test(bankCell.text)) continue;
      const page = rows[i].pageNumber;
      const sameColumn = (c: Cell) => Math.abs(c.x0 - bankCell.x0) <= 6;
      const below: Cell[] = [];
      for (let j = i + 1; j < rows.length && j <= i + 6 && rows[j].pageNumber === page; j++) below.push(...rows[j].cells.filter(sameColumn));
      const accountCells = below.filter((c) => BANK_ACCOUNT_LINE.test(c.text));
      if (accountCells.length === 0) continue;
      const cells = new Set<Cell>([bankCell, ...below]);
      let payee: string | null = null;
      const labelled = [...cells].map((c) => PAYEE_LABEL.exec(c.text)).find((m) => m);
      if (labelled) payee = labelled[1].trim();
      const previous = i > 0 && rows[i - 1].pageNumber === page && rows[i].y - rows[i - 1].y <= rows[i].height * 3 ? rows[i - 1].cells.find(sameColumn) : undefined;
      if (!payee && previous && /[A-Za-z]{2}/.test(previous.text) && !/\d|:/.test(previous.text) && !BANK_LINE.test(previous.text)) {
        payee = previous.text.trim();
        cells.add(previous);
      }
      const accountCell = accountCells.find((c) => /acc/i.test(c.text));
      const accountNumber = accountCell ? (/[:#]\s*(.+)$/.exec(accountCell.text)?.[1] ?? null) : null;
      return { payee, cells, accountNumber: accountNumber?.trim() ?? null };
    }
  }
  return null;
}

/** Finds the value of a label, by POSITION: the rest of its own cell; the next
 * cell; further along the same row; or BELOW it (the next rows on the page,
 * overlapping it horizontally) — "Date / Page" over "06/10/2026 / 1 of 1". */
function valueFor(field: LabelField, rows: Row[], rowIndex: number, cellIndex: number, rest: string): string | null {
  if (rest !== "") return rest;
  const row = rows[rowIndex];
  const label = row.cells[cellIndex];
  for (const cell of row.cells.slice(cellIndex + 1)) {
    if (plausible(field, cell.text)) return cell.text.trim();
    if (LABELS.some((r) => !r.anywhere && r.pattern.test(normaliseLabelText(cell.text)))) break; // the next label starts
  }
  for (let j = rowIndex + 1; j < rows.length && j <= rowIndex + 3; j++) {
    const next = rows[j];
    if (next.pageNumber !== row.pageNumber || next.y - row.y > Math.max(row.height, label.height) * 3.2) break;
    const centre = (label.x0 + label.x1) / 2;
    const under = next.cells
      .filter((c) => Math.min(c.x1, label.x1) - Math.max(c.x0, label.x0) > 0 || Math.abs((c.x0 + c.x1) / 2 - centre) <= Math.max(20, label.x1 - label.x0))
      .sort((a, b) => Math.abs((a.x0 + a.x1) / 2 - centre) - Math.abs((b.x0 + b.x1) / 2 - centre));
    const hit = under.find((c) => plausible(field, c.text));
    if (hit) return hit.text.trim();
  }
  return null;
}

function readLabels(rows: Row[], headerRows: ReadonlySet<Row>, bank: BankBlock | null): LabelHits {
  const hits: LabelHits = {};
  rows.forEach((row, rowIndex) => {
    row.cells.forEach((cell, cellIndex) => {
      const text = normaliseLabelText(cell.text);
      for (const rule of LABELS) {
        if (hits[rule.field] !== undefined) continue;
        if (rule.headerOnly && !headerRows.has(row)) continue;
        // An account number in the bank details is the supplier's bank account.
        if (rule.field === "account" && bank?.cells.has(cell)) continue;
        const m = rule.pattern.exec(text);
        if (!m) continue;
        const rest = (m[1] ?? "").trim();
        // A bare or inline label must have a value that looks right; a
        // dedicated label keeps what follows it (and is reported if unreadable).
        if ((rule.headerOnly || rule.anywhere) && rest !== "" && !plausible(rule.field, rest)) continue;
        const value = valueFor(rule.field, rows, rowIndex, cellIndex, rest);
        if (value !== null && (!(rule.headerOnly || rule.anywhere) || plausible(rule.field, value))) hits[rule.field] = value;
      }
    });
  });
  return hits;
}

const TITLE_ONLY = /^(customer\s+|supplier\s+|account\s+)?statement(\s+of\s+account)?$|^tax\s+invoice$|^page\s+\d+/i;
/** The same titles printed letter-spaced ("S T A T E M E N T"). */
const TITLE_ONLY_COMPACT = /^(customer|supplier|account)?statement(ofaccount)?$|^taxinvoice$/i;

function isTitle(text: string): boolean {
  const t = text.trim();
  return TITLE_ONLY.test(t) || TITLE_ONLY_COMPACT.test(t.replace(/\s+/g, ""));
}

/** Contact details, never a name: "T 021 555 0199", "Tel: …", "+27 …",
 * e-mail and web addresses, and anything that is mostly digits. */
const CONTACT_LINE = /^(t|tel|telephone|phone|ph|f|fax|c|cell|m|mobile|e|email|e-mail|w|web)\b\s*[.:]?\s*[+(]?\d|^\+?\d[\d\s()-]{6,}$|@|www\.|https?:\/\//i;
/** Registration, licence, VAT and similar numbers: "Liquor Licence No: 11435". */
const IDENTIFIER_LINE = /\b(licen[cs]e|reg(?:istration)?|vat|tax|company|co)\b\.?.*\d|\b(?:no|number)\b\.?\s*:?\s*[\w/-]*\d/i;
/** Postal and street address lines: "PRIVATE BAG X7", "SUITE No. 205", "CHEMPET 7442". */
const ADDRESS_LINE =
  /\b(p\s?o\s*box|private\s+bag|postnet\s+suite)\b|\b(suite|unit|shop|floor)\s*(?:no\.?\s*)?\d|^\d+[a-z]?\s+[\w' -]*\b(street|st|road|rd|avenue|ave|drive|dr|lane|way|crescent|boulevard)\b|^[A-Za-z][A-Za-z .'-]*\s\d{4}$|^\d{4}$/i;
/** Header field words and values, never a name. */
const FIELD_WORD = /^(date|page|terms?|account|due|\d+\s+of\s+\d+)\b/i;

function isContact(text: string): boolean {
  const t = text.trim();
  if (CONTACT_LINE.test(t)) return true;
  const digitCount = (t.match(/\d/g) ?? []).length;
  const letters = (t.match(/[A-Za-z]/g) ?? []).length;
  return digitCount >= 6 && digitCount > letters * 2;
}

function couldBeName(text: string): boolean {
  const t = normaliseLabelText(text);
  if (t.length < 2 || !/[A-Za-z]{2}/.test(t)) return false;
  if (isTitle(t) || isContact(t) || t.includes(":")) return false;
  if (IDENTIFIER_LINE.test(t) || ADDRESS_LINE.test(t) || FIELD_WORD.test(t)) return false;
  return !looksLikeDate(t) && !looksLikeMoney(t);
}

/**
 * The supplier's name, as a PROPOSAL (a person confirms the supplier):
 *   1. the largest name-like line in the letterhead band (top 15% of page 1),
 *      ignoring contact details, registration/licence numbers, addresses,
 *      field labels and titles — every cell, not only the first in its row;
 *   2. otherwise (a letterhead printed as a LOGO), the payee of the bank
 *      details the statement prints;
 *   3. otherwise the largest name-like first cell in the top 30%.
 */
function letterheadName(page: LayoutPage | undefined, rows: Row[], bank: BankBlock | null): string | null {
  if (!page) return null;
  const pick = (cells: { cell: Cell; text: string }[]) =>
    cells.length === 0 ? null : cells.reduce((a, b) => (b.cell.height > a.cell.height ? b : a)).text;
  const band = rows
    .filter((r) => r.y <= page.height * 0.15)
    .flatMap((r) => r.cells.map((cell) => ({ cell, text: cell.text.trim() })))
    .filter((c) => couldBeName(c.text));
  const fromLetterhead = pick(band);
  if (fromLetterhead) return fromLetterhead;
  if (bank?.payee && couldBeName(bank.payee)) return bank.payee;
  const wider = rows
    .filter((r) => r.y <= page.height * 0.3 && r.cells[0])
    .map((r) => ({ cell: r.cells[0], text: r.cells[0].text.trim() }))
    .filter((c) => couldBeName(c.text));
  return pick(wider);
}

// ---------------------------------------------------------------------
// 6. The reader
// ---------------------------------------------------------------------

export type LayoutOptions = {
  /** Pages that carried no text layer (scanned). Their lines are not
   * read; the reviewer enters them. */
  imageOnlyPages?: number[];
};

export function readStatementLayout(pages: LayoutPage[], options: LayoutOptions = {}): StatementExtraction {
  const warnings: string[] = [];
  const header: StatementHeader = { ...EMPTY_HEADER };
  const lines: ExtractedStatementLine[] = [];
  const rowsByPage = pages.map((p) => buildRows(p));
  const allRows = rowsByPage.flat();

  for (const page of options.imageOnlyPages ?? []) {
    warnings.push(`Page ${page} has no readable text (it is a scanned image). Enter its lines by hand from the original.`);
  }

  // The statement's decimal style, from its unambiguous amounts.
  const style: DecimalStyle | null = inferDecimalStyle(allRows.flatMap((r) => r.cells.map((c) => c.text)).filter((t) => looksLikeMoney(t)));

  // The header: rows above the first table heading (on its page and before).
  const firstHeading = allRows.findIndex((r) => detectHeading(r) !== null);
  const headerRows = new Set(firstHeading > 0 ? allRows.slice(0, firstHeading) : []);
  const bank = findBankBlock(headerRows.size > 0 ? [...headerRows] : allRows);
  const labels = readLabels(allRows, headerRows, bank);
  const dateFrom = (text: string | undefined, context: { statementDate?: string | null } = {}) => {
    if (!text) return null;
    const r = parseStatementDate(text, context);
    return r.ok ? r.iso : null;
  };

  header.accountNumber = labels.account ?? null;
  header.supplierVatNumber = labels.vat ?? null;
  header.supplierRegistrationNumber = labels.registration ?? null;
  header.statementDate = dateFrom(labels.statementDate);
  if (labels.statementDate && !header.statementDate) {
    warnings.push(`The statement date "${labels.statementDate}" could not be read reliably. Enter it from the original.`);
  }
  if (labels.period) {
    const m = /^(.+?)\s*(?:to|-|–|until)\s*(.+)$/i.exec(labels.period);
    if (m) {
      header.periodFrom = dateFrom(m[1], { statementDate: header.statementDate });
      header.periodTo = dateFrom(m[2], { statementDate: header.statementDate });
    }
  }
  if (labels.currency) {
    const code = /\b([A-Z]{3})\b/.exec(labels.currency.toUpperCase());
    header.currencyCode = code ? code[1] : null;
  }
  header.supplierName = letterheadName(pages[0], rowsByPage[0] ?? [], bank);
  if (bank?.accountNumber) {
    warnings.push(`The account number ${bank.accountNumber} is printed with the supplier's bank details${bank.payee ? ` (${bank.payee})` : ""}: it is the supplier's bank account, not our account number with the supplier, so it is not used for that.`);
  }

  const money = (text: string | undefined | null): { value: number | null; unresolved: boolean } => {
    if (text === undefined || text === null || text.trim() === "") return { value: null, unresolved: false };
    const r = parseStatementAmount(text, style);
    return r.ok ? { value: r.value, unresolved: false } : { value: null, unresolved: true };
  };

  // Ageing blocks: a row of ageing labels, values on the next row beneath.
  // EVERY block is consumed (a statement may print one on the first and the
  // last page), so neither row is ever read as a transaction. The first block
  // gives the ageing; "Total Due" beneath its heading is the closing balance
  // unless the table itself prints one; "Overdue" is a summary, not a bucket.
  let ageingTotal: number | null = null;
  for (let i = 0; i < allRows.length - 1; i++) {
    const row = allRows[i];
    const labelCells = row.cells.filter((c) => AGEING_LABEL.test(c.text.trim()));
    if (labelCells.length < 3 || labelCells.length < row.cells.length - 1) continue;
    const next = allRows[i + 1];
    if (next.pageNumber !== row.pageNumber) continue;
    if (!next.cells.some((c) => looksLikeMoney(c.text))) continue;
    (row as Row & { consumed?: boolean }).consumed = true;
    (next as Row & { consumed?: boolean }).consumed = true;
    if (header.printedAgeing) continue;
    const ageing: PrintedAgeing = { current: null, days30: null, days60: null, days90: null, days120Plus: null };
    for (const label of labelCells) {
      const centre = (label.x0 + label.x1) / 2;
      const value = next.cells
        .filter((c) => looksLikeMoney(c.text))
        .reduce<Cell | null>((best, c) => {
          const d = Math.abs((c.x0 + c.x1) / 2 - centre);
          return d < (best ? Math.abs((best.x0 + best.x1) / 2 - centre) : Infinity) ? c : best;
        }, null);
      if (!value) continue;
      const parsed = money(value.text).value;
      const key = label.text.toLowerCase().replace(/\s+/g, "");
      if (key.startsWith("current")) ageing.current = parsed;
      else if (key.startsWith("30")) ageing.days30 = parsed;
      else if (key.startsWith("60")) ageing.days60 = parsed;
      // "90 Days" and "90+ Days" (90 and over) are the same bucket.
      else if (key.startsWith("90") || key === "over90days") ageing.days90 = parsed;
      else if (key.includes("120") || key.includes("150")) ageing.days120Plus = parsed;
      else if (/^(total|totaldue|totalsdue|amountdue|balancedue)$/.test(key)) ageingTotal = parsed;
      // "Overdue" / "Total overdue": a summary of the buckets, not stored.
    }
    if (Object.values(ageing).some((v) => v !== null)) header.printedAgeing = ageing;
  }

  let columns: Column[] | null = null;
  let tableFound = false;
  let tableEnded = false;
  let lineOrder = 0;
  let lastTransaction: { line: ExtractedStatementLine; row: Row } | null = null;
  // Every value printed in the Credit column, WITH its sign, and every period
  // total ("Total: October 2026"): whether the Credit column carries signed
  // amounts is decided once, for the whole statement, from its own totals.
  const creditColumn = new Map<ExtractedStatementLine, number>();
  const periods: { line: ExtractedStatementLine; debit: number | null; credit: number | null }[] = [];
  let printedTotalCreditSigned: number | null = null;

  const push = (line: Omit<ExtractedStatementLine, "lineOrder">) => {
    lineOrder += 1;
    const full = { ...line, lineOrder };
    lines.push(full);
    return full;
  };

  for (const pageRows of rowsByPage) {
    let headingSeenOnPage = false;
    for (const row of pageRows) {
      if ((row as Row & { consumed?: boolean }).consumed) continue;
      const heading = detectHeading(row);
      if (heading) {
        columns = heading;
        tableFound = true;
        tableEnded = false;
        headingSeenOnPage = true;
        lastTransaction = null;
        continue;
      }
      if (!columns || tableEnded) continue;
      // A later page with no heading of its own inherits the columns, but
      // only from the first row that looks like table content.
      const m = mapRow(row, columns);
      const text = row.text;
      // Money as printed ("1 234.56", "(500.00)", "500.00 CR"), or any
      // number sitting in a money column — a statement that prints no
      // decimals ("1,234", "750") still has amounts, they are just harder
      // to read (and may be left unresolved).
      const hasMoney =
        row.cells.some((c) => looksLikeMoney(c.text)) ||
        (["debit", "credit", "amount", "balance"] as const).some((r) => m[r] !== undefined && /[0-9]/.test(m[r]!));
      const dateText = m.date ?? (row.cells[0] && looksLikeDate(row.cells[0].text) ? row.cells[0].text : undefined);

      const excluded = (reason: ExclusionReason, valueText: string | null) => {
        const value = money(valueText);
        return push({
          pageNumber: row.pageNumber,
          rowOnPage: row.rowOnPage,
          transactionDate: dateFrom(dateText, { statementDate: header.statementDate }),
          referenceText: null,
          description: text,
          transactionType: "other",
          typeSource: "inferred",
          debit: null,
          credit: null,
          runningBalance: value.value,
          rawText: text,
          unresolvedFields: [],
          isExcluded: true,
          exclusionReason: reason,
        });
      };

      if (BROUGHT_FORWARD.test(text) && !CARRIED_FORWARD.test(text)) {
        const valueText = m.balance ?? m.amount ?? lastMoney(row);
        const line = excluded("brought-forward", valueText);
        // The FIRST brought-forward is the statement's opening balance; a
        // later one (top of a continuation page) is checked against the
        // carried-forward before it.
        if (lines.filter((l) => l.exclusionReason === "brought-forward").length === 1) header.openingBalance = line.runningBalance;
        if (valueText && line.runningBalance === null) warnings.push(`The brought-forward balance on page ${row.pageNumber} could not be read reliably.`);
        lastTransaction = null;
        continue;
      }
      if (CARRIED_FORWARD.test(text)) {
        excluded("carried-forward", m.balance ?? m.amount ?? lastMoney(row));
        lastTransaction = null;
        continue;
      }
      if (PAGE_TOTAL.test(text)) {
        excluded("page-total", lastMoney(row));
        lastTransaction = null;
        continue;
      }
      if (SUBTOTAL.test(text)) {
        excluded("subtotal", lastMoney(row));
        lastTransaction = null;
        continue;
      }
      if (PERIOD_SUBTOTAL.test(text) && hasMoney) {
        // A period's own totals (debits, credits as printed, and its net).
        const line = excluded("period-total", lastMoney(row));
        periods.push({ line, debit: money(m.debit).value, credit: money(m.credit).value });
        lastTransaction = null;
        continue;
      }
      if (CLOSING.test(text) && hasMoney) {
        const valueText = m.balance ?? m.amount ?? lastMoney(row);
        const line = excluded("closing-balance", valueText);
        header.closingBalance = line.runningBalance;
        if (valueText && line.runningBalance === null) warnings.push("The closing balance could not be read reliably. Enter it from the original.");
        tableEnded = true;
        continue;
      }
      if (STATEMENT_TOTAL.test(text) && hasMoney) {
        excluded("statement-total", null);
        header.printedTotalDebits = money(m.debit).value;
        header.printedTotalCredits = money(m.credit).value;
        printedTotalCreditSigned = header.printedTotalCredits;
        lastTransaction = null;
        continue;
      }

      if (!dateText && !hasMoney) {
        // A wrapped description: directly under the previous transaction, on
        // the same page, in the text columns.
        const previous = lastTransaction;
        const gap = previous ? row.y - previous.row.y : Infinity;
        const inTextColumns = row.cells.every((c) => {
          const role = columnFor(c, columns!)?.role;
          return role === "description" || role === "reference" || role === "extra" || role === "type";
        });
        if (previous && previous.row.pageNumber === row.pageNumber && gap > 0 && gap <= row.height * 2.4 && inTextColumns) {
          const extra = row.cells.map((c) => c.text).join(" ");
          previous.line.description = previous.line.description ? `${previous.line.description} ${extra}` : extra;
          previous.line.rawText = `${previous.line.rawText} / ${text}`;
          previous.row = row;
        }
        continue;
      }
      if (!headingSeenOnPage && !hasMoney) continue;

      // A transaction.
      const unresolved: UnresolvedField[] = [];
      let transactionDate: string | null = null;
      if (dateText) {
        transactionDate = dateFrom(dateText, { statementDate: header.statementDate });
        if (!transactionDate) unresolved.push("transaction_date");
      } else {
        unresolved.push("transaction_date");
      }

      let debit: number | null = null;
      let credit: number | null = null;
      let creditPrinted: number | null = null;
      if (m.debit !== undefined || m.credit !== undefined) {
        const d = money(m.debit);
        const c = money(m.credit);
        if (d.unresolved || (d.value !== null && d.value < 0)) unresolved.push("debit");
        else debit = d.value;
        if (c.unresolved || (c.value !== null && c.value < 0)) unresolved.push("credit");
        else credit = c.value;
        if (!c.unresolved && c.value !== null) creditPrinted = c.value;
      } else if (m.amount !== undefined) {
        const a = money(m.amount);
        if (a.unresolved) unresolved.push("debit");
        else if (a.value !== null) {
          if (a.value < 0) credit = -a.value;
          else debit = a.value;
        }
      }
      if (debit === null && credit === null && !unresolved.includes("debit") && !unresolved.includes("credit")) {
        // No amount where one belongs: unreadable, not zero.
        unresolved.push("debit");
      }

      const balance = money(m.balance);
      if (balance.unresolved) unresolved.push("running_balance");

      const reference = m.reference?.trim() || null;
      const description = [m.description, m.extra].filter(Boolean).join(" ").trim() || null;
      const typed = inferTransactionType(m.type ?? null, reference, description);

      const line = push({
        pageNumber: row.pageNumber,
        rowOnPage: row.rowOnPage,
        transactionDate,
        referenceText: reference,
        description,
        transactionType: typed.type,
        typeSource: typed.source,
        debit,
        credit,
        runningBalance: balance.value,
        rawText: text,
        unresolvedFields: unresolved,
        isExcluded: false,
        exclusionReason: null,
      });
      if (creditPrinted !== null) creditColumn.set(line, creditPrinted);
      lastTransaction = { line, row };
    }
  }

  // SIGNED CREDIT COLUMN. Some statements print the Credit column as signed
  // amounts: a minus for what reduces the balance (payments, credits), no
  // sign for what increases it (a reversal, re-applied cash). That is the
  // statement's own convention when its printed credit TOTALS are negative,
  // or when every credit it prints carries a minus. Then:
  //   - a minus value is a credit;
  //   - a value without a minus increases the balance — accepted ONLY where
  //     the period's printed credit total proves it (the signed values add up
  //     to it exactly); anywhere else it is left unread for a person.
  // A statement that prints credits without signs is never affected.
  const printedCredits = [...creditColumn.values()];
  const negatives = printedCredits.filter((v) => v < 0).length;
  const positives = printedCredits.filter((v) => v > 0).length;
  const signedByTotals = periods.some((p) => p.credit !== null && p.credit < 0) || (printedTotalCreditSigned !== null && printedTotalCreditSigned < 0);
  const signedByUse = negatives >= 2 && positives === 0;
  if (signedByTotals || signedByUse) {
    const cents = (v: number) => Math.round(v * 100);
    // Which period each transaction belongs to: the period total that follows it.
    const verified = new Set<ExtractedStatementLine>();
    let start = 0;
    const ordered = [...lines].sort((a, b) => a.lineOrder - b.lineOrder);
    for (const period of periods) {
      const end = ordered.indexOf(period.line);
      const members = ordered.slice(start, end).filter((l) => !l.isExcluded);
      start = end + 1;
      if (period.credit === null) continue;
      if (members.some((l) => l.unresolvedFields.includes("credit") && !creditColumn.has(l))) continue;
      const sum = members.reduce((acc, l) => acc + cents(creditColumn.get(l) ?? 0), 0);
      if (sum === cents(period.credit)) for (const l of members) verified.add(l);
    }
    let readNegative = 0;
    let readPositive = 0;
    let unreadPositive = 0;
    for (const [line, value] of creditColumn) {
      const clear = (field: UnresolvedField) => {
        const at = line.unresolvedFields.indexOf(field);
        if (at >= 0) line.unresolvedFields.splice(at, 1);
      };
      if (value < 0) {
        line.credit = Math.abs(value);
        clear("credit");
        readNegative += 1;
      } else if (value > 0 && signedByTotals) {
        if (verified.has(line) && line.debit === null) {
          // Printed without a minus in a signed Credit column: it increases
          // the balance, as the period's printed total proves.
          line.credit = null;
          line.debit = value;
          readPositive += 1;
        } else {
          line.credit = null;
          if (!line.unresolvedFields.includes("credit")) line.unresolvedFields.push("credit");
          unreadPositive += 1;
        }
      }
    }
    for (const period of periods) if (period.credit !== null && period.credit < 0) period.line.credit = Math.abs(period.credit);
    if (header.printedTotalCredits !== null && header.printedTotalCredits < 0) header.printedTotalCredits = Math.abs(header.printedTotalCredits);
    warnings.push(
      `This statement prints signed amounts in its Credit column: ${readNegative} value${readNegative === 1 ? "" : "s"} with a minus were read as credits` +
        (readPositive > 0 ? `, and ${readPositive} printed without a minus ${readPositive === 1 ? "was" : "were"} read as increasing the balance, as each period's printed total proves` : "") +
        (unreadPositive > 0 ? `; ${unreadPositive} printed without a minus could not be proven by a period total and ${unreadPositive === 1 ? "was" : "were"} left for review` : "") +
        ".",
    );
  }
  for (const period of periods) period.line.debit = period.debit;

  // Summary boxes outside the table.
  if (header.openingBalance === null && labels.opening) header.openingBalance = money(labels.opening).value;
  if (header.closingBalance === null && ageingTotal !== null) header.closingBalance = ageingTotal;
  if (header.closingBalance === null && labels.closing) header.closingBalance = money(labels.closing).value;

  // OPENING BALANCE 0.00 — only when the statement itself proves it: it prints
  // no brought-forward or opening balance, every amount was read, and its
  // lines add up EXACTLY to its closing balance from nothing. Otherwise the
  // opening balance stays unavailable (never assumed).
  if (header.openingBalance === null && !labels.opening && header.closingBalance !== null && !lines.some((l) => l.exclusionReason === "brought-forward")) {
    const transactions = lines.filter((l) => !l.isExcluded);
    const allRead = transactions.length > 0 && transactions.every((l) => !l.unresolvedFields.includes("debit") && !l.unresolvedFields.includes("credit") && (l.debit !== null || l.credit !== null));
    const sum = transactions.reduce((acc, l) => acc + Math.round((l.debit ?? 0) * 100) - Math.round((l.credit ?? 0) * 100), 0);
    if (allRead && sum === Math.round(header.closingBalance * 100)) {
      header.openingBalance = 0;
      warnings.push("No opening (brought-forward) balance is printed, and the statement's lines add up exactly to its closing balance from nothing, so its opening balance is 0.00.");
    }
  }

  if (!tableFound) {
    warnings.push("No transaction table was recognised on this statement. Enter its lines by hand from the original.");
  }
  const unreadable = lines.filter((l) => l.unresolvedFields.length > 0).length;
  if (unreadable > 0) {
    warnings.push(`${unreadable} line${unreadable === 1 ? "" : "s"} contain${unreadable === 1 ? "s" : ""} a value that could not be read reliably. Check ${unreadable === 1 ? "it" : "them"} against the original.`);
  }
  if (style === null && lines.some((l) => !l.isExcluded)) {
    warnings.push("The statement's decimal separator could not be determined; amounts that could be read two ways were left for review.");
  }

  return { method: "layout", pageCount: pages.length, header, lines, warnings };
}

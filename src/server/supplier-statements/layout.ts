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
const CLOSING = /\b(closing\s*balance|balance\s*due|amount\s*due|total\s*due|balance\s*owing|amount\s*owing|total\s*outstanding|account\s*balance|amount\s*payable)\b/i;
const AGEING_LABEL = /^(current|30\s*days?|60\s*days?|90\s*days?|120\s*\+?\s*days?|120\s*days?\s*\+|over\s*120\s*days?|120\+|150\+?\s*days?|total|totals?\s*due)$/i;

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
  [/\b(payment|receipt|eft|deposit|paid|remittance)\b/i, "payment"],
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

type LabelRule = { field: "account" | "statementDate" | "vat" | "registration" | "period" | "currency" | "opening" | "closing"; pattern: RegExp };

const LABELS: LabelRule[] = [
  { field: "account", pattern: /^(?:our\s+)?(?:acc(?:ount)?|customer|debtor|client)\.?\s*(?:no|number|code|#|ref(?:erence)?)\.?\s*:?\s*(.*)$/i },
  { field: "statementDate", pattern: /^(?:statement\s*date|date\s*of\s*statement|as\s*at(?:\s*date)?)\s*:?\s*(.*)$/i },
  { field: "vat", pattern: /^vat\s*(?:reg(?:istration)?\.?)?\s*(?:no|number)?\.?\s*:?\s*(.*)$/i },
  { field: "registration", pattern: /^(?:co(?:mpany)?\.?\s*)?reg(?:istration)?\.?\s*(?:no|number)\.?\s*:?\s*(.*)$/i },
  { field: "period", pattern: /^(?:statement\s*)?(?:period|for\s*the\s*period)\s*:?\s*(.*)$/i },
  { field: "currency", pattern: /^currency\s*:?\s*(.*)$/i },
  { field: "opening", pattern: /^(?:opening\s*balance|balance\s*b\/f|balance\s*brought\s*forward)\s*:?\s*(.*)$/i },
  { field: "closing", pattern: /^(?:closing\s*balance|balance\s*due|amount\s*due|total\s*due|amount\s*payable)\s*:?\s*(.*)$/i },
];

type LabelHits = Partial<Record<LabelRule["field"], string>>;

function readLabels(rows: Row[]): LabelHits {
  const hits: LabelHits = {};
  for (const row of rows) {
    row.cells.forEach((cell, i) => {
      for (const rule of LABELS) {
        if (hits[rule.field] !== undefined) continue;
        const m = rule.pattern.exec(cell.text);
        if (!m) continue;
        let value = (m[1] ?? "").trim();
        if (value === "" && row.cells[i + 1]) value = row.cells[i + 1].text.trim();
        if (value !== "") hits[rule.field] = value;
      }
    });
  }
  return hits;
}

const TITLE_ONLY = /^(customer\s+|supplier\s+|account\s+)?statement(\s+of\s+account)?$|^tax\s+invoice$|^page\s+\d+/i;

function letterheadName(page: LayoutPage | undefined, rows: Row[]): string | null {
  if (!page) return null;
  const top = rows.filter((r) => r.y <= page.height * 0.3 && !TITLE_ONLY.test(r.text.trim()));
  if (top.length === 0) return null;
  const largest = top.reduce((a, b) => (b.height > a.height ? b : a));
  const name = largest.cells[0]?.text.trim() ?? "";
  return name.length >= 2 ? name : null;
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

  const labels = readLabels(allRows);
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
  header.supplierName = letterheadName(pages[0], rowsByPage[0] ?? []);

  const money = (text: string | undefined | null): { value: number | null; unresolved: boolean } => {
    if (text === undefined || text === null || text.trim() === "") return { value: null, unresolved: false };
    const r = parseStatementAmount(text, style);
    return r.ok ? { value: r.value, unresolved: false } : { value: null, unresolved: true };
  };

  // Ageing block: a row of ageing labels, values on the next row beneath.
  for (let i = 0; i < allRows.length - 1; i++) {
    const row = allRows[i];
    const labelCells = row.cells.filter((c) => AGEING_LABEL.test(c.text.trim()));
    if (labelCells.length < 3 || labelCells.length < row.cells.length - 1) continue;
    const next = allRows[i + 1];
    if (next.pageNumber !== row.pageNumber) continue;
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
      else if (key.startsWith("90")) ageing.days90 = parsed;
      else if (key.includes("120") || key.includes("150")) ageing.days120Plus = parsed;
    }
    if (Object.values(ageing).some((v) => v !== null)) header.printedAgeing = ageing;
    (row as Row & { consumed?: boolean }).consumed = true;
    (next as Row & { consumed?: boolean }).consumed = true;
    break;
  }

  let columns: Column[] | null = null;
  let tableFound = false;
  let tableEnded = false;
  let lineOrder = 0;
  let lastTransaction: { line: ExtractedStatementLine; row: Row } | null = null;

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
      if (m.debit !== undefined || m.credit !== undefined) {
        const d = money(m.debit);
        const c = money(m.credit);
        if (d.unresolved || (d.value !== null && d.value < 0)) unresolved.push("debit");
        else debit = d.value;
        if (c.unresolved || (c.value !== null && c.value < 0)) unresolved.push("credit");
        else credit = c.value;
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
      lastTransaction = { line, row };
    }
  }

  // Summary boxes outside the table.
  if (header.openingBalance === null && labels.opening) header.openingBalance = money(labels.opening).value;
  if (header.closingBalance === null && labels.closing) header.closingBalance = money(labels.closing).value;

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

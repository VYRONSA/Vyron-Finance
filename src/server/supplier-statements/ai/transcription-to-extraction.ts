/**
 * SD-3F — turns an AI TRANSCRIPTION (text only) into a `StatementExtraction`
 * with the deterministic reader's OWN rules.
 *
 * The transcription's rows are laid out as a grid (Date | Reference |
 * Description | Type | Debit | Credit | Amount | Balance) and read by the same
 * layout reader as a text PDF or a spreadsheet: the same amount and date
 * parsers (ambiguous or unreadable values stay UNRESOLVED), the same
 * brought/carried-forward, totals and closing-balance handling, the same type
 * rules (never from the sign). Nothing the provider wrote is taken as a value
 * without passing through those parsers. Header facts it transcribed are
 * parsed the same way; the supplier is still only a PROPOSAL, made later by
 * the deterministic matcher, and a person must confirm it.
 *
 * Pure.
 */
import { inferDecimalStyle, parseStatementAmount, parseStatementDate } from "../amounts";
import { readTabularStatement, type TabularCell } from "../tabular";
import type { StatementExtraction } from "../types";
import type { StatementTranscription } from "./statement-ai-provider";

const HEADINGS = ["Date", "Reference", "Description", "Type", "Debit", "Credit", "Amount", "Balance"];

export function transcriptionToExtraction(t: StatementTranscription, pageCount: number | null): StatementExtraction {
  // Header rows go first (as labelled cells), then the table.
  const grid: TabularCell[][] = [];
  if (t.supplierName) grid.push([{ text: "Supplier" }, { text: t.supplierName }]);
  if (t.accountNumber) grid.push([{ text: "Account No" }, { text: t.accountNumber }]);
  if (t.statementDateText) grid.push([{ text: "Statement Date" }, { text: t.statementDateText }]);
  if (t.supplierVatNumber) grid.push([{ text: "VAT No" }, { text: t.supplierVatNumber }]);
  if (t.supplierRegistrationNumber) grid.push([{ text: "Reg No" }, { text: t.supplierRegistrationNumber }]);
  if (t.periodText) grid.push([{ text: "Period" }, { text: t.periodText }]);
  if (t.currencyText) grid.push([{ text: "Currency" }, { text: t.currencyText }]);
  grid.push([]);
  const headingIndex = grid.length;
  grid.push(HEADINGS.map((h) => ({ text: h })));
  for (const r of t.rows) {
    grid.push([r.dateText, r.referenceText, r.description, r.typeText, r.debitText, r.creditText, r.amountText, r.balanceText].map((v) => ({ text: v ?? "" })));
  }

  const read = readTabularStatement(grid);
  const header = { ...read.header, supplierName: t.supplierName };
  const warnings = [...read.warnings];

  // A transcribed opening/closing balance is used only if no row gave one,
  // and only through the same parser.
  const style = inferDecimalStyle(t.rows.flatMap((r) => [r.debitText, r.creditText, r.amountText, r.balanceText]).filter((x): x is string => !!x));
  if (header.openingBalance === null && t.openingBalanceText) {
    const v = parseStatementAmount(t.openingBalanceText, style);
    if (v.ok) header.openingBalance = v.value;
    else warnings.push("The opening balance could not be read reliably. Enter it from the original.");
  }
  if (header.closingBalance === null && t.closingBalanceText) {
    const v = parseStatementAmount(t.closingBalanceText, style);
    if (v.ok) header.closingBalance = v.value;
    else warnings.push("The closing balance could not be read reliably. Enter it from the original.");
  }
  if (header.statementDate === null && t.statementDateText) {
    const d = parseStatementDate(t.statementDateText);
    if (d.ok) header.statementDate = d.iso;
  }

  // Page provenance and the row as read come from the transcription. The
  // reader numbers only rows that hold text, so map its row number back to
  // the grid row, and the grid row back to the transcribed row.
  const filledGridRows = grid.map((row, index) => ({ row, index })).filter(({ row }) => row.some((c) => c.text.trim() !== "")).map(({ index }) => index);
  const lines = read.lines.map((line) => {
    const gridIndex = line.rowOnPage !== null ? filledGridRows[line.rowOnPage - 1] : undefined;
    const source = gridIndex !== undefined && gridIndex > headingIndex ? t.rows[gridIndex - headingIndex - 1] : undefined;
    return { ...line, pageNumber: source?.page ?? null, rawText: source?.rowText ?? line.rawText };
  });

  warnings.unshift("Read by AI from a scanned statement. Every value is checked like any other statement — compare it with the original before marking it ready.");
  for (const w of t.warnings.slice(0, 10)) warnings.push(`AI note: ${w}`);
  return { method: "tabular", pageCount, header, lines, warnings };
}

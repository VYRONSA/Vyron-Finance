/**
 * Finding #035/#039 (RC-12) — bulk CSV import for Customers and
 * Suppliers, the one entity pair in this app that had create-one-row-
 * at-a-time only. Reuses the generic, non-bank-specific tokenizing/
 * decoding helpers `csv-utils.ts` already has (`parseCsvText`,
 * `decodeCsvBuffer`, `cleanText`, `normalizeHeader`) — the column
 * mapping below is new, since customer/supplier fields don't share a
 * shape with bank statements or bills.
 */

import { cleanText, isBlankRow, normalizeHeader, parseCsvText } from "./csv-utils";

export type ParsedCustomerImportRow = {
  rowNumber: number;
  customerCode: string;
  name: string;
  customerGroup: string;
  vatNumber: string;
  registrationNumber: string;
  creditLimit: number;
  paymentTermsDays: number;
};

export type ParsedSupplierImportRow = {
  rowNumber: number;
  supplierCode: string;
  name: string;
  supplierCategory: string;
  paymentTermsDays: number;
};

export type ImportParseResult<T> = {
  rows: T[];
  errors: string[];
};

/** Phase 32 — the ONE source of truth a "Download Template" button reads
 * from (imported directly, not copy-pasted) — so the template can never
 * drift from what `findColumn` below actually accepts. Canonical
 * (first-listed) header only; aliases remain accepted on import but are
 * deliberately not what the template teaches, per "the template should
 * use the canonical header." */
export const SUPPLIER_IMPORT_TEMPLATE_HEADERS = ["Name", "Supplier Code", "Category", "Payment Terms (Days)"];
export const CUSTOMER_IMPORT_TEMPLATE_HEADERS = ["Name", "Customer Code", "Group", "VAT Number", "Registration Number", "Credit Limit", "Payment Terms (Days)"];

function findColumn(header: string[], ...candidates: string[]): number {
  const normalized = header.map(normalizeHeader);
  for (const candidate of candidates) {
    const idx = normalized.indexOf(normalizeHeader(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

function cell(row: string[], index: number): string {
  return index === -1 ? "" : cleanText(row[index]);
}

/** Phase 32A — a blank cell legitimately means "use the existing
 * default" (the same value `ae_customers.credit_limit`/`payment_terms_days`
 * and `ae_suppliers.payment_terms_days` already default to at the
 * database column level — 0 and 30 respectively, migrations 0008/0009 —
 * not a value this parser invents). A non-blank cell that ISN'T a valid
 * number is a real data problem and must reject the row, never be
 * silently coerced into that same default via `Number(x) || fallback`
 * (which cannot tell "blank" and "garbage" apart — both produce falsy
 * `NaN`/`0`). Negative numbers are intentionally NOT rejected here —
 * that check already exists, unchanged, at `createSupplier`/
 * `createCustomer` (`< 0` → ValidationError), so a parsed negative value
 * still correctly fails the row via the existing per-row try/catch in
 * `bulkImportSuppliers`/`bulkImportCustomers`, without this parser
 * duplicating that rule. */
function parseOptionalNonNegativeNumber(raw: string, fallback: number): { ok: true; value: number } | { ok: false } {
  if (!raw.trim()) return { ok: true, value: fallback };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: parsed };
}

/** Pure — no DB, no fetch. Expected columns (case/spacing-insensitive):
 * Customer Code, Name, Group, VAT Number, Registration Number, Credit
 * Limit, Payment Terms (Days). Only Name is strictly required per row —
 * everything else defaults sensibly, matching `createCustomer`'s own
 * optional fields. */
export function parseCustomerImportCsv(csvText: string): ImportParseResult<ParsedCustomerImportRow> {
  const allRows = parseCsvText(csvText).filter((r) => !isBlankRow(r));
  if (allRows.length === 0) return { rows: [], errors: ["The file is empty."] };

  const [header, ...dataRows] = allRows;
  const codeCol = findColumn(header, "Customer Code", "Code");
  const nameCol = findColumn(header, "Name", "Customer Name");
  const groupCol = findColumn(header, "Group", "Customer Group");
  const vatCol = findColumn(header, "VAT Number");
  const regCol = findColumn(header, "Registration Number");
  const creditCol = findColumn(header, "Credit Limit");
  const termsCol = findColumn(header, "Payment Terms (Days)", "Payment Terms");

  // Phase 32 — "which column is missing; which columns were detected;
  // where the user can get the correct template," not just a bare
  // "could not find" with no path forward.
  if (nameCol === -1) {
    return {
      rows: [],
      errors: [
        `Import failed because the required "Name" column was not found. Columns found in the file: ${header.join(", ") || "(none)"}. Download the Customer Import Template and use its column headers.`,
      ],
    };
  }

  const rows: ParsedCustomerImportRow[] = [];
  const errors: string[] = [];

  dataRows.forEach((raw, i) => {
    const rowNumber = i + 2; // header is row 1
    const name = cell(raw, nameCol);
    if (!name) {
      errors.push(`Row ${rowNumber}: Name is required — skipped.`);
      return;
    }

    // Phase 32A — an invalid (non-blank, non-numeric) value must reject
    // the row, never silently become the same default a blank cell gets.
    const creditRaw = cell(raw, creditCol);
    const creditLimit = parseOptionalNonNegativeNumber(creditRaw, 0);
    if (!creditLimit.ok) {
      errors.push(`Row ${rowNumber}: Credit Limit "${creditRaw}" is not a valid number — skipped.`);
      return;
    }
    const termsRaw = cell(raw, termsCol);
    const paymentTermsDays = parseOptionalNonNegativeNumber(termsRaw, 30);
    if (!paymentTermsDays.ok) {
      errors.push(`Row ${rowNumber}: Payment Terms (Days) "${termsRaw}" is not a valid number — skipped.`);
      return;
    }

    rows.push({
      rowNumber,
      customerCode: cell(raw, codeCol) || `IMP-${rowNumber}`,
      name,
      customerGroup: cell(raw, groupCol),
      vatNumber: cell(raw, vatCol),
      registrationNumber: cell(raw, regCol),
      creditLimit: creditLimit.value,
      paymentTermsDays: paymentTermsDays.value,
    });
  });

  return { rows, errors };
}

/** Pure — mirrors `parseCustomerImportCsv` exactly. Expected columns:
 * Supplier Code, Name, Category, Payment Terms (Days). */
export function parseSupplierImportCsv(csvText: string): ImportParseResult<ParsedSupplierImportRow> {
  const allRows = parseCsvText(csvText).filter((r) => !isBlankRow(r));
  if (allRows.length === 0) return { rows: [], errors: ["The file is empty."] };

  const [header, ...dataRows] = allRows;
  const codeCol = findColumn(header, "Supplier Code", "Code");
  const nameCol = findColumn(header, "Name", "Supplier Name");
  const categoryCol = findColumn(header, "Category", "Supplier Category");
  const termsCol = findColumn(header, "Payment Terms (Days)", "Payment Terms");

  if (nameCol === -1) {
    return {
      rows: [],
      errors: [
        `Import failed because the required "Name" column was not found. Columns found in the file: ${header.join(", ") || "(none)"}. Download the Supplier Import Template and use its column headers.`,
      ],
    };
  }

  const rows: ParsedSupplierImportRow[] = [];
  const errors: string[] = [];

  dataRows.forEach((raw, i) => {
    const rowNumber = i + 2;
    const name = cell(raw, nameCol);
    if (!name) {
      errors.push(`Row ${rowNumber}: Name is required — skipped.`);
      return;
    }

    const termsRaw = cell(raw, termsCol);
    const paymentTermsDays = parseOptionalNonNegativeNumber(termsRaw, 30);
    if (!paymentTermsDays.ok) {
      errors.push(`Row ${rowNumber}: Payment Terms (Days) "${termsRaw}" is not a valid number — skipped.`);
      return;
    }

    rows.push({
      rowNumber,
      supplierCode: cell(raw, codeCol),
      name,
      supplierCategory: cell(raw, categoryCol),
      paymentTermsDays: paymentTermsDays.value,
    });
  });

  return { rows, errors };
}

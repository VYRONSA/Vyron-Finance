/**
 * Xero Client Import — orchestrates a full Xero-export migration
 * (Contacts, Sales Invoices, Bills, Bank Transactions, Chart of
 * Accounts) into one VYRON company. Every write goes through the SAME
 * repository/service functions the rest of the app uses (`createCustomer`,
 * `createSupplier`, `createSalesInvoice`, `createPurchaseBillWithLines`,
 * `ingestBankTransactionIdempotent`, `createChartOfAccount`) — this file
 * adds Xero-specific mapping/grouping/reconciliation on top, never a
 * parallel write path.
 *
 * Idempotency: every entity is looked up by its natural Xero identifier
 * before being created (invoice/bill by `(company, invoice_number)`,
 * customer/supplier by normalized contact name, bank transaction by the
 * existing `ae_bank_transactions` natural-key unique constraint via
 * `ingestBankTransactionIdempotent`) — running this twice against the
 * same company reports every row as "already imported" the second time,
 * never a duplicate.
 *
 * That idempotency is scoped to RE-RUNNING ONE EXPORT, and nothing more.
 * The Xero data is the source of truth for the migration: transactions
 * that merely look alike are not deduplicated, consolidated, corrected or
 * suppressed. If Xero holds two transactions with the same date, amount
 * and description, both are the client's real records and both land in
 * VYRON, where the client can find and fix their own accounting mistakes
 * deliberately. See `import-source-occurrence.ts` and migration 0092 for
 * how both properties hold at once.
 */
import { createClient } from "@/lib/supabase/server";
import { createCustomer, ValidationError as CustomerValidationError } from "@/server/services/customer-service";
import { createCustomerAddress, createCustomerContact, listCustomers, type NewCustomer } from "@/server/repositories/customer-repository";
import { createSupplier, ValidationError as SupplierValidationError } from "@/server/services/supplier-management-service";
import { createSupplierAddress, createSupplierContact } from "@/server/repositories/supplier-management-repository";
import { findSupplierByName, listSuppliers } from "@/server/repositories/supplier-reconciliation-repository";
import { createSalesInvoice, listSalesInvoices, type NewSalesInvoiceLine } from "@/server/repositories/sales-invoice-repository";
import { createPurchaseBillWithLines, listPurchaseBillsBySupplier, type NewPurchaseBillLine } from "@/server/repositories/purchase-bill-repository";
import { listChartOfAccounts, createChartOfAccount, updateChartOfAccount, type NewChartOfAccount } from "@/server/repositories/chart-of-accounts-repository";
import { createBankAccount, findBankAccountByNumber } from "@/server/repositories/bank-account-repository";
import { ingestBankTransactionIdempotent } from "@/server/repositories/import-repository";
import { assignSourceOccurrences } from "@/server/import-centre/import-source-occurrence";
import { parseXeroContactsCsv, mergeXeroContactRows, classifyContactRole, type XeroContactRow } from "@/server/import-centre/xero-contacts-parser";
import { parseXeroInvoiceLinesCsv, type XeroInvoiceGroup } from "@/server/import-centre/xero-invoices-bills-parser";
import { parseXeroBankTransactionsXlsx } from "@/server/import-centre/xero-bank-transactions-parser";
import type { AccountType, NormalBalance } from "@/server/general-ledger/types";

export class XeroImportError extends Error {}

// ---------------------------------------------------------------------
// Chart of Accounts reconciliation
// ---------------------------------------------------------------------

/** Every distinct Xero account code found across the three source files
 * for THIS client, with the real name/type it represents in the source
 * data. Codes marked `collidesWithVyronDefault: true` share a numeric
 * code with one of VYRON's own generic starter accounts
 * (`seed_company_defaults`/`seed_expanded_operating_expense_chart`) but
 * mean something completely different for this client (confirmed by
 * reading every real line-item Description under that code) — for
 * those, this client's real Xero meaning is authoritative and the
 * seeded placeholder is corrected, never left silently wrong. Names for
 * codes NOT literally given by Xero (Sales/Bills CSVs carry no account
 * NAME column, only AccountCode) are derived from the real line-item
 * descriptions filed under that code — disclosed here, not invented. */
export type XeroAccountMapping = {
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  category: string;
  source: "xero-literal" | "inferred-from-line-items";
};

export const XERO_ACCOUNT_MAPPINGS: XeroAccountMapping[] = [
  // Literal Xero account names, read directly from the bank export's
  // "Related Account" column.
  { code: "610", name: "Accounts Receivable", accountType: "Asset", normalBalance: "Debit", category: "Current Asset", source: "xero-literal" },
  { code: "800", name: "Accounts Payable", accountType: "Liability", normalBalance: "Credit", category: "Current Liability", source: "xero-literal" },
  { code: "1500", name: "COS - Food Products", accountType: "Cost of Sales", normalBalance: "Debit", category: "Cost of Sales", source: "xero-literal" },
  { code: "1830", name: "Factory - Protective Clothing & PPE", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "xero-literal" },
  { code: "3030", name: "Bank Charges", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "xero-literal" },
  { code: "3160", name: "Donations", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "xero-literal" },
  { code: "3210", name: "Fuel", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "xero-literal" },
  { code: "3250", name: "Interest Paid", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "xero-literal" },
  { code: "3420", name: "Salaries and Wages", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "xero-literal" },
  { code: "6545", name: "SARS - PAYE Payable", accountType: "Liability", normalBalance: "Credit", category: "Current Liability", source: "xero-literal" },
  // Inferred from the real line-item descriptions filed under each code
  // (Sales Invoices / Bills CSVs carry no AccountName column).
  { code: "1000", name: "Product Sales", accountType: "Income", normalBalance: "Credit", category: "Operating Income", source: "inferred-from-line-items" },
  { code: "1005", name: "Bakery Sales", accountType: "Income", normalBalance: "Credit", category: "Operating Income", source: "inferred-from-line-items" },
  { code: "1010", name: "Baked Goods Sales", accountType: "Income", normalBalance: "Credit", category: "Operating Income", source: "inferred-from-line-items" },
  { code: "1805", name: "Electricity Recovery (Sales)", accountType: "Income", normalBalance: "Credit", category: "Operating Income", source: "inferred-from-line-items" },
  { code: "1505", name: "Packaging & Labels", accountType: "Cost of Sales", normalBalance: "Debit", category: "Cost of Sales", source: "inferred-from-line-items" },
  { code: "1750", name: "Small Equipment & Utensils", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "1815", name: "Gas", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "1820", name: "Waste Removal", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "1825", name: "Pest Control", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "2060", name: "Commission Paid", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "3040", name: "Equipment Rental", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "3050", name: "Consulting Fees", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "3190", name: "Refrigeration Equipment", accountType: "Asset", normalBalance: "Debit", category: "Fixed Asset", source: "inferred-from-line-items" },
  { code: "3230", name: "Samples & Refreshments", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "3240", name: "Vehicle Insurance", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "3260", name: "Internet & Telecoms", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "3320", name: "Motor Vehicle Expenses", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "3400", name: "Rent", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "3430", name: "Security", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "3450", name: "Staff Uniforms", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "3460", name: "Halaal Certification", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
  { code: "5020", name: "Refrigeration Equipment (Capital)", accountType: "Asset", normalBalance: "Debit", category: "Fixed Asset", source: "inferred-from-line-items" },
  { code: "6170", name: "Uniforms & Sundry Expenses", accountType: "Expense", normalBalance: "Debit", category: "Operating Expense", source: "inferred-from-line-items" },
];

/** Codes where VYRON's own default-seeded starter chart already used the
 * SAME numeric code for something else entirely — confirmed by reading
 * `seed_company_defaults()`/`seed_expanded_operating_expense_chart()`
 * against this client's real data:
 *   1000: VYRON default "Bank" vs Xero's real "Product Sales"
 *   1010: VYRON default "Petty Cash" vs Xero's real "Baked Goods Sales"
 *   3400: VYRON default "Director" vs Xero's real "Rent"
 *   5020: VYRON default "Direct Materials" vs Xero's real "Refrigeration Equipment"
 * `chart_of_accounts` has a UNIQUE(company_id, account_code) constraint,
 * so a second row under the same code is impossible — for THIS client,
 * the real Xero meaning is authoritative and the seeded placeholder is
 * corrected in place, not left representing something no transaction
 * of this client's actually uses that code for. */
const KNOWN_COLLISION_CODES = new Set(["1000", "1010", "3400", "5020"]);

export type ChartReconciliationResult = { created: string[]; updated: string[]; unchanged: string[] };

export async function reconcileChartOfAccounts(companyId: string): Promise<ChartReconciliationResult> {
  const existing = await listChartOfAccounts(companyId);
  const existingByCode = new Map(existing.map((a) => [a.accountCode, a]));
  const result: ChartReconciliationResult = { created: [], updated: [], unchanged: [] };

  for (const mapping of XERO_ACCOUNT_MAPPINGS) {
    const current = existingByCode.get(mapping.code);
    if (!current) {
      const input: NewChartOfAccount = {
        accountCode: mapping.code,
        description: mapping.name,
        accountType: mapping.accountType,
        normalBalance: mapping.normalBalance,
        category: mapping.category,
        notes: mapping.source === "inferred-from-line-items" ? "Migrated from Xero. Account name inferred from imported line-item descriptions (Xero's export carries no account-name column)." : "Migrated from Xero.",
      };
      await createChartOfAccount(companyId, input);
      result.created.push(`${mapping.code} ${mapping.name}`);
      continue;
    }
    if (KNOWN_COLLISION_CODES.has(mapping.code) && current.description !== mapping.name) {
      await updateChartOfAccount(companyId, current.id, {
        description: mapping.name,
        account_type: mapping.accountType,
        normal_balance: mapping.normalBalance,
        category: mapping.category,
        notes: `Corrected from VYRON's generic starter chart to this client's real Xero account (was "${current.description}"). Migrated from Xero.`,
      });
      result.updated.push(`${mapping.code}: "${current.description}" -> "${mapping.name}"`);
      continue;
    }
    result.unchanged.push(`${mapping.code} ${current.description}`);
  }

  return result;
}

// ---------------------------------------------------------------------
// VAT mapping
// ---------------------------------------------------------------------

/** Maps Xero's TaxType strings to VYRON's seeded `vat_treatments.code`
 * values (which ARE the descriptive names, e.g. "Standard Rated" — see
 * `seed_company_defaults()`). Never recalculates a rate — VAT amounts
 * are always taken verbatim from Xero's own TaxAmount/TaxTotal columns
 * elsewhere in this file, this function only resolves which treatment
 * code to file a line/invoice under. */
export function mapXeroTaxTypeToVatCode(taxType: string): string {
  const normalized = taxType.trim().toLowerCase();
  if (normalized.startsWith("standard rate")) return "Standard Rated";
  if (normalized === "no vat") return "No VAT";
  return "No VAT";
}

/** Whether a Xero TaxType carries a distinction VYRON's seeded VAT set
 * has no dedicated code for ("Capital Goods"/"Change in Use" purchases —
 * still 15% Standard Rate, just a different SARS input-VAT category) —
 * used to decide whether the original label needs preserving in the
 * line description (see `buildLineDescription` below) rather than a new
 * schema column for two rare cases. */
function taxTypeNeedsPreserving(taxType: string): boolean {
  const normalized = taxType.trim().toLowerCase();
  return normalized.includes("capital goods") || normalized.includes("change in use");
}

function buildLineDescription(description: string, taxType: string): string {
  return taxTypeNeedsPreserving(taxType) ? `${description} [Xero tax type: ${taxType}]` : description;
}

// ---------------------------------------------------------------------
// Codes / slugs
// ---------------------------------------------------------------------

const CODE_SAFE_RE = /[^A-Za-z0-9._-]/g;

function slugifyCode(text: string, maxLen = 20): string {
  const slug = text.trim().toUpperCase().replace(/\s+/g, "-").replace(CODE_SAFE_RE, "");
  return (slug || "CONTACT").slice(0, maxLen);
}

const VAT_NUMBER_RE = /^\d{10}$/;
const REGISTRATION_NUMBER_RE = /^\d{4}\/\d{6}\/\d{2}$/;

// ---------------------------------------------------------------------
// Results shape
// ---------------------------------------------------------------------

export type ImportEntityResult = {
  found: number;
  imported: number;
  skipped: number;
  duplicatesPrevented: number;
  errors: { identifier: string; reason: string }[];
  warnings: { identifier: string; reason: string }[];
};

function emptyResult(): ImportEntityResult {
  return { found: 0, imported: 0, skipped: 0, duplicatesPrevented: 0, errors: [], warnings: [] };
}

export type XeroImportInput = {
  salesInvoicesCsv?: { text: string; filename: string };
  billsCsv?: { text: string; filename: string };
  contactsCsvBatches: { text: string; filename: string }[];
  bankTransactionsXlsx?: { buffer: Buffer; filename: string };
};

export type XeroImportOutcome = {
  chartOfAccounts: ChartReconciliationResult;
  contacts: ImportEntityResult;
  salesInvoices: ImportEntityResult;
  bills: ImportEntityResult;
  bankAccounts: ImportEntityResult;
  bankTransactions: ImportEntityResult;
};

// ---------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------

async function importContacts(
  companyId: string,
  contactRows: XeroContactRow[],
  customerNames: Set<string>,
  supplierNames: Set<string>,
  performedBy: string,
): Promise<{ result: ImportEntityResult; customerIdByName: Map<string, number>; supplierIdByName: Map<string, number> }> {
  const result = emptyResult();
  const existingCustomers = await listCustomers(companyId);
  const existingSuppliers = await listSuppliers(companyId);
  const customerIdByName = new Map(existingCustomers.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const supplierIdByName = new Map(existingSuppliers.map((s) => [s.name.trim().toLowerCase(), s.id]));
  const usedCustomerCodes = new Set(existingCustomers.map((c) => c.customerCode));

  result.found = contactRows.length;

  for (const row of contactRows) {
    const role = classifyContactRole(row.contactName, customerNames, supplierNames);
    if (role === "Unused") {
      result.skipped++;
      result.warnings.push({ identifier: row.contactName, reason: "Not referenced by any imported Sales Invoice or Bill — no customer/supplier record created (nothing to link it to)." });
      continue;
    }

    const nameKey = row.contactName.trim().toLowerCase();
    const vatNumber = VAT_NUMBER_RE.test(row.taxNumber) ? row.taxNumber : undefined;
    if (row.taxNumber && !vatNumber) result.warnings.push({ identifier: row.contactName, reason: `TaxNumber "${row.taxNumber}" is not a valid 10-digit VAT number — left blank.` });
    const registrationNumber = REGISTRATION_NUMBER_RE.test(row.companyNumber) ? row.companyNumber : undefined;
    if (row.companyNumber && !registrationNumber) result.warnings.push({ identifier: row.contactName, reason: `CompanyNumber "${row.companyNumber}" is not in YYYY/NNNNNN/NN format — left blank.` });

    if ((role === "Customer" || role === "Both") && !customerIdByName.has(nameKey)) {
      try {
        let code = row.accountNumber ? slugifyCode(row.accountNumber) : slugifyCode(row.contactName);
        let suffix = 1;
        while (usedCustomerCodes.has(code)) code = `${slugifyCode(row.accountNumber || row.contactName, 16)}-${suffix++}`;
        usedCustomerCodes.add(code);

        const newCustomer: NewCustomer = {
          customerCode: code,
          name: row.contactName,
          vatNumber,
          registrationNumber,
          notes: "Migrated from Xero.",
        };
        const customer = await createCustomer(companyId, newCustomer, { skipCommunication: true });
        customerIdByName.set(nameKey, customer.id);
        if (row.email) await createCustomerContact(customer.id, { name: row.contactName, email: row.email, phone: row.phone, mobile: row.mobile, isPrimary: true });
        if (row.addressLine1 || row.city) {
          await createCustomerAddress(customer.id, {
            addressType: "Postal",
            line1: row.addressLine1,
            line2: row.addressLine2,
            city: row.city,
            region: row.region,
            postalCode: row.postalCode,
            country: row.country,
            isDefault: true,
          });
        }
        result.imported++;
      } catch (error) {
        result.errors.push({ identifier: row.contactName, reason: `Customer creation failed: ${error instanceof CustomerValidationError ? error.message : String(error)}` });
      }
    } else if ((role === "Customer" || role === "Both") && customerIdByName.has(nameKey)) {
      result.duplicatesPrevented++;
    }

    if ((role === "Supplier" || role === "Both") && !supplierIdByName.has(nameKey)) {
      try {
        const existingByName = await findSupplierByName(companyId, row.contactName);
        if (existingByName) {
          supplierIdByName.set(nameKey, existingByName.id);
          result.duplicatesPrevented++;
        } else {
          const supplier = await createSupplier(companyId, { name: row.contactName, supplierCode: row.accountNumber || undefined }, { skipCommunication: true });
          supplierIdByName.set(nameKey, supplier.id);
          if (row.email) await createSupplierContact(supplier.id, { name: row.contactName, email: row.email, phone: row.phone, mobile: row.mobile, isPrimary: true });
          if (row.addressLine1 || row.city) {
            await createSupplierAddress(supplier.id, {
              addressType: "Postal",
              line1: row.addressLine1,
              line2: row.addressLine2,
              city: row.city,
              region: row.region,
              postalCode: row.postalCode,
              country: row.country,
              isDefault: true,
            });
          }
          result.imported++;
        }
      } catch (error) {
        result.errors.push({ identifier: row.contactName, reason: `Supplier creation failed: ${error instanceof SupplierValidationError ? error.message : String(error)}` });
      }
    } else if ((role === "Supplier" || role === "Both") && supplierIdByName.has(nameKey)) {
      result.duplicatesPrevented++;
    }
  }

  void performedBy;
  return { result, customerIdByName, supplierIdByName };
}

// ---------------------------------------------------------------------
// Sales invoices
// ---------------------------------------------------------------------

function dominantVatCode(lines: { taxType: string }[]): string {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const code = mapXeroTaxTypeToVatCode(line.taxType);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best = "Standard Rated";
  let bestCount = -1;
  for (const [code, count] of counts) {
    if (count > bestCount) { best = code; bestCount = count; }
  }
  return best;
}

async function importSalesInvoices(companyId: string, invoices: XeroInvoiceGroup[], customerIdByName: Map<string, number>): Promise<ImportEntityResult> {
  const result = emptyResult();
  result.found = invoices.length;
  const existing = await listSalesInvoices(companyId);
  const existingNumbers = new Set(existing.map((i) => i.invoiceNumber));

  for (const invoice of invoices) {
    if (existingNumbers.has(invoice.invoiceNumber)) {
      result.duplicatesPrevented++;
      continue;
    }
    const customerId = customerIdByName.get(invoice.contactName.trim().toLowerCase());
    if (customerId === undefined) {
      result.skipped++;
      result.errors.push({ identifier: invoice.invoiceNumber, reason: `No customer record for contact "${invoice.contactName}" — was it created in the Contacts step?` });
      continue;
    }

    try {
      const documentType = invoice.xeroType.trim().toLowerCase() === "sales credit note" ? "Credit Note" : "Invoice";
      const lines: NewSalesInvoiceLine[] = invoice.lines.map((line) => ({
        description: buildLineDescription(line.description, line.taxType),
        quantity: line.quantity,
        unitPrice: line.unitAmount,
        discount: line.discount,
        glAccount: line.accountCode || null,
        vatCode: mapXeroTaxTypeToVatCode(line.taxType),
        netAmount: line.lineAmount,
        vatAmount: line.taxAmount,
      }));
      const vatRatePercent = dominantVatCode(invoice.lines) === "Standard Rated" ? 15 : 0;
      const created = await createSalesInvoice(
        companyId,
        {
          invoiceNumber: invoice.invoiceNumber,
          customerId,
          documentType,
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate,
          vatTreatmentCode: dominantVatCode(invoice.lines),
          reference: invoice.reference,
          notes: `Migrated from Xero. Xero status: ${invoice.xeroStatus}. Currency: ${invoice.currency}.`,
          lines,
        },
        vatRatePercent,
      );

      // Xero's own Total/TaxTotal/InvoiceAmountDue are exact, already-
      // reconciled figures — preserved verbatim rather than trusting
      // `createSalesInvoice`'s own single-flat-rate recomputation (which
      // can drift when an invoice mixes Standard-Rated and No-VAT lines).
      const supabase = await createClient();
      const { error } = await supabase
        .from("sales_invoices")
        .update({ subtotal: invoice.total - invoice.taxTotal, vat_amount: invoice.taxTotal, total: invoice.total, outstanding: invoice.amountDue })
        .eq("company_id", companyId)
        .eq("id", created.id);
      if (error) throw error;

      result.imported++;
    } catch (error) {
      result.errors.push({ identifier: invoice.invoiceNumber, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}

// ---------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------

async function importBills(companyId: string, bills: XeroInvoiceGroup[], supplierIdByName: Map<string, number>): Promise<ImportEntityResult> {
  const result = emptyResult();
  result.found = bills.length;
  const seenKeys = new Set<string>();

  for (const bill of bills) {
    const supplierId = supplierIdByName.get(bill.contactName.trim().toLowerCase());
    if (supplierId === undefined) {
      result.skipped++;
      result.errors.push({ identifier: bill.invoiceNumber, reason: `No supplier record for contact "${bill.contactName}" — was it created in the Contacts step?` });
      continue;
    }

    const dedupeKey = `${supplierId}::${bill.invoiceNumber}`;
    if (seenKeys.has(dedupeKey)) {
      result.duplicatesPrevented++;
      continue;
    }
    // Idempotent re-run check — `ae_imported_bills` has no unique
    // constraint on (supplier_id, invoice_number) the way sales invoices
    // do on invoice_number, so this file checks explicitly.
    const existingForSupplier = await listPurchaseBillsBySupplier(companyId, supplierId);
    if (existingForSupplier.some((b) => b.invoiceNumber === bill.invoiceNumber)) {
      seenKeys.add(dedupeKey);
      result.duplicatesPrevented++;
      continue;
    }

    try {
      const documentType = bill.xeroType.trim().toLowerCase() === "bill credit note" ? "Credit Note" : "Bill";
      const lines: NewPurchaseBillLine[] = bill.lines.map((line) => ({
        description: buildLineDescription(line.description, line.taxType),
        glAccount: line.accountCode || "",
        vatCode: mapXeroTaxTypeToVatCode(line.taxType),
        costCentreId: null,
        projectId: null,
        departmentId: null,
        quantity: line.quantity,
        unitCost: line.unitAmount,
        discount: line.discount,
        netAmount: line.lineAmount,
        vatAmount: line.taxAmount,
        lineTotal: line.lineAmount + line.taxAmount,
      }));

      const { bill: created } = await createPurchaseBillWithLines(
        companyId,
        {
          supplierId,
          supplierName: bill.contactName,
          invoiceNumber: bill.invoiceNumber,
          documentType,
          invoiceDate: bill.invoiceDate,
          dueDate: bill.dueDate,
          glAccount: bill.lines[0]?.accountCode || null,
          vatCode: dominantVatCode(bill.lines),
        },
        bill.taxTotal,
        bill.total,
        lines,
      );

      // Same "Xero's own totals are authoritative" correction as sales
      // invoices — `createPurchaseBillWithLines` always sets
      // `outstanding = total` (no paid-amount parameter exists on that
      // function), which would misreport an already-paid bill as fully
      // outstanding.
      const supabase = await createClient();
      const { error } = await supabase
        .from("ae_imported_bills")
        .update({ outstanding: bill.amountDue })
        .eq("company_id", companyId)
        .eq("id", created.id);
      if (error) throw error;

      seenKeys.add(dedupeKey);
      result.imported++;
    } catch (error) {
      result.errors.push({ identifier: bill.invoiceNumber, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}

// ---------------------------------------------------------------------
// Bank accounts + transactions
// ---------------------------------------------------------------------

async function importBankData(
  companyId: string,
  sections: Awaited<ReturnType<typeof parseXeroBankTransactionsXlsx>>["accounts"],
  input: { sourceFilename: string },
  performedBy: string,
): Promise<{ accountsResult: ImportEntityResult; transactionsResult: ImportEntityResult }> {
  const accountsResult = emptyResult();
  const transactionsResult = emptyResult();
  accountsResult.found = sections.length;

  for (const section of sections) {
    const accountNumber = slugifyCode(section.accountName, 30);
    let account = await findBankAccountByNumber(companyId, accountNumber);
    if (account) {
      accountsResult.duplicatesPrevented++;
    } else {
      account = await createBankAccount(companyId, {
        accountNumber,
        accountName: section.accountName,
        bankName: "",
        accountType: "",
        branch: "",
        currency: "ZAR",
        openingBalance: section.openingBalance,
        openingBalanceDate: section.transactions[0]?.date ?? null,
        openingBalanceReference: "Migrated from Xero.",
        glAccount: "",
      });
      accountsResult.imported++;
    }

    transactionsResult.found += section.transactions.length;

    // The Xero export IS the source of truth for this migration: if a
    // row exists in it, it gets imported. Xero genuinely contains rows
    // that share date, amount, payee and description — the same amount
    // paid to the same supplier twice on one day — and every one of them
    // is a real client record the client must be able to see and correct
    // themselves inside VYRON. Stamping each row's ordinal among
    // identical rows in this section (see `import-source-occurrence.ts`)
    // is what carries them all through the natural-key constraint, while
    // re-running this exact export still imports nothing new. Before
    // migration 0092 the second and subsequent copies were silently
    // counted as `duplicatesPrevented` and dropped: 621 rows in the
    // Metanoia Hospitality / New Handcrafted Food Products export
    // produced 480 rows on file.
    //
    // The description is built here rather than at insert time because
    // it is part of the identity key — the ordinals have to be computed
    // over exactly the values that get written.
    const sourceRows = assignSourceOccurrences(
      section.transactions.map((txn) => ({
        txn,
        bankAccount: account.accountName,
        transactionDate: txn.date,
        reference: txn.reference,
        description: `${txn.source}${txn.contact ? ` — ${txn.contact}` : ""}${txn.reference ? ` (${txn.reference})` : ""}`,
        // Xero's bank-account perspective is inverted relative to
        // VYRON's cashbook one — see `XeroBankTxnRow`'s own comment. A
        // row where money LEFT the bank is a VYRON `debit`; one where
        // money ARRIVED is a VYRON `credit`.
        debit: txn.moneyOut,
        credit: txn.moneyIn,
      })),
    );

    for (const row of sourceRows) {
      const txn = row.txn;
      try {
        const { created } = await ingestBankTransactionIdempotent(companyId, {
          transactionDate: txn.date,
          reference: txn.reference,
          description: row.description,
          beneficiary: txn.contact,
          debit: txn.moneyOut,
          credit: txn.moneyIn,
          balance: null,
          bankAccount: account.accountName,
          bankAccountId: account.id,
          vat: txn.tax || null,
          glAccount: txn.relatedAccount,
          notes: `Migrated from Xero. Source: ${txn.source}.`,
          importBatch: `XERO-${section.accountName}`,
          sourceFilename: input.sourceFilename,
          sourceOccurrence: row.sourceOccurrence,
        });
        if (created) transactionsResult.imported++;
        else transactionsResult.duplicatesPrevented++;
      } catch (error) {
        transactionsResult.errors.push({ identifier: `${section.accountName} row ${txn.rowNumber}`, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  void performedBy;
  return { accountsResult, transactionsResult };
}

// ---------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------

export async function runXeroImport(companyId: string, input: XeroImportInput, performedBy: string): Promise<XeroImportOutcome> {
  const salesGroups = input.salesInvoicesCsv ? parseXeroInvoiceLinesCsv(input.salesInvoicesCsv.text, input.salesInvoicesCsv.filename) : { invoices: [], skipped: [] };
  const billGroups = input.billsCsv ? parseXeroInvoiceLinesCsv(input.billsCsv.text, input.billsCsv.filename) : { invoices: [], skipped: [] };
  const contactBatches = input.contactsCsvBatches.map((b) => parseXeroContactsCsv(b.text, b.filename).contacts);
  const mergedContacts = mergeXeroContactRows(...contactBatches);

  const customerNames = new Set(salesGroups.invoices.map((i) => i.contactName.trim().toLowerCase()));
  const supplierNames = new Set(billGroups.invoices.map((b) => b.contactName.trim().toLowerCase()));

  const chartOfAccounts = await reconcileChartOfAccounts(companyId);
  const { result: contactsResult, customerIdByName, supplierIdByName } = await importContacts(companyId, mergedContacts, customerNames, supplierNames, performedBy);

  const salesInvoicesResult = await importSalesInvoices(companyId, salesGroups.invoices, customerIdByName);
  salesGroups.skipped.forEach((s) => salesInvoicesResult.warnings.push({ identifier: s.invoiceNumber || s.contactName || `row ${s.rowNumber}`, reason: s.reason }));

  const billsResult = await importBills(companyId, billGroups.invoices, supplierIdByName);
  billGroups.skipped.forEach((s) => billsResult.warnings.push({ identifier: s.invoiceNumber || s.contactName || `row ${s.rowNumber}`, reason: s.reason }));

  let bankAccountsResult = emptyResult();
  let bankTransactionsResult = emptyResult();
  if (input.bankTransactionsXlsx) {
    const parsed = await parseXeroBankTransactionsXlsx(input.bankTransactionsXlsx.buffer, input.bankTransactionsXlsx.filename);
    const { accountsResult, transactionsResult } = await importBankData(companyId, parsed.accounts, { sourceFilename: input.bankTransactionsXlsx.filename }, performedBy);
    bankAccountsResult = accountsResult;
    bankTransactionsResult = transactionsResult;
    parsed.skipped.forEach((s) => bankTransactionsResult.warnings.push({ identifier: `row ${s.rowNumber}`, reason: s.reason }));
  }

  return {
    chartOfAccounts,
    contacts: contactsResult,
    salesInvoices: salesInvoicesResult,
    bills: billsResult,
    bankAccounts: bankAccountsResult,
    bankTransactions: bankTransactionsResult,
  };
}

export { parseXeroContactsCsv, parseXeroInvoiceLinesCsv, parseXeroBankTransactionsXlsx };

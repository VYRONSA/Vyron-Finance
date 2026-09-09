/**
 * Xero Client Import — Contacts CSV parser. Xero's own Contacts export
 * header is fixed (Settings -> Contacts -> Export), so this reads by
 * exact column name rather than the alias-matching `xero-bills-parser.ts`
 * uses for report exports whose layout varies — Contacts exports don't
 * vary the same way.
 *
 * A single Xero organisation is commonly exported as MULTIPLE Contacts
 * CSV files (e.g. Xero's own "export in batches of 500" behaviour, or a
 * user re-exporting after a filter change) — `mergeXeroContactRows`
 * exists specifically to reconcile two such files by `*ContactName`
 * (Xero's own natural key for a contact) rather than blindly
 * concatenating and creating duplicates, per the task's own instruction:
 * "If two Xero exports contain overlapping information, reconcile them
 * based on their actual identifiers."
 */
import { cleanText, isBlankRow, parseCsvText } from "./csv-utils";

const HEADER_INDEX: Record<string, string> = {
  contactName: "*ContactName",
  accountNumber: "AccountNumber",
  email: "EmailAddress",
  firstName: "FirstName",
  lastName: "LastName",
  addressLine1: "POAddressLine1",
  addressLine2: "POAddressLine2",
  city: "POCity",
  region: "PORegion",
  postalCode: "POPostalCode",
  country: "POCountry",
  phone: "PhoneNumber",
  mobile: "MobileNumber",
  bankAccountName: "BankAccountName",
  bankAccountNumber: "BankAccountNumber",
  taxNumber: "TaxNumber",
  website: "Website",
  legalName: "LegalName",
  companyNumber: "CompanyNumber",
};

export type XeroContactRow = {
  contactName: string;
  accountNumber: string;
  email: string;
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string;
  mobile: string;
  bankAccountName: string;
  bankAccountNumber: string;
  taxNumber: string;
  website: string;
  legalName: string;
  companyNumber: string;
  sourceFilename: string;
  rowNumber: number;
};

export type XeroContactsParseResult = {
  contacts: XeroContactRow[];
  skipped: { rowNumber: number; reason: string }[];
};

export function parseXeroContactsCsv(fileText: string, sourceFilename: string): XeroContactsParseResult {
  const rawRows = parseCsvText(fileText);
  const contacts: XeroContactRow[] = [];
  const skipped: { rowNumber: number; reason: string }[] = [];

  const headerIndex = rawRows.findIndex((row) => !isBlankRow(row));
  if (headerIndex === -1) return { contacts, skipped };

  const headers = rawRows[headerIndex].map(cleanText);
  const colIndex: Record<string, number> = {};
  for (const [field, headerName] of Object.entries(HEADER_INDEX)) {
    colIndex[field] = headers.indexOf(headerName);
  }
  if (colIndex.contactName === -1) {
    skipped.push({ rowNumber: headerIndex + 1, reason: `Missing required column "*ContactName" (headers found: ${headers.join(", ")}).` });
    return { contacts, skipped };
  }

  const dataRows = rawRows.slice(headerIndex + 1);
  dataRows.forEach((rawRow, offset) => {
    const rowNumber = headerIndex + 2 + offset;
    if (isBlankRow(rawRow)) return;

    const get = (field: string): string => {
      const idx = colIndex[field];
      return idx >= 0 && idx < rawRow.length ? cleanText(rawRow[idx]) : "";
    };

    const contactName = get("contactName");
    if (!contactName) {
      skipped.push({ rowNumber, reason: "Missing *ContactName." });
      return;
    }

    contacts.push({
      contactName,
      accountNumber: get("accountNumber"),
      email: get("email"),
      firstName: get("firstName"),
      lastName: get("lastName"),
      addressLine1: get("addressLine1"),
      addressLine2: get("addressLine2"),
      city: get("city"),
      region: get("region"),
      postalCode: get("postalCode"),
      country: get("country"),
      phone: get("phone"),
      mobile: get("mobile"),
      bankAccountName: get("bankAccountName"),
      bankAccountNumber: get("bankAccountNumber"),
      taxNumber: get("taxNumber"),
      website: get("website"),
      legalName: get("legalName"),
      companyNumber: get("companyNumber"),
      sourceFilename,
      rowNumber,
    });
  });

  return { contacts, skipped };
}

function pickNonBlank(a: string, b: string): string {
  return a.trim() ? a : b;
}

/** Reconciles rows from multiple Contacts exports by `*ContactName`
 * (Xero's own natural key), case-insensitively — the SAME identifier
 * Xero itself treats as unique per organisation. When the same contact
 * appears in more than one file, fields are merged (first non-blank
 * value wins, earlier file takes priority) rather than creating a
 * second row — this is what makes importing `Contacts (3).csv` AND
 * `Contacts (4).csv` together produce ONE contact per real Xero contact,
 * not two. */
export function mergeXeroContactRows(...batches: XeroContactRow[][]): XeroContactRow[] {
  const byKey = new Map<string, XeroContactRow>();
  for (const batch of batches) {
    for (const row of batch) {
      const key = row.contactName.trim().toLowerCase();
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, row);
        continue;
      }
      byKey.set(key, {
        ...existing,
        accountNumber: pickNonBlank(existing.accountNumber, row.accountNumber),
        email: pickNonBlank(existing.email, row.email),
        firstName: pickNonBlank(existing.firstName, row.firstName),
        lastName: pickNonBlank(existing.lastName, row.lastName),
        addressLine1: pickNonBlank(existing.addressLine1, row.addressLine1),
        addressLine2: pickNonBlank(existing.addressLine2, row.addressLine2),
        city: pickNonBlank(existing.city, row.city),
        region: pickNonBlank(existing.region, row.region),
        postalCode: pickNonBlank(existing.postalCode, row.postalCode),
        country: pickNonBlank(existing.country, row.country),
        phone: pickNonBlank(existing.phone, row.phone),
        mobile: pickNonBlank(existing.mobile, row.mobile),
        bankAccountName: pickNonBlank(existing.bankAccountName, row.bankAccountName),
        bankAccountNumber: pickNonBlank(existing.bankAccountNumber, row.bankAccountNumber),
        taxNumber: pickNonBlank(existing.taxNumber, row.taxNumber),
        website: pickNonBlank(existing.website, row.website),
        legalName: pickNonBlank(existing.legalName, row.legalName),
        companyNumber: pickNonBlank(existing.companyNumber, row.companyNumber),
      });
    }
  }
  return [...byKey.values()];
}

export type ContactRole = "Customer" | "Supplier" | "Both" | "Unused";

/** A contact's role is determined by where it's actually USED — the
 * task's own instruction ("Determine whether each contact is acting as
 * Customer/Supplier/Both based on the source data") — never guessed from
 * the contact's own fields (Xero's Contacts export has no explicit
 * Customer/Supplier flag). */
export function classifyContactRole(contactName: string, customerNames: Set<string>, supplierNames: Set<string>): ContactRole {
  const key = contactName.trim().toLowerCase();
  const isCustomer = customerNames.has(key);
  const isSupplier = supplierNames.has(key);
  if (isCustomer && isSupplier) return "Both";
  if (isCustomer) return "Customer";
  if (isSupplier) return "Supplier";
  return "Unused";
}

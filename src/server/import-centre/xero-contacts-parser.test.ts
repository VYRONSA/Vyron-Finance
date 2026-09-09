import { describe, expect, it } from "vitest";
import { parseXeroContactsCsv, mergeXeroContactRows, classifyContactRole } from "./xero-contacts-parser";

const HEADER =
  "*ContactName,AccountNumber,EmailAddress,FirstName,LastName,POAttentionTo,POAddressLine1,POAddressLine2,POAddressLine3,POAddressLine4,POCity,PORegion,POPostalCode,POCountry,SAAttentionTo,SAAddressLine1,SAAddressLine2,SAAddressLine3,SAAddressLine4,SACity,SARegion,SAPostalCode,SACountry,PhoneNumber,FaxNumber,MobileNumber,DDINumber,SkypeName,BankAccountName,BankAccountNumber,BankAccountParticulars,TaxNumber,AccountsReceivableTaxCodeName,AccountsPayableTaxCodeName,Website,LegalName,Discount,CompanyNumber,DueDateBillDay,DueDateBillTerm,DueDateSalesDay,DueDateSalesTerm,SalesAccount,PurchasesAccount,TrackingName1,SalesTrackingOption1,PurchasesTrackingOption1,TrackingName2,SalesTrackingOption2,PurchasesTrackingOption2,BrandingTheme,DefaultTaxBills,DefaultTaxSales,Person1FirstName,Person1LastName,Person1Email,Person1IncludeInEmail,Person2FirstName,Person2LastName,Person2Email,Person2IncludeInEmail,Person3FirstName,Person3LastName,Person3Email,Person3IncludeInEmail,Person4FirstName,Person4LastName,Person4Email,Person4IncludeInEmail,Person5FirstName,Person5LastName,Person5Email,Person5IncludeInEmail";

function row(contactName: string, overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    "*ContactName": contactName, AccountNumber: "", EmailAddress: "", FirstName: "", LastName: "", POAttentionTo: "",
    POAddressLine1: "", POAddressLine2: "", POAddressLine3: "", POAddressLine4: "", POCity: "", PORegion: "", POPostalCode: "", POCountry: "",
    SAAttentionTo: "", SAAddressLine1: "", SAAddressLine2: "", SAAddressLine3: "", SAAddressLine4: "", SACity: "", SARegion: "", SAPostalCode: "", SACountry: "",
    PhoneNumber: "", FaxNumber: "", MobileNumber: "", DDINumber: "", SkypeName: "", BankAccountName: "", BankAccountNumber: "", BankAccountParticulars: "",
    TaxNumber: "", AccountsReceivableTaxCodeName: "", AccountsPayableTaxCodeName: "", Website: "", LegalName: "", Discount: "", CompanyNumber: "",
    DueDateBillDay: "", DueDateBillTerm: "", DueDateSalesDay: "", DueDateSalesTerm: "", SalesAccount: "", PurchasesAccount: "",
    TrackingName1: "", SalesTrackingOption1: "", PurchasesTrackingOption1: "", TrackingName2: "", SalesTrackingOption2: "", PurchasesTrackingOption2: "",
    BrandingTheme: "", DefaultTaxBills: "", DefaultTaxSales: "",
    Person1FirstName: "", Person1LastName: "", Person1Email: "", Person1IncludeInEmail: "",
    Person2FirstName: "", Person2LastName: "", Person2Email: "", Person2IncludeInEmail: "",
    Person3FirstName: "", Person3LastName: "", Person3Email: "", Person3IncludeInEmail: "",
    Person4FirstName: "", Person4LastName: "", Person4Email: "", Person4IncludeInEmail: "",
    Person5FirstName: "", Person5LastName: "", Person5Email: "", Person5IncludeInEmail: "",
    ...overrides,
  };
  return HEADER.split(",").map((h) => fields[h] ?? "").join(",");
}

describe("parseXeroContactsCsv", () => {
  it("parses a real-shaped Xero Contacts export, preserving AccountNumber/email/address/tax fields", () => {
    const csv = [HEADER, row("AL Lifestyle (Pty) Ltd T/A Jellyfish", { AccountNumber: "AL001", EmailAddress: "ian@handcraftedfoods.co.za", POCity: "Simons Town", CompanyNumber: "2021/582258/07" })].join("\n");
    const { contacts, skipped } = parseXeroContactsCsv(csv, "Contacts (3).csv");
    expect(skipped).toHaveLength(0);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ contactName: "AL Lifestyle (Pty) Ltd T/A Jellyfish", accountNumber: "AL001", email: "ian@handcraftedfoods.co.za", city: "Simons Town", companyNumber: "2021/582258/07" });
  });

  it("skips a row with a blank *ContactName but other data present, and reports why", () => {
    const csv = [HEADER, row("", { EmailAddress: "someone@example.com" })].join("\n");
    const { contacts, skipped } = parseXeroContactsCsv(csv, "Contacts (3).csv");
    expect(contacts).toHaveLength(0);
    expect(skipped).toEqual([{ rowNumber: 2, reason: "Missing *ContactName." }]);
  });

  it("silently skips a genuinely blank row (every field empty), same as every other row-based parser in this codebase", () => {
    const csv = [HEADER, row("")].join("\n");
    const { contacts, skipped } = parseXeroContactsCsv(csv, "Contacts (3).csv");
    expect(contacts).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });

  it("reports missing-header files instead of silently returning nothing that looks successful", () => {
    const { contacts, skipped } = parseXeroContactsCsv("Name,Email\nAlec,alec@example.com", "bad.csv");
    expect(contacts).toHaveLength(0);
    expect(skipped[0].reason).toContain("Missing required column");
  });
});

describe("mergeXeroContactRows", () => {
  it("reconciles two batches by *ContactName (case-insensitive) into ONE contact, never two", () => {
    const batchA = parseXeroContactsCsv([HEADER, row("Bakers Square Bakers CC", { EmailAddress: "edna@bakers-square.co.za" })].join("\n"), "Contacts (3).csv").contacts;
    const batchB = parseXeroContactsCsv([HEADER, row("bakers square bakers cc", { PhoneNumber: "0834543542" })].join("\n"), "Contacts (4).csv").contacts;
    const merged = mergeXeroContactRows(batchA, batchB);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ email: "edna@bakers-square.co.za", phone: "0834543542" });
  });

  it("keeps distinct contacts from different files as distinct rows", () => {
    const batchA = parseXeroContactsCsv([HEADER, row("AL Lifestyle (Pty) Ltd T/A Jellyfish")].join("\n"), "Contacts (3).csv").contacts;
    const batchB = parseXeroContactsCsv([HEADER, row("ALLFLEX")].join("\n"), "Contacts (4).csv").contacts;
    expect(mergeXeroContactRows(batchA, batchB)).toHaveLength(2);
  });

  it("first file's non-blank value wins on a genuine conflict", () => {
    const batchA = parseXeroContactsCsv([HEADER, row("Gourmet Cape Distributors (PTY)LTD", { EmailAddress: "first@example.com" })].join("\n"), "a.csv").contacts;
    const batchB = parseXeroContactsCsv([HEADER, row("Gourmet Cape Distributors (PTY)LTD", { EmailAddress: "second@example.com" })].join("\n"), "b.csv").contacts;
    expect(mergeXeroContactRows(batchA, batchB)[0].email).toBe("first@example.com");
  });
});

describe("classifyContactRole", () => {
  const customers = new Set(["dulcenbosch (pty) ltd"]);
  const suppliers = new Set(["boxes for africa"]);
  const both = new Set(["gourmet cape distributors (pty)ltd"]);
  const suppliersWithBoth = new Set([...suppliers, ...both]);
  const customersWithBoth = new Set([...customers, ...both]);

  it("Customer only", () => {
    expect(classifyContactRole("Dulcenbosch (Pty) Ltd", customers, suppliers)).toBe("Customer");
  });
  it("Supplier only", () => {
    expect(classifyContactRole("Boxes for Africa", customers, suppliers)).toBe("Supplier");
  });
  it("Both, when the contact appears in both Sales Invoices and Bills", () => {
    expect(classifyContactRole("Gourmet Cape Distributors (PTY)LTD", customersWithBoth, suppliersWithBoth)).toBe("Both");
  });
  it("Unused when a contact is in the Contacts export but never invoiced/billed", () => {
    expect(classifyContactRole("Alec", customers, suppliers)).toBe("Unused");
  });
});

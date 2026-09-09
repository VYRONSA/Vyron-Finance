import { describe, expect, it } from "vitest";
import {
  parseCustomerImportCsv,
  parseSupplierImportCsv,
  SUPPLIER_IMPORT_TEMPLATE_HEADERS,
  CUSTOMER_IMPORT_TEMPLATE_HEADERS,
} from "./customer-supplier-import-parser";

describe("parseCustomerImportCsv — Finding #035 (RC-12)", () => {
  it("parses a well-formed CSV into rows", () => {
    const csv = [
      "Customer Code,Name,Group,VAT Number,Registration Number,Credit Limit,Payment Terms (Days)",
      "CUST001,Acme Trading,Retail,4123456789,2021/123456/07,50000,30",
    ].join("\n");
    const { rows, errors } = parseCustomerImportCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { rowNumber: 2, customerCode: "CUST001", name: "Acme Trading", customerGroup: "Retail", vatNumber: "4123456789", registrationNumber: "2021/123456/07", creditLimit: 50000, paymentTermsDays: 30 },
    ]);
  });

  it("defaults customerCode, creditLimit, and paymentTermsDays when columns are blank", () => {
    const csv = ["Name", "Beta Supplies"].join("\n");
    const { rows, errors } = parseCustomerImportCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0].customerCode).toBe("IMP-2");
    expect(rows[0].creditLimit).toBe(0);
    expect(rows[0].paymentTermsDays).toBe(30);
  });

  it("skips a row with no Name and reports it instead of throwing", () => {
    const csv = ["Customer Code,Name", "CUST002,", "CUST003,Gamma Co"].join("\n");
    const { rows, errors } = parseCustomerImportCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Gamma Co");
    expect(errors).toEqual(["Row 2: Name is required — skipped."]);
  });

  // Phase 32 — "which column is missing; which columns were detected;
  // where the user can get the correct template," not just a bare
  // "could not find" with no path forward.
  it("reports an error and returns no rows when there is no Name column", () => {
    const csv = ["Code,Group", "C1,Retail"].join("\n");
    const { rows, errors } = parseCustomerImportCsv(csv);
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('the required "Name" column was not found');
    expect(errors[0]).toContain("Columns found in the file: Code, Group");
    expect(errors[0]).toContain("Download the Customer Import Template");
  });

  it("reports an error for an empty file", () => {
    const { rows, errors } = parseCustomerImportCsv("");
    expect(rows).toEqual([]);
    expect(errors).toEqual(["The file is empty."]);
  });

  it("matches column headers case- and spacing-insensitively", () => {
    const csv = ["customer name,  credit LIMIT ", "Delta Ltd,1000"].join("\n");
    const { rows, errors } = parseCustomerImportCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ name: "Delta Ltd", creditLimit: 1000 });
  });

  // Phase 32A — a non-blank, non-numeric Credit Limit / Payment Terms must
  // reject the row, never silently become the same default a blank cell
  // gets (the old `Number(x) || default` bug).
  it("rejects a row with a non-numeric Credit Limit instead of silently defaulting", () => {
    const csv = ["Name,Credit Limit", "Epsilon Co,not-a-number"].join("\n");
    const { rows, errors } = parseCustomerImportCsv(csv);
    expect(rows).toEqual([]);
    expect(errors).toEqual(['Row 2: Credit Limit "not-a-number" is not a valid number — skipped.']);
  });

  it("rejects a row with a non-numeric Payment Terms (Days) instead of silently defaulting to 30", () => {
    const csv = ["Name,Payment Terms (Days)", "Zeta Ltd,thirty"].join("\n");
    const { rows, errors } = parseCustomerImportCsv(csv);
    expect(rows).toEqual([]);
    expect(errors).toEqual(['Row 2: Payment Terms (Days) "thirty" is not a valid number — skipped.']);
  });

  it("still accepts a valid numeric Credit Limit and Payment Terms", () => {
    const csv = ["Name,Credit Limit,Payment Terms (Days)", "Eta Traders,25000,60"].join("\n");
    const { rows, errors } = parseCustomerImportCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ creditLimit: 25000, paymentTermsDays: 60 });
  });
});

describe("parseSupplierImportCsv — Finding #039 (RC-12)", () => {
  it("parses a well-formed CSV into rows", () => {
    const csv = ["Supplier Code,Name,Category,Payment Terms (Days)", "SUP001,Northwind Freight,Logistics,45"].join("\n");
    const { rows, errors } = parseSupplierImportCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ rowNumber: 2, supplierCode: "SUP001", name: "Northwind Freight", supplierCategory: "Logistics", paymentTermsDays: 45 }]);
  });

  it("skips a row with no Name and reports it", () => {
    const csv = ["Supplier Code,Name", "SUP002,", "SUP003,Valid Supplier"].join("\n");
    const { rows, errors } = parseSupplierImportCsv(csv);
    expect(rows).toHaveLength(1);
    expect(errors).toEqual(["Row 2: Name is required — skipped."]);
  });

  it("defaults paymentTermsDays to 30 when blank", () => {
    const csv = ["Name", "No Terms Supplier"].join("\n");
    const { rows } = parseSupplierImportCsv(csv);
    expect(rows[0].paymentTermsDays).toBe(30);
  });

  // Phase 32A — a non-blank, non-numeric Payment Terms must reject the
  // row, not silently coerce to 30 (the old `Number(value) || 30` bug).
  it("rejects a row with a non-numeric Payment Terms (Days) instead of silently defaulting to 30", () => {
    const csv = ["Name,Payment Terms (Days)", "Theta Supplies,N/A"].join("\n");
    const { rows, errors } = parseSupplierImportCsv(csv);
    expect(rows).toEqual([]);
    expect(errors).toEqual(['Row 2: Payment Terms (Days) "N/A" is not a valid number — skipped.']);
  });

  it("still accepts a valid numeric Payment Terms (Days)", () => {
    const csv = ["Name,Payment Terms (Days)", "Iota Freight,15"].join("\n");
    const { rows, errors } = parseSupplierImportCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0].paymentTermsDays).toBe(15);
  });

  // Phase 32 — same improved error UX as Customers above.
  it("reports an error and returns no rows when there is no Name column", () => {
    const csv = ["Code,Category", "S1,Logistics"].join("\n");
    const { rows, errors } = parseSupplierImportCsv(csv);
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('the required "Name" column was not found');
    expect(errors[0]).toContain("Columns found in the file: Code, Category");
    expect(errors[0]).toContain("Download the Supplier Import Template");
  });
});

// Phase 32 — "the template must be generated from the ACTUAL importer
// contract... do not invent columns." These lock in that the exported
// template-header constants a "Download Template" button reads are
// exactly what `findColumn` above recognises — every header listed here
// must be independently provable as accepted, not just asserted.
describe("template header contracts (Phase 32)", () => {
  it("SUPPLIER_IMPORT_TEMPLATE_HEADERS starts with the required Name column", () => {
    expect(SUPPLIER_IMPORT_TEMPLATE_HEADERS[0]).toBe("Name");
  });

  it("every SUPPLIER_IMPORT_TEMPLATE_HEADERS column is genuinely recognised by the parser", () => {
    const csv = [SUPPLIER_IMPORT_TEMPLATE_HEADERS.join(","), "Acme,SUP001,Retail,30"].join("\n");
    const { rows, errors } = parseSupplierImportCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ rowNumber: 2, supplierCode: "SUP001", name: "Acme", supplierCategory: "Retail", paymentTermsDays: 30 }]);
  });

  it("CUSTOMER_IMPORT_TEMPLATE_HEADERS starts with the required Name column", () => {
    expect(CUSTOMER_IMPORT_TEMPLATE_HEADERS[0]).toBe("Name");
  });

  it("every CUSTOMER_IMPORT_TEMPLATE_HEADERS column is genuinely recognised by the parser", () => {
    const csv = [CUSTOMER_IMPORT_TEMPLATE_HEADERS.join(","), "Acme,CUST001,Retail,4123456789,2021/123456/07,50000,30"].join("\n");
    const { rows, errors } = parseCustomerImportCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { rowNumber: 2, customerCode: "CUST001", name: "Acme", customerGroup: "Retail", vatNumber: "4123456789", registrationNumber: "2021/123456/07", creditLimit: 50000, paymentTermsDays: 30 },
    ]);
  });
});

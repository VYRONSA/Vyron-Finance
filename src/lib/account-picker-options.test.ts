import { describe, expect, it } from "vitest";
import { glAccountOptions, vatCodeOptions, supplierOptions } from "./account-picker-options";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatTreatment } from "@/server/company-management/types";
import type { Supplier } from "@/server/accounting/types";

function account(overrides: Partial<ChartOfAccount> & Pick<ChartOfAccount, "id" | "accountCode">): ChartOfAccount {
  return {
    companyId: "co_1", description: "Test Account", accountType: "Expense", category: "", normalBalance: "Debit",
    parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "", branchId: null,
    departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("glAccountOptions", () => {
  it("maps active accounts into combobox options with a searchable code+description", () => {
    const result = glAccountOptions([account({ id: 1, accountCode: "4000", description: "Fuel Expenses", accountType: "Expense" })]);
    expect(result).toEqual([{ value: "4000", label: "4000 — Fuel Expenses", sublabel: "Expense", searchText: "4000 Fuel Expenses Expense" }]);
  });

  it("excludes inactive accounts", () => {
    const result = glAccountOptions([
      account({ id: 1, accountCode: "4000", isActive: true }),
      account({ id: 2, accountCode: "4999", isActive: false }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("4000");
  });
});

function vatTreatment(overrides: Partial<VatTreatment> & Pick<VatTreatment, "id" | "code">): VatTreatment {
  return { companyId: "co_1", name: "Standard Rated", rate: 15, vatType: "Standard", isActive: true, createdAt: "2026-01-01T00:00:00Z", ...overrides };
}

describe("vatCodeOptions", () => {
  it("maps active VAT treatments into combobox options", () => {
    const result = vatCodeOptions([vatTreatment({ id: 1, code: "STD", name: "Standard Rated", rate: 15 })]);
    expect(result).toEqual([{ value: "STD", label: "STD", sublabel: "15% · Standard Rated", searchText: "STD Standard Rated 15" }]);
  });

  it("excludes inactive treatments", () => {
    const result = vatCodeOptions([vatTreatment({ id: 1, code: "STD", isActive: true }), vatTreatment({ id: 2, code: "OLD", isActive: false })]);
    expect(result).toHaveLength(1);
  });
});

function supplier(overrides: Partial<Supplier> & Pick<Supplier, "id" | "name">): Supplier {
  return {
    companyId: "co_1", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active",
    supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "",
    bankBranchCode: "", vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 0, spendingLimit: 0,
    ...overrides,
  };
}

// Phase 38 — Phase 37's production audit found Inactive suppliers
// (deactivated merge duplicates) selectable in four operational pickers,
// traced to this being the ONE function in this file that didn't filter
// to Active internally like its GL/VAT/Stock siblings above. This is the
// single shared fix point.
describe("supplierOptions (Phase 38)", () => {
  it("maps active suppliers into combobox options", () => {
    const result = supplierOptions([supplier({ id: 1, name: "Acme Supplies", supplierCode: "SUP-1", alternativeNames: ["Acme"] })]);
    expect(result).toEqual([{ value: 1, label: "Acme Supplies", sublabel: "SUP-1", searchText: "SUP-1 Acme Supplies Acme" }]);
  });

  it("excludes inactive suppliers — the exact production defect (deactivated merge duplicates leaking into pickers)", () => {
    const result = supplierOptions([
      supplier({ id: 1, name: "Acme Supplies", status: "Active" }),
      supplier({ id: 2, name: "Acme Supplies (dup)", status: "Inactive" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(1);
  });
});

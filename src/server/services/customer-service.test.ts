import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/customer-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/customer-repository")>();
  return {
    ...actual,
    getCustomer: vi.fn(),
    listCustomerContacts: vi.fn(),
    createCustomerContact: vi.fn(),
    deleteCustomerContact: vi.fn(),
    listCustomerAddresses: vi.fn(),
    createCustomerAddress: vi.fn(),
    deleteCustomerAddress: vi.fn(),
  };
});
vi.mock("@/server/services/communication-service", () => ({ queueCommunication: vi.fn() }));
vi.mock("@/server/services/company-service", () => ({ getCompany: vi.fn() }));
vi.mock("@/server/repositories/permission-repository", () => ({ recordPermissionAuditEntry: vi.fn() }));

import { createCustomer, editRequiresElevatedPermission, validateCustomerInput, validateVatAndRegistrationNumbers, ValidationError } from "./customer-service";
import {
  listCustomerContacts,
  createCustomerContact,
  deleteCustomerContact,
  listCustomerAddresses,
  createCustomerAddress,
  deleteCustomerAddress,
  NotFoundError,
} from "./customer-service";
import * as repo from "@/server/repositories/customer-repository";
import type { Customer } from "@/server/customer-management/types";

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 1,
    companyId: "co_1",
    customerCode: "CUST-1000",
    name: "Meridian Traders",
    customerType: "Company",
    customerGroup: "",
    industry: "",
    vatNumber: "",
    registrationNumber: "",
    creditLimit: 0,
    paymentTermsDays: 0,
    currencyCode: null,
    priceList: "",
    salesRep: "",
    riskRating: "Low",
    notes: "",
    isActive: true,
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("validateCustomerInput", () => {
  it("accepts a well-formed customer", () => {
    expect(() => validateCustomerInput({ customerCode: "CUST-1000", name: "Meridian Traders" })).not.toThrow();
  });

  it("rejects a blank customer code", () => {
    expect(() => validateCustomerInput({ customerCode: "  ", name: "Meridian Traders" })).toThrow(ValidationError);
  });

  it("rejects a customer code with disallowed characters", () => {
    expect(() => validateCustomerInput({ customerCode: "CUST 1000 / A", name: "Meridian Traders" })).toThrow(ValidationError);
  });

  it("rejects a blank name", () => {
    expect(() => validateCustomerInput({ customerCode: "CUST-1000", name: "  " })).toThrow(ValidationError);
  });
});

// Phase 32A — was previously only enforced inside `updateCustomer`, so a
// bulk CSV import (which calls `createCustomer` row-by-row) silently
// accepted malformed values. `validateVatAndRegistrationNumbers` is the
// shared function both paths now call.
describe("validateVatAndRegistrationNumbers", () => {
  it("accepts a valid 10-digit VAT Number", () => {
    expect(() => validateVatAndRegistrationNumbers("4123456789", undefined)).not.toThrow();
  });

  it("rejects a VAT Number that isn't 10 digits", () => {
    expect(() => validateVatAndRegistrationNumbers("12345", undefined)).toThrow(ValidationError);
    expect(() => validateVatAndRegistrationNumbers("12345", undefined)).toThrow("VAT Number must be 10 digits.");
  });

  it("accepts a valid YYYY/NNNNNN/NN Registration Number", () => {
    expect(() => validateVatAndRegistrationNumbers(undefined, "2021/123456/07")).not.toThrow();
  });

  it("rejects a Registration Number that doesn't match YYYY/NNNNNN/NN", () => {
    expect(() => validateVatAndRegistrationNumbers(undefined, "2021-123456-07")).toThrow(ValidationError);
    expect(() => validateVatAndRegistrationNumbers(undefined, "2021-123456-07")).toThrow("Registration Number must be in the format YYYY/NNNNNN/NN.");
  });

  it("is blank-tolerant — neither field is required", () => {
    expect(() => validateVatAndRegistrationNumbers(undefined, undefined)).not.toThrow();
    expect(() => validateVatAndRegistrationNumbers("", "")).not.toThrow();
    expect(() => validateVatAndRegistrationNumbers("   ", "   ")).not.toThrow();
  });
});

describe("createCustomer — VAT/Registration validation gap (Phase 32A)", () => {
  it("rejects an invalid VAT Number instead of silently accepting it, closing the bulk-import gap", async () => {
    await expect(createCustomer("co_1", { customerCode: "CUST-2000", name: "Import Row", vatNumber: "12345" })).rejects.toThrow(ValidationError);
    await expect(createCustomer("co_1", { customerCode: "CUST-2000", name: "Import Row", vatNumber: "12345" })).rejects.toThrow("VAT Number must be 10 digits.");
  });

  it("rejects an invalid Registration Number instead of silently accepting it", async () => {
    await expect(createCustomer("co_1", { customerCode: "CUST-2001", name: "Import Row", registrationNumber: "not-a-reg-number" })).rejects.toThrow(ValidationError);
  });
});

describe("editRequiresElevatedPermission", () => {
  it("requires elevated permission when credit limit is present", () => {
    expect(editRequiresElevatedPermission({ creditLimit: 50000 })).toBe(true);
  });

  it("requires elevated permission even when credit limit is set to zero", () => {
    expect(editRequiresElevatedPermission({ creditLimit: 0 })).toBe(true);
  });

  it("does not require elevated permission for non-sensitive fields", () => {
    expect(editRequiresElevatedPermission({ name: "New Name", industry: "Manufacturing", notes: "..." })).toBe(false);
  });

  it("does not require elevated permission for an empty edit", () => {
    expect(editRequiresElevatedPermission({})).toBe(false);
  });
});

describe("Customer Contacts/Addresses — cross-company ownership guard (Phase 25K)", () => {
  beforeEach(() => {
    vi.mocked(repo.getCustomer).mockReset();
    vi.mocked(repo.listCustomerContacts).mockReset().mockResolvedValue([]);
    vi.mocked(repo.createCustomerContact).mockReset();
    vi.mocked(repo.deleteCustomerContact).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(repo.listCustomerAddresses).mockReset().mockResolvedValue([]);
    vi.mocked(repo.createCustomerAddress).mockReset();
    vi.mocked(repo.deleteCustomerAddress).mockReset().mockResolvedValue(undefined as never);
  });

  it("rejects listing contacts for a customer that doesn't belong to this company", async () => {
    vi.mocked(repo.getCustomer).mockResolvedValue(null);
    await expect(listCustomerContacts("company-a", 999)).rejects.toThrow(NotFoundError);
    expect(repo.listCustomerContacts).not.toHaveBeenCalled();
  });

  it("rejects creating a contact for a customer that doesn't belong to this company", async () => {
    vi.mocked(repo.getCustomer).mockResolvedValue(null);
    await expect(createCustomerContact("company-a", 999, { name: "Jane" })).rejects.toThrow(NotFoundError);
    expect(repo.createCustomerContact).not.toHaveBeenCalled();
  });

  it("rejects deleting a contact for a customer that doesn't belong to this company", async () => {
    vi.mocked(repo.getCustomer).mockResolvedValue(null);
    await expect(deleteCustomerContact("company-a", 999, 5)).rejects.toThrow(NotFoundError);
    expect(repo.deleteCustomerContact).not.toHaveBeenCalled();
  });

  it("rejects listing/creating/deleting addresses for a customer that doesn't belong to this company", async () => {
    vi.mocked(repo.getCustomer).mockResolvedValue(null);
    await expect(listCustomerAddresses("company-a", 999)).rejects.toThrow(NotFoundError);
    await expect(createCustomerAddress("company-a", 999, { addressType: "Billing", line1: "1 Main St" })).rejects.toThrow(NotFoundError);
    await expect(deleteCustomerAddress("company-a", 999, 5)).rejects.toThrow(NotFoundError);
    expect(repo.listCustomerAddresses).not.toHaveBeenCalled();
    expect(repo.createCustomerAddress).not.toHaveBeenCalled();
    expect(repo.deleteCustomerAddress).not.toHaveBeenCalled();
  });

  it("proceeds normally when the customer genuinely belongs to this company", async () => {
    vi.mocked(repo.getCustomer).mockResolvedValue(customer({ id: 5, companyId: "co_1" }));

    await listCustomerContacts("co_1", 5);
    expect(repo.listCustomerContacts).toHaveBeenCalledWith(5);

    await deleteCustomerContact("co_1", 5, 10);
    expect(repo.deleteCustomerContact).toHaveBeenCalledWith(10);
  });
});

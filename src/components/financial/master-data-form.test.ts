/**
 * Phase 5I — validation for the customer and supplier create forms.
 *
 * These rules deliberately MIRROR the server's own
 * (`customer-service.ts`, `supplier-management-service.ts`) rather than
 * adding new ones: the server re-validates everything and stays the
 * authority. Client validation exists so the person is told which field
 * is wrong before a round trip.
 */
import { describe, expect, it } from "vitest";
import { validateCustomerForm, validateSupplierForm } from "./master-data-form";

const validCustomer = { code: "ACME", name: "Acme Ltd", vatNumber: "", registrationNumber: "", contactEmail: "" };
const validSupplier = { name: "Acme Supplies", vatNumber: "", registrationNumber: "", contactEmail: "" };

describe("validateCustomerForm", () => {
  it("accepts the minimum: a code and a name", () => {
    expect(validateCustomerForm(validCustomer)).toEqual({});
  });

  it("requires a customer code", () => {
    expect(validateCustomerForm({ ...validCustomer, code: "   " }).code).toMatch(/code is required/i);
  });

  it("requires a customer name", () => {
    expect(validateCustomerForm({ ...validCustomer, name: "" }).name).toMatch(/name is required/i);
  });

  it("rejects a code with characters the server would reject", () => {
    expect(validateCustomerForm({ ...validCustomer, code: "ACME LTD!" }).code).toMatch(/letters, numbers/i);
  });

  it("accepts a valid 10-digit VAT number", () => {
    expect(validateCustomerForm({ ...validCustomer, vatNumber: "4123456789" }).vatNumber).toBeUndefined();
  });

  it.each(["123", "41234567890", "4123 456789", "ABCDEFGHIJ"])("rejects the malformed VAT number %s", (vat) => {
    expect(validateCustomerForm({ ...validCustomer, vatNumber: vat }).vatNumber).toMatch(/10 digits/i);
  });

  it("leaves VAT optional — a non-vendor customer genuinely has none", () => {
    expect(validateCustomerForm({ ...validCustomer, vatNumber: "" }).vatNumber).toBeUndefined();
    expect(validateCustomerForm({ ...validCustomer, vatNumber: "   " }).vatNumber).toBeUndefined();
  });

  it("accepts a valid registration number", () => {
    expect(validateCustomerForm({ ...validCustomer, registrationNumber: "2016/112233/07" }).registrationNumber).toBeUndefined();
  });

  it.each(["2016-112233-07", "16/112233/07", "2016/11223/07", "nonsense"])("rejects the malformed registration number %s", (reg) => {
    expect(validateCustomerForm({ ...validCustomer, registrationNumber: reg }).registrationNumber).toMatch(/YYYY/);
  });

  it("leaves the registration number optional", () => {
    expect(validateCustomerForm({ ...validCustomer, registrationNumber: "" }).registrationNumber).toBeUndefined();
  });

  it("accepts a valid email and rejects an obvious typo", () => {
    expect(validateCustomerForm({ ...validCustomer, contactEmail: "billing@acme.co.za" }).contactEmail).toBeUndefined();
    expect(validateCustomerForm({ ...validCustomer, contactEmail: "billing@acme" }).contactEmail).toMatch(/valid email/i);
    expect(validateCustomerForm({ ...validCustomer, contactEmail: "" }).contactEmail).toBeUndefined();
  });

  it("reports every problem at once rather than one at a time", () => {
    const errors = validateCustomerForm({ code: "", name: "", vatNumber: "12", registrationNumber: "x", contactEmail: "y" });
    expect(Object.keys(errors).sort()).toEqual(["code", "contactEmail", "name", "registrationNumber", "vatNumber"]);
  });
});

describe("validateSupplierForm", () => {
  it("accepts a name alone", () => {
    expect(validateSupplierForm(validSupplier)).toEqual({});
  });

  it("requires a supplier name", () => {
    expect(validateSupplierForm({ ...validSupplier, name: "  " }).name).toMatch(/name is required/i);
  });

  it("does NOT require a supplier code — matching the server and the schema", () => {
    // `ae_suppliers.supplier_code` has only a partial unique index, on
    // non-blank codes, and the service only requires a name. Making the
    // code mandatory here would be a behaviour change, not validation.
    expect(validateSupplierForm(validSupplier).name).toBeUndefined();
  });

  it("validates VAT and registration numbers the same way as customers", () => {
    expect(validateSupplierForm({ ...validSupplier, vatNumber: "4123456789" }).vatNumber).toBeUndefined();
    expect(validateSupplierForm({ ...validSupplier, vatNumber: "123" }).vatNumber).toMatch(/10 digits/i);
    expect(validateSupplierForm({ ...validSupplier, registrationNumber: "2016/112233/07" }).registrationNumber).toBeUndefined();
    expect(validateSupplierForm({ ...validSupplier, registrationNumber: "bad" }).registrationNumber).toMatch(/YYYY/);
  });

  it("validates the contact email", () => {
    expect(validateSupplierForm({ ...validSupplier, contactEmail: "ap@supplier.co.za" }).contactEmail).toBeUndefined();
    expect(validateSupplierForm({ ...validSupplier, contactEmail: "nope" }).contactEmail).toMatch(/valid email/i);
  });
});

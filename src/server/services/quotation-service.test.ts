import { describe, expect, it } from "vitest";
import { canTransitionQuotationStatus, validateQuotationLines, ValidationError } from "./quotation-service";
import type { QuotationStatus } from "@/server/sales/types";

const ALL: QuotationStatus[] = ["Draft", "Sent", "Accepted", "Rejected", "Expired", "Converted"];

describe("canTransitionQuotationStatus", () => {
  it("allows the happy path Draft -> Sent -> Accepted -> Converted", () => {
    expect(canTransitionQuotationStatus("Draft", "Sent")).toBe(true);
    expect(canTransitionQuotationStatus("Sent", "Accepted")).toBe(true);
    expect(canTransitionQuotationStatus("Accepted", "Converted")).toBe(true);
  });

  it("allows Sent -> Rejected and Sent -> Expired", () => {
    expect(canTransitionQuotationStatus("Sent", "Rejected")).toBe(true);
    expect(canTransitionQuotationStatus("Sent", "Expired")).toBe(true);
  });

  it("treats Rejected, Expired, and Converted as terminal", () => {
    for (const from of ["Rejected", "Expired", "Converted"] as QuotationStatus[]) {
      for (const to of ALL) expect(canTransitionQuotationStatus(from, to)).toBe(false);
    }
  });

  it("rejects skipping Sent (Draft cannot go straight to Accepted)", () => {
    expect(canTransitionQuotationStatus("Draft", "Accepted")).toBe(false);
  });
});

describe("validateQuotationLines", () => {
  it("accepts well-formed lines", () => {
    expect(() => validateQuotationLines([{ description: "Widget", quantity: 2, unitPrice: 100 }])).not.toThrow();
  });

  it("rejects an empty line list", () => {
    expect(() => validateQuotationLines([])).toThrow(ValidationError);
  });

  it("rejects a zero or negative quantity", () => {
    expect(() => validateQuotationLines([{ description: "Widget", quantity: 0, unitPrice: 100 }])).toThrow(ValidationError);
  });

  it("rejects a negative unit price", () => {
    expect(() => validateQuotationLines([{ description: "Widget", quantity: 1, unitPrice: -1 }])).toThrow(ValidationError);
  });
});

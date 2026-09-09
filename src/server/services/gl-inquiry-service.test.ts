import { describe, expect, it } from "vitest";
import { computeRunningBalances, decodeGlCursor, encodeGlCursor, parseGlInquiryFilters, ValidationError } from "./gl-inquiry-service";

describe("parseGlInquiryFilters", () => {
  it("defaults every filter to null when nothing is supplied", () => {
    const filters = parseGlInquiryFilters(new URLSearchParams());
    expect(filters).toEqual({
      dateFrom: null,
      dateTo: null,
      accountId: null,
      reference: null,
      search: null,
      branchId: null,
      departmentId: null,
      costCentreId: null,
      sourceType: null,
    });
  });

  it("parses a fully populated filter set", () => {
    const params = new URLSearchParams({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      accountId: "5",
      reference: "INV-100",
      search: "freight",
      branchId: "1",
      departmentId: "2",
      costCentreId: "3",
      sourceType: "bank_transactions_bulk",
    });
    expect(parseGlInquiryFilters(params)).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      accountId: 5,
      reference: "INV-100",
      search: "freight",
      branchId: 1,
      departmentId: 2,
      costCentreId: 3,
      sourceType: "bank_transactions_bulk",
    });
  });

  it("rejects a malformed date", () => {
    expect(() => parseGlInquiryFilters(new URLSearchParams({ dateFrom: "01/01/2026" }))).toThrow(ValidationError);
  });

  it("rejects a non-integer accountId", () => {
    expect(() => parseGlInquiryFilters(new URLSearchParams({ accountId: "abc" }))).toThrow(ValidationError);
  });
});

describe("encodeGlCursor / decodeGlCursor", () => {
  it("round-trips a cursor", () => {
    const cursor = { postingDate: "2026-07-15", id: 42 };
    expect(decodeGlCursor(encodeGlCursor(cursor))).toEqual(cursor);
  });

  it("returns null for a null cursor", () => {
    expect(encodeGlCursor(null)).toBeNull();
    expect(decodeGlCursor(null)).toBeNull();
  });

  it("rejects a tampered/garbage cursor rather than paginating from the wrong place", () => {
    expect(() => decodeGlCursor("not-valid-base64url-json")).toThrow(ValidationError);
    expect(() => decodeGlCursor(Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url"))).toThrow(ValidationError);
  });
});

describe("computeRunningBalances", () => {
  it("accumulates forward from the opening balance for a Debit-normal account", () => {
    const transactions = [
      { debit: 500, credit: 0 },
      { debit: 0, credit: 200 },
      { debit: 100, credit: 0 },
    ];
    expect(computeRunningBalances(transactions, 1000, "Debit")).toEqual([1500, 1300, 1400]);
  });

  it("signs movements the opposite way for a Credit-normal account", () => {
    const transactions = [
      { debit: 0, credit: 500 },
      { debit: 200, credit: 0 },
    ];
    expect(computeRunningBalances(transactions, 1000, "Credit")).toEqual([1500, 1300]);
  });

  it("returns an empty array for no transactions", () => {
    expect(computeRunningBalances([], 500, "Debit")).toEqual([]);
  });
});

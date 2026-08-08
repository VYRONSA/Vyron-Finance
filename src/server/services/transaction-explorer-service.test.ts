import { describe, expect, it } from "vitest";
import { allocateRow, decodeCursor, encodeCursor, parseFilters, ValidationError } from "./transaction-explorer-service";

function params(entries: [string, string][]): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of entries) p.append(k, v);
  return p;
}

describe("parseFilters", () => {
  it("returns all-null/default filters for an empty query", () => {
    expect(parseFilters(new URLSearchParams())).toEqual({
      search: null,
      dateFrom: null,
      dateTo: null,
      minAmount: null,
      maxAmount: null,
      statuses: null,
      bankAccountId: null,
      importBatch: null,
      duplicateOnly: false,
      unknownSupplierOnly: false,
      sortBy: "transactionDate",
      sortDirection: "desc",
    });
  });

  it("parses a fully populated query", () => {
    const filters = parseFilters(
      params([
        ["search", "ABC Supplies"],
        ["dateFrom", "2026-01-01"],
        ["dateTo", "2026-07-31"],
        ["minAmount", "100"],
        ["maxAmount", "5000"],
        ["status", "Matched"],
        ["status", "Suggested"],
        ["bankAccountId", "1"],
        ["importBatch", "BATCH-20260701"],
        ["duplicateOnly", "true"],
        ["unknownSupplierOnly", "true"],
        ["sortBy", "debit"],
        ["sortDirection", "asc"],
      ]),
    );
    expect(filters).toMatchObject({
      search: "ABC Supplies",
      dateFrom: "2026-01-01",
      dateTo: "2026-07-31",
      minAmount: 100,
      maxAmount: 5000,
      statuses: ["Matched", "Suggested"],
      bankAccountId: 1,
      importBatch: "BATCH-20260701",
      duplicateOnly: true,
      unknownSupplierOnly: true,
      sortBy: "debit",
      sortDirection: "asc",
    });
  });

  it("trims and treats an empty search string as absent", () => {
    expect(parseFilters(params([["search", "   "]])).search).toBeNull();
  });

  it("rejects a malformed date", () => {
    expect(() => parseFilters(params([["dateFrom", "01/01/2026"]]))).toThrow(ValidationError);
  });

  it("rejects a non-numeric amount", () => {
    expect(() => parseFilters(params([["minAmount", "not-a-number"]]))).toThrow(ValidationError);
  });

  it("rejects an unknown status", () => {
    expect(() => parseFilters(params([["status", "Bogus"]]))).toThrow(ValidationError);
  });

  it("rejects an unknown sortBy column", () => {
    expect(() => parseFilters(params([["sortBy", "beneficiary"]]))).toThrow(ValidationError);
  });

  it("rejects an unknown sortDirection", () => {
    expect(() => parseFilters(params([["sortDirection", "sideways"]]))).toThrow(ValidationError);
  });

  it("rejects a non-integer bankAccountId", () => {
    expect(() => parseFilters(params([["bankAccountId", "abc"]]))).toThrow(ValidationError);
  });
});

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a cursor with a string sort value", () => {
    const cursor = { sortValue: "2026-07-15", id: 42 };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("round-trips a cursor with a numeric sort value", () => {
    const cursor = { sortValue: 1234.56, id: 7 };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("round-trips a cursor with a null sort value", () => {
    const cursor = { sortValue: null, id: 1 };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("returns null for a null cursor", () => {
    expect(encodeCursor(null)).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });

  it("rejects a tampered/garbage cursor instead of silently mis-paginating", () => {
    expect(() => decodeCursor("not-valid-base64url-json")).toThrow(ValidationError);
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url"))).toThrow(ValidationError);
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ id: "not-a-number", sortValue: 1 })).toString("base64url"))).toThrow(ValidationError);
  });
});

// Transaction Explorer Redesign, Phase 1 — `allocateRow`'s validation
// throws synchronously, before any Supabase call, for every case below
// (invalid type; a required target missing for the given type) — these
// are the cases exercisable without mocking the database, matching this
// file's own established convention of testing the pure/no-IO paths of
// this service directly.
describe("allocateRow validation", () => {
  it("rejects an unknown allocation type", async () => {
    await expect(
      allocateRow("company-1", [1], { type: "X" as never, accountCode: null, supplierId: null, customerId: null, vatCode: null, allocationNotes: "" }, "tester"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an empty transaction id list", async () => {
    await expect(
      allocateRow("company-1", [], { type: "G", accountCode: "6100", supplierId: null, customerId: null, vatCode: null, allocationNotes: "" }, "tester"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a GL allocation with no account code", async () => {
    await expect(
      allocateRow("company-1", [1], { type: "G", accountCode: "   ", supplierId: null, customerId: null, vatCode: null, allocationNotes: "" }, "tester"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a Supplier allocation with no supplier id", async () => {
    await expect(
      allocateRow("company-1", [1], { type: "S", accountCode: null, supplierId: null, customerId: null, vatCode: null, allocationNotes: "" }, "tester"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a Customer allocation with no customer id", async () => {
    await expect(
      allocateRow("company-1", [1], { type: "C", accountCode: null, supplierId: null, customerId: null, vatCode: null, allocationNotes: "" }, "tester"),
    ).rejects.toThrow(ValidationError);
  });
});

/**
 * The pinned Batch 1B scope must be exactly the 43 documents of the
 * migration mapping — no more, no fewer — with the figures that were
 * verified in production (132 lines, R101,911.04, VAT R13,292.78,
 * journals JR001348–JR001390, 1,390 journals in the company).
 */
import { describe, expect, it } from "vitest";
import { findRepairScope, POSTED_LINE_ACCOUNT_REPAIR_SCOPES, repairScopesForCompany } from "./posted-line-account-repair-scopes";

const METANOIA = "45b3d2a0-3973-4587-a043-0e05d8d9bff3";
const cents = (xs: number[]) => xs.reduce((t, x) => t + Math.round(x * 100), 0) / 100;

describe("handcrafted-batch-1b scope", () => {
  const scope = findRepairScope(METANOIA, "handcrafted-batch-1b")!;

  it("exists for Metanoia only", () => {
    expect(scope).not.toBeNull();
    expect(findRepairScope("another-company", "handcrafted-batch-1b")).toBeNull();
    expect(repairScopesForCompany("another-company")).toEqual([]);
    expect(POSTED_LINE_ACCOUNT_REPAIR_SCOPES.map((s) => s.id)).toEqual(["handcrafted-batch-1b"]);
  });

  it("pins 43 distinct invoices, ids and journals", () => {
    expect(scope.entries).toHaveLength(43);
    expect(new Set(scope.entries.map((e) => e.invoiceNumber)).size).toBe(43);
    expect(new Set(scope.entries.map((e) => e.invoiceId)).size).toBe(43);
    expect(new Set(scope.entries.map((e) => e.journalId)).size).toBe(43);
    expect(scope.entries.every((e) => /^SI-\d{8}$/.test(e.invoiceNumber))).toBe(true);
  });

  it("covers journals JR001348 to JR001390 with no gap", () => {
    const numbers = scope.entries.map((e) => Number(e.journalNumber.slice(2))).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 43 }, (_, i) => 1348 + i));
  });

  it("adds up to the verified totals", () => {
    expect(scope.expected).toEqual({ invoices: 43, lines: 132, total: 101911.04, vatAmount: 13292.78, journals: 1390 });
    expect(scope.entries.reduce((t, e) => t + e.lines, 0)).toBe(132);
    expect(cents(scope.entries.map((e) => e.total))).toBe(101911.04);
    expect(cents(scope.entries.map((e) => e.vatAmount))).toBe(13292.78);
  });
});

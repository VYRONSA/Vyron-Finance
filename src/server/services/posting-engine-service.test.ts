import { describe, expect, it } from "vitest";
import { buildGlTransactionRowsForJournal, type PostableJournal } from "./posting-engine-service";
import type { JournalLine } from "@/server/accounting/types";

function line(overrides: Partial<JournalLine> = {}): JournalLine {
  return { id: 1, journalId: 1, accountCode: "1000", debit: 0, credit: 0, description: "", lineOrder: 0, ...overrides };
}

function journal(overrides: Partial<PostableJournal> = {}): PostableJournal {
  return {
    id: 1,
    journalNumber: "JR000001",
    journalDate: "2026-07-15",
    reference: "REF-1",
    description: "Test journal",
    lines: [
      line({ id: 1, accountCode: "6200", debit: 500, credit: 0, description: "Freight" }),
      line({ id: 2, accountCode: "1000", debit: 0, credit: 500, description: "Freight" }),
    ],
    ...overrides,
  };
}

const ACCOUNT_IDS = new Map([
  ["1000", 1],
  ["6200", 2],
]);

describe("buildGlTransactionRowsForJournal", () => {
  it("builds one GL row per journal line, resolving account codes to Chart of Accounts ids", () => {
    const result = buildGlTransactionRowsForJournal(journal(), ACCOUNT_IDS, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ accountId: 2, debit: 500, credit: 0, journalLineId: 1 });
    expect(result.rows[1]).toMatchObject({ accountId: 1, debit: 0, credit: 500, journalLineId: 2 });
  });

  it("stamps every row with the same computed financial year label and period", () => {
    const result = buildGlTransactionRowsForJournal(journal({ journalDate: "2026-07-15" }), ACCOUNT_IDS, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.every((r) => r.financialYearLabel === "FY2027")).toBe(true);
    expect(result.rows.every((r) => r.financialPeriod === 5)).toBe(true);
  });

  it("falls back to the journal's own description when a line has none", () => {
    const result = buildGlTransactionRowsForJournal(
      journal({ lines: [line({ accountCode: "1000", debit: 100, description: "" }), line({ accountCode: "6200", credit: 100, description: "" })] }),
      ACCOUNT_IDS,
      3,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.every((r) => r.description === "Test journal")).toBe(true);
  });

  it("rejects a journal with no lines", () => {
    const result = buildGlTransactionRowsForJournal(journal({ lines: [] }), ACCOUNT_IDS, 3);
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/no lines/i) });
  });

  it("rejects an unbalanced journal rather than posting a wrong ledger", () => {
    const result = buildGlTransactionRowsForJournal(
      journal({ lines: [line({ accountCode: "1000", debit: 500 }), line({ accountCode: "6200", credit: 400 })] }),
      ACCOUNT_IDS,
      3,
    );
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/does not balance/i) });
  });

  it("rejects a line whose account code has no Chart of Accounts entry", () => {
    const result = buildGlTransactionRowsForJournal(
      journal({ lines: [line({ accountCode: "9999-MISSING", debit: 500 }), line({ accountCode: "6200", credit: 500 })] }),
      ACCOUNT_IDS,
      3,
    );
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/no chart of accounts entry/i) });
  });
});

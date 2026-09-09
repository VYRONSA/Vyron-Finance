/**
 * The rule that lets VYRON import every genuine source record while
 * keeping a re-submitted import idempotent. Pure, and shared by every
 * ingestion path, so it is worth testing on its own: a bug here either
 * silently drops a client's transactions (the old behaviour) or silently
 * duplicates them (the obvious wrong fix).
 */
import { describe, expect, it } from "vitest";
import { assignSourceOccurrences, sourceOccurrenceKey, type SourceOccurrenceKeyed } from "./import-source-occurrence";

function row(overrides: Partial<SourceOccurrenceKeyed> = {}): SourceOccurrenceKeyed {
  return {
    bankAccount: "Metanoia Hospitality",
    transactionDate: "2026-03-15",
    reference: "",
    description: "Payable Payment — Three Streams Fish",
    debit: 112134.57,
    credit: 0,
    ...overrides,
  };
}

describe("assignSourceOccurrences", () => {
  it("numbers identical rows 1, 2, 3 in source order", () => {
    const stamped = assignSourceOccurrences([row(), row(), row()]);
    expect(stamped.map((r) => r.sourceOccurrence)).toEqual([1, 2, 3]);
  });

  it("numbers each distinct value tuple independently", () => {
    const stamped = assignSourceOccurrences([row(), row({ debit: 50 }), row(), row({ debit: 50 })]);
    expect(stamped.map((r) => r.sourceOccurrence)).toEqual([1, 1, 2, 2]);
  });

  it("is deterministic — the same file parsed twice produces the same ordinals", () => {
    const file = [row(), row({ debit: 50 }), row()];
    expect(assignSourceOccurrences(file).map((r) => r.sourceOccurrence)).toEqual(assignSourceOccurrences(file).map((r) => r.sourceOccurrence));
  });

  it("does not renumber a row when an UNRELATED row is inserted above it", () => {
    // This is why the ordinal is per-value-tuple rather than a row
    // number: a statement re-exported with one extra line at the top
    // would otherwise shift every row below it and dedup nothing.
    const before = assignSourceOccurrences([row(), row()]);
    const after = assignSourceOccurrences([row({ debit: 999, description: "Unrelated" }), row(), row()]);
    expect(after.slice(1).map((r) => r.sourceOccurrence)).toEqual(before.map((r) => r.sourceOccurrence));
  });

  it("preserves every input field alongside the ordinal", () => {
    const [stamped] = assignSourceOccurrences([{ ...row(), extra: "kept" }]);
    expect(stamped).toMatchObject({ description: "Payable Payment — Three Streams Fish", debit: 112134.57, extra: "kept", sourceOccurrence: 1 });
  });

  it("handles an empty source", () => {
    expect(assignSourceOccurrences([])).toEqual([]);
  });

  it("treats a null transaction date as its own value, not as a wildcard", () => {
    const stamped = assignSourceOccurrences([row({ transactionDate: null }), row({ transactionDate: null }), row()]);
    expect(stamped.map((r) => r.sourceOccurrence)).toEqual([1, 2, 1]);
  });
});

describe("sourceOccurrenceKey", () => {
  it("rounds amounts to the 2 decimals the database actually stores", () => {
    // `debit`/`credit` are numeric(14, 2): 100.004 and 100 are the same
    // stored value, so a parser rounding difference must not make a row
    // look like a distinct record.
    expect(sourceOccurrenceKey(row({ debit: 100 }))).toBe(sourceOccurrenceKey(row({ debit: 100.004 })));
  });

  it("distinguishes rows that differ in any key column", () => {
    const base = sourceOccurrenceKey(row());
    expect(sourceOccurrenceKey(row({ bankAccount: "Other" }))).not.toBe(base);
    expect(sourceOccurrenceKey(row({ transactionDate: "2026-03-16" }))).not.toBe(base);
    expect(sourceOccurrenceKey(row({ reference: "INV-1" }))).not.toBe(base);
    expect(sourceOccurrenceKey(row({ description: "Something else" }))).not.toBe(base);
    expect(sourceOccurrenceKey(row({ debit: 112134.58 }))).not.toBe(base);
    expect(sourceOccurrenceKey(row({ credit: 1 }))).not.toBe(base);
  });

  it("distinguishes a debit from a credit of the same amount", () => {
    expect(sourceOccurrenceKey(row({ debit: 500, credit: 0 }))).not.toBe(sourceOccurrenceKey(row({ debit: 0, credit: 500 })));
  });
});

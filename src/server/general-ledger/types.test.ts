/**
 * Phase 30 — GL account codes must sort NUMERICALLY ascending (lowest
 * code to highest code), never lexicographically. `account_code` is a
 * TEXT column that currently happens to hold only same-length 4-digit
 * codes in production, which makes lexicographic sort LOOK correct by
 * coincidence — these tests prove the real, numeric behavior directly,
 * including the cases where the two orderings would actually disagree.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { compareGlAccountCodes, sortByGlAccountCode } from "./types";

describe("compareGlAccountCodes (Phase 30)", () => {
  it("1000 sorts before 1010", () => {
    expect(compareGlAccountCodes("1000", "1010")).toBeLessThan(0);
  });
  it("1010 sorts before 1100", () => {
    expect(compareGlAccountCodes("1010", "1100")).toBeLessThan(0);
  });
  it("1200 sorts before 5000", () => {
    expect(compareGlAccountCodes("1200", "5000")).toBeLessThan(0);
  });
  it("5000 sorts before 5010", () => {
    expect(compareGlAccountCodes("5000", "5010")).toBeLessThan(0);
  });
  it("5010 sorts before 5100", () => {
    expect(compareGlAccountCodes("5010", "5100")).toBeLessThan(0);
  });
  it("is genuinely numeric, not lexicographic — the one case where they disagree", () => {
    // Lexicographically "500" < "1000" (the character '5' > '1', but as a
    // PREFIX comparison "1000" loses to "500" only if compared digit-by-digit
    // the wrong way — the clearest disagreement is a longer number that
    // starts with a smaller leading digit than a shorter one, e.g.:
    expect(compareGlAccountCodes("2000", "10000")).toBeLessThan(0); // 2000 < 10000 numerically
    expect("2000".localeCompare("10000")).toBeGreaterThan(0); // but "2000" > "10000" lexicographically — proves the two genuinely differ
  });
  it("returns 0 for identical codes", () => {
    expect(compareGlAccountCodes("6100", "6100")).toBe(0);
  });
  it("falls back to a stable lexicographic comparison for non-numeric codes, never throwing", () => {
    expect(() => compareGlAccountCodes("A100", "B200")).not.toThrow();
    expect(compareGlAccountCodes("A100", "B200")).toBeLessThan(0);
  });
  it("treats a blank string as non-numeric (falls back to lexicographic) rather than coercing to 0", () => {
    expect(compareGlAccountCodes("", "1000")).not.toBe(-1000);
    expect(() => compareGlAccountCodes("", "1000")).not.toThrow();
  });
});

describe("sortByGlAccountCode (Phase 30)", () => {
  function acc(accountCode: string) {
    return { accountCode };
  }

  it("sorts a full realistic chart ascending, numerically", () => {
    const shuffled = [acc("6100"), acc("1000"), acc("5010"), acc("2000"), acc("1010"), acc("5000"), acc("1200"), acc("3000"), acc("1100")];
    const sorted = sortByGlAccountCode(shuffled).map((a) => a.accountCode);
    expect(sorted).toEqual(["1000", "1010", "1100", "1200", "2000", "3000", "5000", "5010", "6100"]);
  });

  it("lexicographic ordering cannot reappear — a differently-sized code lands in its correct numeric position", () => {
    const accounts = [acc("10000"), acc("2000"), acc("500"), acc("1000")];
    const sorted = sortByGlAccountCode(accounts).map((a) => a.accountCode);
    // Numeric truth: 500 < 1000 < 2000 < 10000. A lexicographic sort would
    // have produced ["10000", "1000", "2000", "500"] instead — genuinely wrong.
    expect(sorted).toEqual(["500", "1000", "2000", "10000"]);
  });

  it("never mutates the input array", () => {
    const original = [acc("2000"), acc("1000")];
    const originalOrder = original.map((a) => a.accountCode);
    sortByGlAccountCode(original);
    expect(original.map((a) => a.accountCode)).toEqual(originalOrder);
  });

  it("is a stable sort — equal-scoring ties keep their original relative order", () => {
    const a = { accountCode: "6100", tag: "first" };
    const b = { accountCode: "6100", tag: "second" };
    const sorted = sortByGlAccountCode([a, b]);
    expect(sorted.map((x) => x.tag)).toEqual(["first", "second"]);
  });
});

// Phase 30A — `fn_trial_balance` (migration 0088) fixes the DB-side Trial
// Balance ordering with `order by length(coa.account_code), coa.account_code`
// — deliberately length-then-lexicographic rather than a `::integer` cast,
// so it can never error on a genuinely non-numeric account code (the
// format already permits letters/dots/dashes/underscores). This codebase
// has no local Postgres/pgTAP test harness (confirmed — no such pattern
// exists anywhere in this engagement), so the live SQL function itself
// cannot be unit-tested directly. What CAN be — and is, here — proven
// directly: (1) the length-then-lexicographic ALGORITHM the migration
// uses is mathematically correct for non-negative, non-leading-zero
// numeric strings (every real account code in this system), mirrored as
// a small pure JS function; and (2) it agrees EXACTLY with the
// already-tested, already-shipped `compareGlAccountCodes` (the JS-side
// fix from Phase 30) for the specific pairwise orderings requested —
// i.e. the SQL and application-side fixes are consistent with each
// other, not two silently-diverging implementations of "numeric order."
describe("Trial Balance ordering algorithm (Phase 30A, migration 0088)", () => {
  /** Mirrors `order by length(coa.account_code), coa.account_code` from
   * the SQL migration exactly — shorter codes first, then lexicographic
   * within equal length. */
  function lengthThenLexicographic(a: string, b: string): number {
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  const REQUESTED_PAIRS: [string, string][] = [
    ["1000", "1010"],
    ["1010", "1200"],
    ["1200", "2000"],
    ["2000", "2100"],
    ["4000", "5000"],
    ["5000", "6100"],
    ["6100", "6800"],
    ["6800", "6940"],
    ["6940", "7040"],
  ];

  it.each(REQUESTED_PAIRS)("Trial Balance ordering: %s comes before %s", (lower, higher) => {
    expect(lengthThenLexicographic(lower, higher)).toBeLessThan(0);
  });

  it("agrees exactly with compareGlAccountCodes for the full requested chain", () => {
    const codes = ["1000", "1010", "1200", "2000", "2100", "4000", "5000", "6100", "6800", "6940", "7040"];
    const shuffled = [...codes].reverse();
    const sqlOrder = [...shuffled].sort(lengthThenLexicographic);
    const jsOrder = sortByGlAccountCode(shuffled.map((accountCode) => ({ accountCode }))).map((a) => a.accountCode);
    expect(sqlOrder).toEqual(codes);
    expect(jsOrder).toEqual(codes);
  });

  it("never throws on a hypothetical non-numeric code — the exact reason a ::integer cast was deliberately avoided", () => {
    // Same length (4 chars each) — falls to the lexicographic branch,
    // still a deterministic, non-throwing result, unlike `::integer`
    // (which would raise a runtime error and break Trial Balance
    // entirely for the whole company the moment a non-numeric code like
    // this existed).
    expect(() => lengthThenLexicographic("A100", "1000")).not.toThrow();
    expect(lengthThenLexicographic("A100", "1000")).toBeGreaterThan(0); // 'A' > '1' lexicographically
  });
});

// Phase 30B — migration 0088 (not applied to production — this test only
// reads the LOCAL file, it never touches a database) contains two
// changes: the Trial Balance ordering fix (already covered above) and
// the ONE approved GL 9999 Suspense classification correction. Since
// this codebase has no local Postgres/pgTAP harness to execute the SQL
// against, this is a static, textual proof that the migration file
// itself is narrowly scoped exactly as required — a "golden file" check
// that would fail if a future edit accidentally widened the WHERE
// clause or touched a different column/account.
describe("migration 0088 — GL 9999 Suspense correction is narrowly scoped (Phase 30B)", () => {
  const migrationSql = readFileSync(join(process.cwd(), "supabase/migrations/0088_trial_balance_numeric_ordering.sql"), "utf8");

  it("still contains the unchanged Trial Balance ordering fix", () => {
    expect(migrationSql).toContain("order by length(coa.account_code), coa.account_code");
  });

  it("updates account_type to Asset for GL 9999", () => {
    expect(migrationSql).toMatch(/update\s+chart_of_accounts\s+set\s+account_type\s*=\s*'Asset'/i);
  });

  it("scopes the update to exactly account_code '9999' and description 'Suspense'", () => {
    expect(migrationSql).toMatch(/where[\s\S]*account_code\s*=\s*'9999'/i);
    expect(migrationSql).toMatch(/where[\s\S]*description\s*=\s*'Suspense'/i);
  });

  it("only guards against re-applying to an already-corrected row (account_type = 'Equity' in the WHERE, not re-asserted elsewhere) — never touches category or normal_balance", () => {
    expect(migrationSql).toMatch(/where[\s\S]*account_type\s*=\s*'Equity'/i);
    // The SET clause must be exactly `account_type = 'Asset'` and nothing
    // else — category/normal_balance/description/account_code are never
    // assigned anywhere in this statement.
    const updateStatement = migrationSql.slice(migrationSql.indexOf("update chart_of_accounts"));
    const setClause = updateStatement.slice(updateStatement.indexOf("set"), updateStatement.indexOf("where"));
    expect(setClause).not.toMatch(/category\s*=/i);
    expect(setClause).not.toMatch(/normal_balance\s*=/i);
    expect(setClause).not.toMatch(/description\s*=/i);
    expect(setClause).not.toMatch(/account_code\s*=/i);
  });

  it("the UPDATE statement touches only chart_of_accounts — no transaction, journal, allocation, or rule table appears in it (the unrelated, unchanged fn_trial_balance function above it legitimately still joins gl_transactions, which is why this check is scoped to the UPDATE statement specifically, not the whole file)", () => {
    const updateStatement = migrationSql.slice(migrationSql.indexOf("update chart_of_accounts"));
    expect(updateStatement).not.toMatch(/ae_bank_transactions/i);
    expect(updateStatement).not.toMatch(/gl_transactions/i);
    expect(updateStatement).not.toMatch(/ae_allocation_history/i);
    expect(updateStatement).not.toMatch(/banking_rule/i);
  });

  it("contains exactly one UPDATE statement — no other account's classification is touched by this file", () => {
    const updateCount = (migrationSql.match(/\bupdate\s+chart_of_accounts\b/gi) ?? []).length;
    expect(updateCount).toBe(1);
  });
});

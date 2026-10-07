/**
 * @vitest-environment node
 *
 * SD-3C — amounts and dates as South African statements print them.
 * Every ambiguous or unreadable case must come back UNRESOLVED, never guessed.
 */
import { describe, expect, it } from "vitest";
import { inferDecimalStyle, looksLikeDate, looksLikeMoney, parseStatementAmount, parseStatementDate } from "./amounts";

const NBSP = String.fromCharCode(0xa0);

describe("parseStatementAmount", () => {
  it.each([
    ["1 234,56", "comma", 1234.56],
    ["1 234.56", "point", 1234.56],
    ["1,234.56", "point", 1234.56],
    ["1.234,56", "comma", 1234.56],
    ["1234.56", "point", 1234.56],
    ["1234,56", "comma", 1234.56],
    [`R${NBSP}1${NBSP}234.56`, "point", 1234.56],
    ["R 1 234.56", "point", 1234.56],
    ["ZAR 99.10", "point", 99.1],
    ["12,5", "comma", 12.5],
    ["1 000 000.00", "point", 1000000],
    ["1,000,000.00", "point", 1000000],
    ["2 500", null, 2500],
    ["0.00", "point", 0],
  ] as const)("reads %s (%s) as %s", (raw, style, expected) => {
    expect(parseStatementAmount(raw, style)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ["(500.00)", -500],
    ["500.00-", -500],
    ["-500.00", -500],
    ["500.00 CR", -500],
    ["500.00CR", -500],
    ["500.00 Cr", -500],
    ["500.00 DR", 500],
    ["R -500.00", -500],
    ["(1 234.56) CR", 1234.56],
  ] as const)("reads the sign of %s", (raw, expected) => {
    expect(parseStatementAmount(raw, "point")).toEqual({ ok: true, value: expected });
  });

  it.each([
    ["1,234", null],
    ["1.234", null],
    ["1,234", "comma"],
    ["1.234", "point"],
    ["1,234.56", "comma"],
    ["1.234,56", "point"],
  ] as const)("%s with style %s is AMBIGUOUS, not guessed", (raw, style) => {
    expect(parseStatementAmount(raw, style)).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("an ambiguous value resolves only once the statement's style is known", () => {
    expect(parseStatementAmount("1,234", "point")).toEqual({ ok: true, value: 1234 });
    expect(parseStatementAmount("1.234", "comma")).toEqual({ ok: true, value: 1234 });
  });

  it.each(["12 34,56", "1 2?4.00", "abc", "1..2", "12.345.6", "1,23,456.00", "R", "4O0.00", "1 234 5.00"])("%s is unreadable", (raw) => {
    expect(parseStatementAmount(raw, "point").ok).toBe(false);
  });

  it.each(["", "   ", "-", null, undefined])("%s is empty", (raw) => {
    expect(parseStatementAmount(raw as string, "point")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("inferDecimalStyle", () => {
  it("comes from the amounts that can only mean one thing", () => {
    expect(inferDecimalStyle(["1 234.56", "1,234", "12.00"])).toBe("point");
    expect(inferDecimalStyle(["1 234,56", "1.234", "500,00 CR"])).toBe("comma");
    expect(inferDecimalStyle(["1.234,56"])).toBe("comma");
  });
  it("is null with no evidence or conflicting evidence", () => {
    expect(inferDecimalStyle(["1,234", "2 500"])).toBeNull();
    expect(inferDecimalStyle(["1.50", "2,50"])).toBeNull();
  });
});

describe("looksLikeMoney", () => {
  it.each(["1 234.56", "(500.00)", "500.00 CR", "12,50", "1,234.56-"])("%s is money", (t) => expect(looksLikeMoney(t)).toBe(true));
  it.each(["0001042", "2026", "INV-0010041", "30/09/2026", "Page 1 of 2"])("%s is not money", (t) => expect(looksLikeMoney(t)).toBe(false));
});

describe("parseStatementDate", () => {
  it.each([
    ["30/09/2026", "2026-09-30"],
    ["30-09-2026", "2026-09-30"],
    ["30.09.2026", "2026-09-30"],
    ["1/9/26", "2026-09-01"],
    ["2026-09-30", "2026-09-30"],
    ["31 Jan 2026", "2026-01-31"],
    ["31-Jan-26", "2026-01-31"],
    ["31 January 2026", "2026-01-31"],
    ["Sep 5, 2026", "2026-09-05"],
    ["01/01/99", "1999-01-01"],
  ])("reads %s day-first as %s", (raw, expected) => {
    expect(parseStatementDate(raw)).toEqual({ ok: true, iso: expected });
  });

  it("gives a year to a date printed without one, from the statement date — across a year end", () => {
    expect(parseStatementDate("15 Sep", { statementDate: "2026-09-30" })).toEqual({ ok: true, iso: "2026-09-15" });
    expect(parseStatementDate("28 Dec", { statementDate: "2027-01-31" })).toEqual({ ok: true, iso: "2026-12-28" });
  });

  it("a date without a year and no statement date is ambiguous", () => {
    expect(parseStatementDate("15 Sep")).toEqual({ ok: false, reason: "ambiguous" });
  });

  it.each(["31/02/2026", "00/01/2026", "32/01/2026", "30/13/2026"])("%s is impossible", (raw) => {
    expect(parseStatementDate(raw)).toEqual({ ok: false, reason: "impossible" });
  });

  it.each(["??/09/2026", "Sept-ish", "2026"])("%s is unreadable", (raw) => {
    expect(parseStatementDate(raw).ok).toBe(false);
  });

  it("looksLikeDate", () => {
    expect(looksLikeDate("30/09/2026")).toBe(true);
    expect(looksLikeDate("31 Jan")).toBe(true);
    expect(looksLikeDate("0001042")).toBe(false);
    expect(looksLikeDate("1 234.56")).toBe(false);
  });
});

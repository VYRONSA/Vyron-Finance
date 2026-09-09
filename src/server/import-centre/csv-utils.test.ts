import { describe, expect, it } from "vitest";
import { decodeCsvBuffer, parseAmount, parseCsvText, parseDate, round2 } from "./csv-utils";

describe("parseDate", () => {
  it("parses ISO dates", () => {
    expect(parseDate("2026-01-05")).toBe("2026-01-05");
    expect(parseDate("2026/01/05")).toBe("2026-01-05");
  });

  it("prefers day-first over month-first for ambiguous dd/mm dates", () => {
    // 15 can only be a day, so this must resolve as 15 Mar, not fail as month 15.
    expect(parseDate("15/03/2026")).toBe("2026-03-15");
  });

  it("falls back to month-first when day-first is out of range", () => {
    // 13 can't be a month, so dd/mm/yyyy fails and mm/dd/yyyy is tried next.
    expect(parseDate("03/13/2026")).toBe("2026-03-13");
  });

  it("parses named-month formats", () => {
    expect(parseDate("15 Jan 2026")).toBe("2026-01-15");
    expect(parseDate("15 January 2026")).toBe("2026-01-15");
  });

  it("rejects calendar-invalid dates", () => {
    expect(parseDate("30/02/2026")).toBeNull();
  });

  it("returns null for empty/garbage input", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate("not-a-date")).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });
});

describe("parseAmount", () => {
  it("parses plain and comma-separated numbers", () => {
    expect(parseAmount("1200.00")).toBe(1200);
    expect(parseAmount("1,200.00")).toBe(1200);
  });

  it("strips currency symbols", () => {
    expect(parseAmount("R 1 200.00")).toBe(1200);
    expect(parseAmount("$500")).toBe(500);
  });

  it("treats parenthesised values as negative", () => {
    expect(parseAmount("(300.00)")).toBe(-300);
  });

  it("returns null for empty or unusable text", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("not-a-number")).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });
});

describe("round2", () => {
  it("rounds to two decimal places", () => {
    expect(round2(1.006)).toBeCloseTo(1.01, 2);
    expect(round2(120)).toBe(120);
  });
});

describe("parseCsvText", () => {
  it("splits plain rows on commas", () => {
    expect(parseCsvText("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles a quoted field containing a comma", () => {
    const rows = parseCsvText('a,b\n"1, comma",plain\n');
    expect(rows[0]).toEqual(["a", "b"]);
    expect(rows[1]).toEqual(["1, comma", "plain"]);
  });

  it("handles a quoted field containing an embedded newline", () => {
    const rows = parseCsvText('a,b\n"line one\nline two",plain\n');
    expect(rows[1]).toEqual(["line one\nline two", "plain"]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    const rows = parseCsvText('a,b\n"she said ""hi""",plain\n');
    expect(rows[1]).toEqual(['she said "hi"', "plain"]);
  });

  it("does not emit a trailing empty row for a trailing newline", () => {
    expect(parseCsvText("a,b\n1,2\n")).toHaveLength(2);
  });
});

describe("decodeCsvBuffer", () => {
  it("decodes UTF-8 text and strips a BOM", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from("Date,Amount\n", "utf-8")]);
    expect(decodeCsvBuffer(withBom.buffer)).toBe("Date,Amount\n");
  });

  it("decodes plain UTF-8 text without a BOM", () => {
    const buf = Buffer.from("Date,Amount\n2026-01-01,100\n", "utf-8");
    expect(decodeCsvBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))).toBe(
      "Date,Amount\n2026-01-01,100\n",
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { formatAmount, formatCount, formatDate, formatDateTime, formatDayMonth, formatLongDate, formatTime, formatWeekdayShort } from "./format";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatAmount — VYRON accounting presentation", () => {
  it.each([
    [20000, "20,000.00"],
    [0, "0.00"],
    [6, "6.00"],
    [-1234.5, "-1,234.50"],
    [1234567.891, "1,234,567.89"],
    [999.999, "1,000.00"],
    [-0.001, "0.00"],
  ])("%d → %s", (value, expected) => {
    expect(formatAmount(value)).toBe(expected);
  });

  it("honours an explicit number of decimals", () => {
    expect(formatAmount(1234.5678, 0)).toBe("1,235");
    expect(formatAmount(1234.5678, 3)).toBe("1,234.568");
  });

  it("formats counts as whole numbers", () => {
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(0)).toBe("0");
  });
});

describe("dates and times — South African time, fixed month names", () => {
  it("formats an instant in SAST (UTC+2)", () => {
    expect(formatDateTime("2026-09-14T16:09:21.352Z")).toBe("14 Sep 2026, 18:09");
    expect(formatTime("2026-09-14T16:09:21.352Z")).toBe("18:09");
  });

  it("rolls over midnight into the SAST calendar day", () => {
    expect(formatDate("2026-12-31T23:30:00Z")).toBe("1 Jan 2027");
  });

  it("takes a bare calendar date as written", () => {
    expect(formatDate("2026-07-31")).toBe("31 Jul 2026");
    expect(formatDayMonth("2026-09-14")).toBe("14 Sep");
    expect(formatWeekdayShort("2026-09-14")).toBe("Mon");
    expect(formatLongDate("2026-09-14")).toBe("Monday, 14 September 2026");
  });

  it("accepts Date objects and epoch milliseconds", () => {
    const instant = Date.UTC(2026, 8, 14, 16, 9);
    expect(formatDateTime(new Date(instant))).toBe("14 Sep 2026, 18:09");
    expect(formatDateTime(instant)).toBe("14 Sep 2026, 18:09");
  });

  it("returns unparseable input unchanged rather than 'Invalid Date'", () => {
    expect(formatDateTime("not a date")).toBe("not a date");
    expect(formatDate("")).toBe("");
  });
});

describe("independent of the runtime's locale, time zone and Intl data", () => {
  it("never calls toLocaleString / toLocaleDateString / toLocaleTimeString or Intl", () => {
    const boom = () => {
      throw new Error("runtime-locale API used");
    };
    vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(boom);
    vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(boom);
    vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(boom);
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(boom);
    vi.spyOn(Intl, "NumberFormat").mockImplementation(boom as never);
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(boom as never);

    expect(formatAmount(20000)).toBe("20,000.00");
    expect(formatCount(1234)).toBe("1,234");
    expect(formatDateTime("2026-09-14T16:09:21.352Z")).toBe("14 Sep 2026, 18:09");
    expect(formatLongDate("2026-09-14")).toBe("Monday, 14 September 2026");
  });

  it("gives the same output whatever the process time zone is", () => {
    const original = process.env.TZ;
    const outputs = new Set<string>();
    try {
      for (const tz of ["UTC", "Africa/Johannesburg", "America/New_York", "Asia/Tokyo"]) {
        process.env.TZ = tz;
        outputs.add(`${formatDateTime("2026-09-14T22:30:00Z")} | ${formatDate("2026-09-14T22:30:00Z")} | ${formatDate("2026-09-14")}`);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
    expect([...outputs]).toEqual(["15 Sep 2026, 00:30 | 15 Sep 2026 | 14 Sep 2026"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  computeFinancialPeriod,
  computeFinancialYearBounds,
  computeFinancialYearLabel,
  computePeriodLabel,
  suggestFinancialYear,
  createFinancialYear,
  findOpenJournalsInYear,
  ValidationError,
} from "./financial-year-service";
import type { Journal } from "@/server/accounting/types";

function journal(overrides: Partial<Journal> = {}): Journal {
  return {
    id: 1,
    companyId: "co_1",
    journalNumber: "JR000001",
    journalDate: "2026-06-15",
    journalType: "Manual",
    description: "",
    reference: "",
    sourceType: "manual",
    sourceId: null,
    status: "Draft",
    totalDebit: 0,
    totalCredit: 0,
    createdAt: "2026-06-15T00:00:00.000Z",
    postedAt: null,
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    isReversed: false,
    reversalOfJournalId: null,
    reversedByJournalId: null,
    postingBatchId: null,
    lines: [],
    ...overrides,
  };
}

const SA_START_MONTH = 3; // March — the reference's FINANCIAL_YEAR_START_MONTH default

describe("computeFinancialYearLabel", () => {
  it("a date in the start month belongs to the FY ending the following calendar year", () => {
    expect(computeFinancialYearLabel("2026-03-01", SA_START_MONTH)).toBe("FY2027");
  });

  it("a date the month before the start month belongs to the FY ending that same calendar year", () => {
    expect(computeFinancialYearLabel("2026-02-28", SA_START_MONTH)).toBe("FY2026");
  });

  it("a date well after the start month still belongs to the following calendar year's FY", () => {
    expect(computeFinancialYearLabel("2026-12-31", SA_START_MONTH)).toBe("FY2027");
  });

  it("with startMonth=1, every month satisfies the ported formula's `month >= startMonth` boundary, so the whole calendar year rolls forward one label — an inherent property of the reference's exact formula, not a bug in this port", () => {
    expect(computeFinancialYearLabel("2026-01-15", 1)).toBe("FY2027");
    expect(computeFinancialYearLabel("2026-12-31", 1)).toBe("FY2027");
  });
});

describe("computeFinancialPeriod", () => {
  it("the start month is always period 1", () => {
    expect(computeFinancialPeriod("2026-03-15", SA_START_MONTH)).toBe(1);
  });

  it("the month before the start month is always period 12", () => {
    expect(computeFinancialPeriod("2026-02-01", SA_START_MONTH)).toBe(12);
  });

  it("counts forward correctly through the whole year", () => {
    const expected: [string, number][] = [
      ["2026-03-01", 1], ["2026-04-01", 2], ["2026-05-01", 3], ["2026-06-01", 4],
      ["2026-07-01", 5], ["2026-08-01", 6], ["2026-09-01", 7], ["2026-10-01", 8],
      ["2026-11-01", 9], ["2026-12-01", 10], ["2027-01-01", 11], ["2027-02-01", 12],
    ];
    for (const [date, period] of expected) {
      expect(computeFinancialPeriod(date, SA_START_MONTH)).toBe(period);
    }
  });

  it("matches trivially for a January-start (calendar-year) financial year", () => {
    expect(computeFinancialPeriod("2026-01-01", 1)).toBe(1);
    expect(computeFinancialPeriod("2026-12-01", 1)).toBe(12);
  });
});

describe("computePeriodLabel", () => {
  it("zero-pads to two digits", () => {
    expect(computePeriodLabel("2026-03-01", SA_START_MONTH)).toBe("P01");
    expect(computePeriodLabel("2026-12-01", SA_START_MONTH)).toBe("P10");
  });
});

describe("computeFinancialYearBounds", () => {
  it("computes March-start South African financial year bounds, including a leap-year February", () => {
    // FY2027 = 2026-03-01 .. 2027-02-28
    expect(computeFinancialYearBounds(2027, SA_START_MONTH)).toEqual({ startDate: "2026-03-01", endDate: "2027-02-28" });
    // FY2028 ends in Feb 2028, a leap year
    expect(computeFinancialYearBounds(2028, SA_START_MONTH)).toEqual({ startDate: "2027-03-01", endDate: "2028-02-29" });
  });

  it("computes a January-start (calendar-year) financial year", () => {
    expect(computeFinancialYearBounds(2026, 1)).toEqual({ startDate: "2026-01-01", endDate: "2026-12-31" });
  });
});

describe("suggestFinancialYear", () => {
  it("suggests the financial year the reference date falls within, with real start/end dates", () => {
    expect(suggestFinancialYear("2026-07-30", SA_START_MONTH)).toEqual({
      yearLabel: "FY2027",
      startDate: "2026-03-01",
      endDate: "2027-02-28",
    });
  });
});

describe("createFinancialYear validation", () => {
  it("rejects a blank year label", () => {
    return expect(createFinancialYear("co_1", { yearLabel: "", startDate: "2026-03-01", endDate: "2027-02-28" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects a start date on or after the end date", () => {
    return expect(
      createFinancialYear("co_1", { yearLabel: "FY2027", startDate: "2027-02-28", endDate: "2026-03-01" }),
    ).rejects.toThrow(ValidationError);
  });
});

// Master Implementation Tracker — Epic E1, Finding #011.
describe("findOpenJournalsInYear", () => {
  const year = { startDate: "2026-03-01", endDate: "2027-02-28" };

  it("flags a Draft journal dated within the year", () => {
    const journals = [journal({ status: "Draft", journalDate: "2026-06-15" })];
    expect(findOpenJournalsInYear(journals, year)).toHaveLength(1);
  });

  it("flags a Submitted and an Approved journal — both are still unposted", () => {
    const journals = [journal({ id: 1, status: "Submitted" }), journal({ id: 2, status: "Approved" })];
    expect(findOpenJournalsInYear(journals, year)).toHaveLength(2);
  });

  it("never blocks on a Posted journal — that's exactly what closing the year is supposed to finalize", () => {
    const journals = [journal({ status: "Posted" })];
    expect(findOpenJournalsInYear(journals, year)).toEqual([]);
  });

  it("never blocks on Rejected or Cancelled journals — both are terminal, non-financial states", () => {
    const journals = [journal({ id: 1, status: "Rejected" }), journal({ id: 2, status: "Cancelled" })];
    expect(findOpenJournalsInYear(journals, year)).toEqual([]);
  });

  it("ignores an open journal dated outside the year", () => {
    const journals = [journal({ status: "Draft", journalDate: "2027-03-15" })];
    expect(findOpenJournalsInYear(journals, year)).toEqual([]);
  });

  it("includes journals dated exactly on the year's start or end boundary", () => {
    const journals = [journal({ id: 1, status: "Draft", journalDate: "2026-03-01" }), journal({ id: 2, status: "Draft", journalDate: "2027-02-28" })];
    expect(findOpenJournalsInYear(journals, year)).toHaveLength(2);
  });
});

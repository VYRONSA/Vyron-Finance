import { describe, expect, it } from "vitest";
import { checkPostingDate } from "./financial-period-service";
import type { FinancialYear } from "@/server/company-management/types";

function fy(overrides: Partial<FinancialYear> = {}): FinancialYear {
  return {
    id: 1,
    companyId: "co_1",
    yearLabel: "FY2026",
    startDate: "2025-03-01",
    endDate: "2026-02-28",
    status: "Open",
    isCurrent: true,
    createdAt: "2025-03-01T00:00:00Z",
    lockDate: null,
    reopenedAt: null,
    reopenedBy: null,
    ...overrides,
  };
}

describe("checkPostingDate", () => {
  it("allows a date within an Open financial year with no lock date", () => {
    const result = checkPostingDate([fy()], "2025-07-15");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.financialYear.yearLabel).toBe("FY2026");
  });

  it("rejects a date not covered by any financial year", () => {
    const result = checkPostingDate([fy()], "2027-01-01");
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/no financial year covers/i) });
  });

  it("rejects a date within a Closed financial year", () => {
    const result = checkPostingDate([fy({ status: "Closed" })], "2025-07-15");
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/is closed/i) });
  });

  it("rejects a date on the lock date itself", () => {
    const result = checkPostingDate([fy({ lockDate: "2025-06-30" })], "2025-06-30");
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/lock date/i) });
  });

  it("rejects a date before the lock date", () => {
    const result = checkPostingDate([fy({ lockDate: "2025-06-30" })], "2025-05-01");
    expect(result.ok).toBe(false);
  });

  it("allows a date after the lock date, within the same open year", () => {
    const result = checkPostingDate([fy({ lockDate: "2025-06-30" })], "2025-07-01");
    expect(result.ok).toBe(true);
  });

  it("picks the financial year whose range actually contains the date, out of several", () => {
    const priorYear = fy({ id: 2, yearLabel: "FY2025", startDate: "2024-03-01", endDate: "2025-02-28", status: "Closed" });
    const currentYear = fy({ id: 1, yearLabel: "FY2026", startDate: "2025-03-01", endDate: "2026-02-28" });
    const result = checkPostingDate([priorYear, currentYear], "2025-08-01");
    expect(result).toEqual({ ok: true, financialYear: currentYear });
  });
});

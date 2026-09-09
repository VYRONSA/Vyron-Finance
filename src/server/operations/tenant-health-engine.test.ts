import { describe, expect, it } from "vitest";
import { buildTenantHealth } from "./tenant-health-engine";

function input(overrides: Partial<Parameters<typeof buildTenantHealth>[0]> = {}) {
  return {
    companyId: "co_1",
    companyName: "Harlow Retail Group",
    lastReportingPackageAt: null,
    openVatExceptionsCount: 0,
    hasOverdueVatReturn: false,
    openAuditFindingsCount: 0,
    automationFailedTaskCount: 0,
    automationTotalTaskCount: 0,
    ...overrides,
  };
}

describe("buildTenantHealth", () => {
  it("always reports Last Backup as NotAvailable with a real reason", () => {
    const health = buildTenantHealth(input());
    expect(health.lastBackup.quality).toBe("NotAvailable");
    expect(health.lastBackup.note).toContain("Supabase");
  });

  it("flags an overdue VAT return over a mere exception count", () => {
    const health = buildTenantHealth(input({ hasOverdueVatReturn: true, openVatExceptionsCount: 2 }));
    expect(health.vatReadiness.value).toContain("Overdue");
  });

  it("reports open VAT exceptions when nothing is overdue", () => {
    const health = buildTenantHealth(input({ openVatExceptionsCount: 3 }));
    expect(health.vatReadiness.value).toContain("3 open VAT exception");
  });

  it("reports clean VAT readiness when nothing is open", () => {
    const health = buildTenantHealth(input());
    expect(health.vatReadiness.value).toContain("No open");
  });

  it("sums outstanding errors across automation/VAT/audit", () => {
    const health = buildTenantHealth(input({ automationFailedTaskCount: 2, openVatExceptionsCount: 1, openAuditFindingsCount: 3 }));
    expect(health.outstandingErrors.value).toBe(6);
  });
});

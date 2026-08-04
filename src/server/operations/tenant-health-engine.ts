/**
 * Pure per-company operational health, built entirely from real signals
 * already computed elsewhere in the platform (VAT exceptions, audit
 * findings, automation task outcomes, reporting package generation) —
 * "Last Backup" is the one field the directive names that this
 * application genuinely cannot see (Supabase manages backups at the
 * infrastructure level, invisible to application code), so it is always
 * `NotAvailable` with a real, specific reason rather than omitted or
 * guessed.
 */

import type { Metric } from "./types";

const calculated = <T>(value: T): Metric<T> => ({ value, quality: "Calculated" });
const notAvailable = <T>(note: string): Metric<T> => ({ value: null, quality: "NotAvailable", note });

export type TenantHealthInput = {
  companyId: string;
  companyName: string;
  lastReportingPackageAt: string | null;
  openVatExceptionsCount: number;
  hasOverdueVatReturn: boolean;
  openAuditFindingsCount: number;
  automationFailedTaskCount: number;
  automationTotalTaskCount: number;
};

export type TenantHealth = {
  companyId: string;
  companyName: string;
  lastBackup: Metric<string>;
  reportingReadiness: Metric<string>;
  vatReadiness: Metric<string>;
  auditReadiness: Metric<string>;
  automationHealth: Metric<string>;
  outstandingErrors: Metric<number>;
};

export function buildTenantHealth(input: TenantHealthInput): TenantHealth {
  const reportingReadiness = input.lastReportingPackageAt
    ? calculated(`Last reporting package generated ${input.lastReportingPackageAt}`)
    : calculated("No reporting package has been generated yet");

  const vatReadiness = input.hasOverdueVatReturn
    ? calculated("Overdue VAT return outstanding")
    : input.openVatExceptionsCount > 0
      ? calculated(`${input.openVatExceptionsCount} open VAT exception(s)`)
      : calculated("No open VAT exceptions or overdue returns");

  const auditReadiness = input.openAuditFindingsCount > 0
    ? calculated(`${input.openAuditFindingsCount} open audit finding(s)`)
    : calculated("No open audit findings");

  const automationHealth = input.automationTotalTaskCount === 0
    ? calculated("No automation tasks configured yet")
    : calculated(`${input.automationFailedTaskCount} of ${input.automationTotalTaskCount} automation task(s) currently failed`);

  const outstandingErrors: Metric<number> = calculated(input.automationFailedTaskCount + input.openVatExceptionsCount + input.openAuditFindingsCount);

  return {
    companyId: input.companyId,
    companyName: input.companyName,
    lastBackup: notAvailable("Backups are managed by the Supabase infrastructure layer and are not exposed to this application."),
    reportingReadiness,
    vatReadiness,
    auditReadiness,
    automationHealth,
    outstandingErrors,
  };
}

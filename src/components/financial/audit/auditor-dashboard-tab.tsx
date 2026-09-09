import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { IconShieldCheck } from "@/components/ui/icons";
import type { AuditDashboardSummary } from "@/server/services/audit-dashboard-summary-service";

function Metric({ label, value, href, tone }: { label: string; value: string | number; href?: string; tone?: "good" | "warn" | "danger" }) {
  const content = (
    <div className="rounded-vf-md border border-vf-paper-border p-4 transition hover:border-vf-red-400">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-vf-ink-faint">{label}</p>
        {tone && <Badge tone={tone}>{tone === "good" ? "OK" : tone === "warn" ? "Attention" : "Critical"}</Badge>}
      </div>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-vf-ink">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export function AuditorDashboardTab({ summary, findingsHref }: { summary: AuditDashboardSummary; findingsHref: string }) {
  const readinessTone = summary.auditReadinessScore >= 80 ? "good" : summary.auditReadinessScore >= 50 ? "warn" : "danger";
  const reconciliationTone = summary.reconciliationStatus === "Clean" ? "good" : summary.reconciliationStatus === "Attention" ? "warn" : "danger";

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-vf-md border border-vf-paper-border p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-vf-ink">Audit Readiness Score</p>
          <span className="flex items-center gap-1.5 font-mono text-lg tabular-nums text-vf-ink">
            <IconShieldCheck className={`h-4 w-4 ${readinessTone === "good" ? "text-vf-success" : readinessTone === "warn" ? "text-vf-warning" : "text-vf-danger"}`} />
            {summary.auditReadinessScore}%
          </span>
        </div>
        <p className="mt-1 text-xs text-vf-ink-faint">
          The same real score the Executive Command Centre shows — how ready this company&apos;s ledger is for an audit, computed from stale postings, open
          exceptions, and automation failures.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Material Issues" value={summary.materialIssuesCount} href={findingsHref} tone={summary.materialIssuesCount === 0 ? "good" : "danger"} />
        <Metric label="High-Risk Areas" value={summary.highRiskAreaCount} href={findingsHref} />
        <Metric label="Outstanding Exceptions" value={summary.outstandingExceptionsCount} href={findingsHref} tone={summary.outstandingExceptionsCount === 0 ? "good" : "warn"} />
        <Metric label="Missing Documents" value={summary.missingDocumentsCount} tone={summary.missingDocumentsCount === 0 ? "good" : "warn"} />
        <Metric label="Reconciliation Status" value={summary.reconciliationStatus} tone={reconciliationTone} />
        <Metric label="Internal Control Exceptions" value={summary.internalControlExceptionsCount} href={findingsHref} />
        <Metric label="VAT Risk" value={summary.vatRiskCount} href={findingsHref} />
        <Metric label="Financial Reporting Risk" value={summary.financialReportingRiskCount} href={findingsHref} />
        <Metric label="Inventory Risk" value={summary.inventoryRiskCount} href={findingsHref} />
        <Metric label="Revenue Recognition Risk" value={summary.revenueRecognitionRiskCount} href={findingsHref} />
        <Metric label="Journal Risk" value={summary.journalRiskCount} href={findingsHref} />
        <Metric label="Going Concern Indicators" value={summary.goingConcernIndicatorCount} href={findingsHref} tone={summary.goingConcernIndicatorCount === 0 ? "good" : "danger"} />
      </div>
    </div>
  );
}

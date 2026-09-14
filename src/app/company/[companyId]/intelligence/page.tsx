import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IntelligenceCentre } from "@/components/financial/intelligence/intelligence-centre";
import { VyronAsk } from "@/components/financial/intelligence/vyron-ask";
import { IconAlertTriangle, IconBank, IconBarChart, IconClock, IconGrid, IconShieldCheck, IconSparkles } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { formatDateTime } from "@/lib/format";
import { getCompany } from "@/server/services/company-service";
import { getCompanyIntelligenceSummary } from "@/server/services/company-intelligence-service";
import { buildPreviewFinancialIntelligenceSummary } from "@/lib/mock/financial-intelligence-preview";
import { MOCK_COMPANY } from "@/lib/mock/financial-data";
import { MOCK_COMPANIES_FULL } from "@/lib/mock/company-management-data";
import { FINDING_SEVERITY_LABEL, FINDING_SEVERITY_ORDER, type FindingSeverity } from "@/server/financial-intelligence/types";
import { buildBusinessSituations } from "@/server/financial-intelligence/business-situation-engine";

export const metadata: Metadata = {
  title: "VYRON Intelligence — VYRON FINANCE",
};

const SEVERITY_TILE_TONE: Record<FindingSeverity, string> = {
  Critical: "bg-vf-danger/10 text-vf-danger",
  High: "bg-vf-warning/12 text-[#93601f]",
  Medium: "bg-vf-info/10 text-vf-info",
  Low: "bg-vf-paper-alt text-vf-ink-faint",
};

export default async function IntelligenceCentrePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();
  const todayIso = new Date().toISOString().slice(0, 10);

  // Phase 11 — the Intelligence Centre's whole job is to present what
  // `getCompanyIntelligenceSummary` (Phase 10) already computed —
  // nothing on this page fetches company data independently per
  // finding; it's exactly two real, existing, independent calls
  // batched together (`getCompany` is the same lookup every company
  // page under this route already runs).
  const [company, summary] = previewMode
    ? [MOCK_COMPANIES_FULL.find((c) => c.id === MOCK_COMPANY.id) ?? MOCK_COMPANIES_FULL[0]!, buildPreviewFinancialIntelligenceSummary(companyId, todayIso)]
    : await Promise.all([getCompany(companyId), getCompanyIntelligenceSummary(companyId, todayIso)]);

  // "Inspect whether the engine produces current-state or persisted
  // findings" (brief, section 9) — confirmed in Phase 10:
  // `buildFinancialIntelligenceSummary` is pure and never writes to the
  // database. Every finding here is recomputed on this exact request —
  // there is no history to show, so none is fabricated.
  const highestSeverity = FINDING_SEVERITY_ORDER.find((sev) => summary.countBySeverity[sev] > 0) ?? null;
  const refreshedAt = formatDateTime(new Date());
  const totalFindings = summary.findings.length;

  // Phase 14 — the same pure engine runs in both real and preview mode
  // (brief, section 18: "no separate preview business situation
  // engine") since `summary.findings` is already real either way.
  const situations = buildBusinessSituations(summary.findings);

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Hero */}
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-col gap-6 p-8 lg:p-10">
          <div>
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">
              <IconSparkles className="h-3.5 w-3.5" />
              VYRON Intelligence
            </span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">VYRON Intelligence</h1>
            <p className="mt-1.5 max-w-[58ch] text-sm text-vf-on-dark-soft">Understand what needs attention across your business.</p>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-vf-on-dark-faint">
            <span className="flex items-center gap-1.5">
              <IconBank className="h-3.5 w-3.5" />
              {company?.name ?? "This company"}
            </span>
            <span className="flex items-center gap-1.5">
              <IconClock className="h-3.5 w-3.5" />
              Refreshed {refreshedAt}
            </span>
            <span className="flex items-center gap-1.5">
              <IconAlertTriangle className="h-3.5 w-3.5" />
              {totalFindings} active finding{totalFindings === 1 ? "" : "s"}
            </span>
            {highestSeverity && (
              <Badge tone={highestSeverity === "Critical" ? "danger" : highestSeverity === "High" ? "warn" : "info"} className="bg-white/12">
                Highest: {highestSeverity}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Executive Summary — grouped by the existing ExecutiveAlertPriority
          scale (Finding.severity reuses it directly — see
          FINDINGS_INVENTORY.md). Never a second severity system. */}
      <div>
        {totalFindings === 0 ? (
          <p className="text-sm text-vf-ink-faint">Your business has no active intelligence findings.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {FINDING_SEVERITY_ORDER.map((severity) => (
              <div key={severity} className={`flex flex-col gap-1.5 rounded-vf-lg p-4 shadow-vf-paper-lg ${SEVERITY_TILE_TONE[severity]}`}>
                <p className="font-mono text-2xl font-semibold tabular-nums">{summary.countBySeverity[severity]}</p>
                <p className="text-xs font-medium">{FINDING_SEVERITY_LABEL[severity]}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {totalFindings === 0 ? (
        <Card>
          <EmptyState
            icon={<IconShieldCheck className="h-5 w-5" />}
            title="Everything looks good."
            description="VYRON currently has no financial intelligence findings requiring attention."
            action={
              <div className="flex flex-wrap items-center gap-3">
                <Button href={`/company/${companyId}/dashboard`} variant="primary" size="sm">
                  <IconGrid className="h-4 w-4" />
                  Go to Dashboard
                </Button>
                <Button href={`/company/${companyId}/bank-accounts`} variant="subtle" size="sm">
                  <IconBank className="h-4 w-4" />
                  Go to Banking
                </Button>
                <Button href={`/company/${companyId}/reports`} variant="subtle" size="sm">
                  <IconBarChart className="h-4 w-4" />
                  View Reports
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <IntelligenceCentre companyId={companyId} findings={summary.findings} situations={situations} />
      )}

      {/* VYRON Ask — Phase 12. Available regardless of whether there are
          active findings; it answers "nothing needs attention" honestly
          on a clean company rather than being hidden. */}
      <VyronAsk companyId={companyId} previewMode={previewMode} />

      {/* Current Intelligence — Phase 10's engine is pure and never
          persists; there is no resolved/dismissed history to show, so
          none is invented. */}
      <p className="text-xs text-vf-ink-faint">
        Current Intelligence — these findings represent the current state of your company, recalculated on every visit to this page. They are not stored or tracked over time.
      </p>
    </div>
  );
}

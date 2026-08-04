"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { money } from "./statement-views";
import { REPORTING_PACKAGE_TYPES, type ReportingPackage, type ReportingPackageType } from "@/server/disclosures/types";
import type { ReportingPackageContents } from "@/server/reporting/reporting-package-engine";
import { SendCommunicationButton } from "@/components/financial/communications/send-communication-button";

const SENDABLE_PACKAGE_TEMPLATES: Partial<Record<ReportingPackageType, string>> = {
  ManagementPack: "ManagementPackEmail",
  BoardPack: "BoardPackEmail",
};

const PACKAGE_LABELS: Record<ReportingPackageType, string> = {
  ManagementPack: "Management Financial Pack",
  BoardPack: "Board Pack",
  AccountantPack: "Accountant Pack",
  AuditorPack: "Auditor Pack",
};

const PACKAGE_DESCRIPTIONS: Record<ReportingPackageType, string> = {
  ManagementPack: "The 3 core statements plus a management narrative — lean, internal use.",
  BoardPack: "Adds the Statement of Changes in Equity and a board-level narrative.",
  AccountantPack: "Adds the Trial Balance summary and every disclosure note, including placeholders.",
  AuditorPack: "The full Accountant Pack, plus the Audit Readiness Score and open Audit Findings count.",
};

function PackageCard({ pkg, companyId, previewMode }: { pkg: ReportingPackage; companyId: string; previewMode: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const contents = pkg.contents as unknown as ReportingPackageContents;
  const templateCode = SENDABLE_PACKAGE_TEMPLATES[pkg.packageType];

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="info">{PACKAGE_LABELS[pkg.packageType]}</Badge>
            <p className="text-sm font-medium text-vf-ink">{pkg.periodStart} to {pkg.periodEnd}</p>
          </div>
          <p className="mt-1 text-xs text-vf-ink-faint">
            Generated {new Date(pkg.generatedAt).toLocaleString()} by {pkg.generatedBy} · {pkg.financialYearLabel}
          </p>
        </div>
        <Button variant="subtle" size="sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide" : "View"}
        </Button>
      </div>
      {expanded && (
        <div className="mt-3 flex flex-col gap-3 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-vf-sm bg-vf-red-500/5 px-3 py-2">
              <p className="text-xs text-vf-ink-faint">Net Profit</p>
              <p className="font-mono font-semibold tabular-nums text-vf-ink">{money(contents.incomeStatement.netProfit)}</p>
            </div>
            <div className="rounded-vf-sm bg-vf-red-500/5 px-3 py-2">
              <p className="text-xs text-vf-ink-faint">Total Assets</p>
              <p className="font-mono font-semibold tabular-nums text-vf-ink">{money(contents.balanceSheet.totalAssets)}</p>
            </div>
            <div className="rounded-vf-sm bg-vf-red-500/5 px-3 py-2">
              <p className="text-xs text-vf-ink-faint">Closing Cash</p>
              <p className="font-mono font-semibold tabular-nums text-vf-ink">{money(contents.cashFlowStatement.closingCash)}</p>
            </div>
            <div className="rounded-vf-sm bg-vf-red-500/5 px-3 py-2">
              <p className="text-xs text-vf-ink-faint">Disclosure Notes</p>
              <p className="font-mono font-semibold tabular-nums text-vf-ink">{contents.disclosureNotes.length}</p>
            </div>
          </div>
          {contents.statementOfChangesInEquity && (
            <p className="text-xs text-vf-ink-faint">Statement of Changes in Equity included — closing balance {money(contents.statementOfChangesInEquity.totalClosingBalance)}.</p>
          )}
          {contents.trialBalanceSummary && (
            <p className="text-xs text-vf-ink-faint">
              Trial Balance summary included — {contents.trialBalanceSummary.accountCount} accounts, debit {money(contents.trialBalanceSummary.totalDebit)}, credit {money(contents.trialBalanceSummary.totalCredit)}.
            </p>
          )}
          {contents.auditSummary && (
            <p className="text-xs text-vf-ink-faint">
              Audit Readiness Score {contents.auditSummary.auditReadinessScore}% · {contents.auditSummary.openFindingsCount} open Audit Finding(s).
            </p>
          )}
          {contents.narrative && (
            <div className="rounded-vf-sm bg-vf-info/10 p-3">
              <p className="text-xs font-medium text-vf-ink-faint">{contents.narrative.title}</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-vf-ink-soft">
                {contents.narrative.facts.slice(0, 4).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {templateCode && (
            <div className="flex flex-wrap items-center gap-2 border-t border-vf-paper-border pt-3">
              <Input
                placeholder="Send to email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className="max-w-xs"
              />
              <SendCommunicationButton
                key={recipientEmail}
                companyId={companyId}
                module="FinancialStatements"
                businessObjectType="ReportingPackage"
                businessObjectId={pkg.id}
                templateCode={templateCode}
                recipients={[{ type: "Email", name: recipientEmail || "Recipient", address: recipientEmail || null }]}
                variables={{ recipientName: recipientEmail || "Recipient", period: `${pkg.periodStart} to ${pkg.periodEnd}`, companyName: "the company" }}
                previewMode={previewMode}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ReportingPackagesTab({
  companyId,
  packages,
  periodStart,
  periodEnd,
  financialYearStartDate,
  financialYearLabel,
  previewMode,
}: {
  companyId: string;
  packages: ReportingPackage[];
  periodStart: string;
  periodEnd: string;
  financialYearStartDate: string;
  financialYearLabel: string;
  previewMode: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<ReportingPackageType | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function generate(packageType: ReportingPackageType) {
    setLoading(packageType);
    try {
      await fetch(`/api/companies/${companyId}/reporting-packages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageType, periodStart, periodEnd, financialYearStartDate, financialYearLabel }),
      });
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-vf-ink-faint">Every package reuses the same real statements, disclosure notes, and narrative engine already generated above — no duplicated calculations.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {REPORTING_PACKAGE_TYPES.map((t) => (
          <div key={t} className="flex flex-col justify-between gap-3 rounded-vf-md border border-vf-paper-border p-4">
            <div>
              <p className="text-sm font-semibold text-vf-ink">{PACKAGE_LABELS[t]}</p>
              <p className="mt-1 text-xs text-vf-ink-faint">{PACKAGE_DESCRIPTIONS[t]}</p>
            </div>
            <Button variant="primary" size="sm" disabled={previewMode || loading !== null} title={disabledTitle} onClick={() => generate(t)}>
              {loading === t ? "Generating…" : "Generate"}
            </Button>
          </div>
        ))}
      </div>

      {packages.length === 0 ? (
        <EmptyState title="No reporting packages generated yet." description="Generate one above — every package bundles real statements, notes, and a narrative." />
      ) : (
        <div className="flex flex-col gap-3">
          {packages.map((p) => (
            <PackageCard key={p.id} pkg={p} companyId={companyId} previewMode={previewMode} />
          ))}
        </div>
      )}
    </div>
  );
}

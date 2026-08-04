import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { VatTabs } from "@/components/financial/vat/vat-tabs";
import { IconAlertTriangle, IconBanknote, IconFileText, IconImport, IconShieldCheck } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listVatReturns } from "@/server/services/vat-return-service";
import { listVatAdjustments } from "@/server/services/vat-adjustment-service";
import { listVatExceptions } from "@/server/services/vat-exception-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { listVatDocuments } from "@/server/services/vat-transaction-service";
import { listRateHistoryForCompany } from "@/server/repositories/vat-rate-history-repository";
import { listAuditLog } from "@/server/services/automation-audit-service";
import { buildVatDashboardSummary } from "@/server/services/vat-summary-service";
import { resolveEffectiveRate } from "@/server/vat/vat-engine";
import { buildVatIntelligence, detectMissingVatNumber, isHighRisk } from "@/server/vat/vat-intelligence";
import {
  MOCK_VAT_ADJUSTMENTS,
  MOCK_VAT_DOCUMENTS,
  MOCK_VAT_EXCEPTIONS,
  MOCK_VAT_RETURNS,
} from "@/lib/mock/vat-data";
import { MOCK_VAT_TREATMENTS } from "@/lib/mock/company-management-data";
import { MOCK_AUDIT_LOG } from "@/lib/mock/automation-data";

export const metadata: Metadata = {
  title: "VAT — VYRON FINANCE",
};

export default async function VatPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const [vatReturns, adjustments, exceptions, vatTreatments, documents, rateHistoryByTreatment, fullAuditLog] = previewMode
    ? [MOCK_VAT_RETURNS, MOCK_VAT_ADJUSTMENTS, MOCK_VAT_EXCEPTIONS, MOCK_VAT_TREATMENTS, MOCK_VAT_DOCUMENTS, new Map(), MOCK_AUDIT_LOG]
    : await Promise.all([
        listVatReturns(companyId),
        listVatAdjustments(companyId),
        listVatExceptions(companyId),
        listVatTreatments(companyId),
        listVatDocuments(companyId),
        listRateHistoryForCompany(companyId),
        listAuditLog(companyId),
      ]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const effectiveRateByTreatment = new Map<string, number>();
  for (const treatment of vatTreatments) {
    const history = rateHistoryByTreatment.get(treatment.id) ?? [];
    const rate = resolveEffectiveRate(history, todayIso);
    if (rate !== null) effectiveRateByTreatment.set(treatment.code, rate);
  }

  const intelligenceMap = buildVatIntelligence(documents, effectiveRateByTreatment);
  const missingVatNumberMap = detectMissingVatNumber(documents);
  const documentById = new Map(documents.map((d) => [d.id, d]));
  const intelligenceSignals = [
    ...[...intelligenceMap.entries()].flatMap(([id, signals]) => signals.map((signal) => ({ document: documentById.get(id)!, signal }))),
    ...[...missingVatNumberMap.entries()].map(([id, signal]) => ({ document: documentById.get(id)!, signal })),
  ].filter((s) => s.document !== undefined);

  const highRiskCount = [...new Set([...intelligenceMap.keys(), ...missingVatNumberMap.keys()])].filter((id) => {
    const signals = [...(intelligenceMap.get(id) ?? []), ...(missingVatNumberMap.get(id) ? [missingVatNumberMap.get(id)!] : [])];
    return isHighRisk(signals);
  }).length;

  const vatAuditLog = fullAuditLog.filter((e) => e.documentType === "VatReturn" || e.documentType === "VatAdjustment" || e.actionType.startsWith("Vat"));

  const latestReturn = [...vatReturns].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))[0] ?? null;
  const summary = buildVatDashboardSummary(latestReturn, vatReturns, exceptions, highRiskCount);

  function money(value: number): string {
    return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-8 lg:p-10">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">
              VAT Intelligence & Tax Compliance
            </span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">VAT</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              One VAT Engine, consumed by Sales, Purchasing, and Banking — Returns generated from live GL data,
              every recommendation explainable with confidence, reason, evidence, and a suggested correction.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "vatPayable", label: "VAT Payable", value: money(summary.vatPayable), icon: IconBanknote },
          { key: "vatReceivable", label: "VAT Receivable", value: money(summary.vatReceivable), icon: IconBanknote },
          { key: "draftReturns", label: "Draft VAT Return", value: String(summary.draftReturnCount), icon: IconFileText },
          { key: "openExceptions", label: "VAT Exceptions", value: String(summary.openExceptionCount), icon: IconAlertTriangle },
          { key: "complianceScore", label: "Compliance Score", value: `${summary.complianceScorePercent}%`, icon: IconShieldCheck },
          { key: "highRisk", label: "High-Risk Transactions", value: String(summary.highRiskTransactionCount), icon: IconAlertTriangle },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample VAT data. Every action is disabled until Supabase is configured.
        </p>
      )}

      <VatTabs
        companyId={companyId}
        summary={summary}
        documents={documents}
        intelligenceSignals={intelligenceSignals}
        exceptions={exceptions}
        adjustments={adjustments}
        vatReturns={vatReturns}
        auditLog={vatAuditLog}
        vatTreatments={vatTreatments}
        previewMode={previewMode}
      />
    </div>
  );
}

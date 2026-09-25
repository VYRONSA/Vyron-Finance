import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { SupplierWorkspace } from "@/components/financial/suppliers/supplier-workspace";
import { IconAlertTriangle, IconImport, IconShieldCheck, IconUsers } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { MOCK_SUPPLIERS } from "@/lib/mock/supplier-reconciliation-data";
import { MOCK_CHART_OF_ACCOUNTS } from "@/lib/mock/general-ledger-data";
import { MOCK_VAT_TREATMENTS } from "@/lib/mock/company-management-data";

export const metadata: Metadata = {
  title: "Suppliers — PRECISIA",
};

export default async function SuppliersPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  // Phase 5I — the create form now offers the supplier's default GL
  // account and VAT code (the two fields the Allocation Engine reads), so
  // this page needs the same option lists the supplier DETAIL page
  // already loads. Same services, same mock fallbacks.
  const [suppliers, chartOfAccounts, vatTreatments] = previewMode
    ? [MOCK_SUPPLIERS, MOCK_CHART_OF_ACCOUNTS, MOCK_VAT_TREATMENTS]
    : await Promise.all([listSuppliers(companyId), listChartOfAccounts(companyId), listVatTreatments(companyId)]);

  const activeSuppliers = suppliers.filter((s) => s.status === "Active").length;
  const highRiskSuppliers = suppliers.filter((s) => s.riskRating === "High").length;

  return (
    <div className="flex w-full flex-col gap-6">
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-8 lg:p-10">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">
              Commercial Platform
            </span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Suppliers</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              The same suppliers Matching, Allocation, and Import Centre already use — extended with banking
              details, contacts, addresses, and real Age Analysis from your imported bills.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "total", label: "Total Suppliers", value: String(suppliers.length), icon: IconUsers },
          { key: "active", label: "Active", value: String(activeSuppliers), icon: IconShieldCheck },
          { key: "highRisk", label: "High Risk", value: String(highRiskSuppliers), icon: IconAlertTriangle },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample suppliers. Every action is disabled until Supabase is configured.
        </p>
      )}

      <Card>
        <CardContent className="pt-5">
          <SupplierWorkspace companyId={companyId} suppliers={suppliers} chartOfAccounts={chartOfAccounts} vatTreatments={vatTreatments} previewMode={previewMode} />
        </CardContent>
      </Card>
    </div>
  );
}

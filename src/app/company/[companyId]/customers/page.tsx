import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { CustomerWorkspace } from "@/components/financial/customers/customer-workspace";
import { IconAlertTriangle, IconBanknote, IconBuilding, IconImport, IconShieldCheck } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listCustomers } from "@/server/services/customer-service";
import { MOCK_CUSTOMERS } from "@/lib/mock/customer-management-data";

export const metadata: Metadata = {
  title: "Customers — VYRON FINANCE",
};

function money(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `R ${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `R ${(value / 1_000).toFixed(1)}K`;
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function CustomersPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const customers = previewMode ? MOCK_CUSTOMERS : await listCustomers(companyId);

  const activeCustomers = customers.filter((c) => c.isActive).length;
  const highRiskCustomers = customers.filter((c) => c.riskRating === "High").length;
  const totalCreditLimit = customers.reduce((sum, c) => sum + c.creditLimit, 0);

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
              Commercial Platform
            </span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Customers</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Customer master data, contacts, and addresses — the foundation the Sales module will post through once
              it&rsquo;s built.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "total", label: "Total Customers", value: String(customers.length), icon: IconBuilding },
          { key: "active", label: "Active", value: String(activeCustomers), icon: IconShieldCheck },
          { key: "highRisk", label: "High Risk", value: String(highRiskCustomers), icon: IconAlertTriangle },
          { key: "creditLimit", label: "Total Credit Limit", value: money(totalCreditLimit), icon: IconBanknote },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample customers. Every action is disabled until Supabase is configured.
        </p>
      )}

      <Card>
        <CardContent className="pt-5">
          <CustomerWorkspace companyId={companyId} customers={customers} previewMode={previewMode} />
        </CardContent>
      </Card>
    </div>
  );
}

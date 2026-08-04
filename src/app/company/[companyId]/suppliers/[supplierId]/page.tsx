import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SupplierDetailTabs } from "@/components/financial/suppliers/supplier-detail-tabs";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getSupplier, listSupplierAddresses, listSupplierContacts } from "@/server/services/supplier-management-service";
import {
  buildSupplierFinancialSummary,
  buildSupplierIntelligence,
  getSupplierPurchaseHistory,
} from "@/server/services/supplier-financial-service";
import { listSupplierPaymentsBySupplier } from "@/server/services/supplier-payment-service";
import { MOCK_BILLS, MOCK_SUPPLIERS } from "@/lib/mock/supplier-reconciliation-data";
import { MOCK_SUPPLIER_ADDRESSES, MOCK_SUPPLIER_CONTACTS } from "@/lib/mock/supplier-management-data";
import { MOCK_PURCHASE_BILLS, MOCK_SUPPLIER_PAYMENTS } from "@/lib/mock/purchasing-data";
import type { SupplierRiskRating } from "@/server/accounting/types";

export const metadata: Metadata = {
  title: "Supplier — VYRON FINANCE",
};

const RISK_TONE: Record<SupplierRiskRating, "good" | "warn" | "danger"> = { Low: "good", Medium: "warn", High: "danger" };

export default async function SupplierDetailPage({ params }: { params: Promise<{ companyId: string; supplierId: string }> }) {
  const { companyId, supplierId } = await params;
  const previewMode = !isSupabaseConfigured();
  const id = Number(supplierId);

  const supplier = previewMode ? (MOCK_SUPPLIERS.find((s) => s.id === id) ?? null) : await getSupplier(companyId, id);
  if (!supplier) notFound();

  const today = new Date().toISOString().slice(0, 10);

  const [contacts, addresses, bills, payments] = previewMode
    ? [
        MOCK_SUPPLIER_CONTACTS[id] ?? [],
        MOCK_SUPPLIER_ADDRESSES[id] ?? [],
        [...MOCK_BILLS, ...MOCK_PURCHASE_BILLS].filter((b) => b.supplierId === id),
        MOCK_SUPPLIER_PAYMENTS.filter((p) => p.supplierId === id),
      ]
    : await Promise.all([
        listSupplierContacts(id),
        listSupplierAddresses(id),
        getSupplierPurchaseHistory(companyId, id),
        listSupplierPaymentsBySupplier(companyId, id),
      ]);

  const financialSummary = buildSupplierFinancialSummary(bills, payments, today);
  const intelligence = buildSupplierIntelligence(supplier, bills, today);

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
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">
                {supplier.supplierCode || "No code"} · {supplier.supplierType}
              </span>
              <Badge tone={supplier.status === "Active" ? "good" : "muted"}>{supplier.status}</Badge>
              <Badge tone={RISK_TONE[supplier.riskRating]}>{supplier.riskRating} Risk</Badge>
            </div>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">{supplier.name}</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">{supplier.supplierCategory || "No category set"}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-4xl font-semibold tabular-nums text-vf-on-dark">
              {financialSummary.outstandingBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="mt-1 text-sm text-vf-on-dark-soft">Outstanding Balance</p>
          </div>
        </CardContent>
      </Card>

      <SupplierDetailTabs
        companyId={companyId}
        supplier={supplier}
        contacts={contacts}
        addresses={addresses}
        financialSummary={financialSummary}
        intelligence={intelligence}
        bills={bills}
        previewMode={previewMode}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { BankingExceptionsTab } from "@/components/financial/banking-rules/banking-exceptions-tab";
import { IconAlertTriangle, IconImport, IconListChecks, IconShieldCheck } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listBankingExceptions } from "@/server/services/banking-exception-service";
import { MOCK_BANKING_EXCEPTIONS } from "@/lib/mock/banking-automation-data";

export const metadata: Metadata = {
  title: "Banking Exceptions — VYRON FINANCE",
};

export default async function BankingExceptionsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();
  const exceptions = previewMode ? MOCK_BANKING_EXCEPTIONS : await listBankingExceptions(companyId);

  const open = exceptions.filter((e) => e.status === "Open").length;
  const resolved = exceptions.filter((e) => e.status === "Resolved").length;
  const dismissed = exceptions.filter((e) => e.status === "Dismissed").length;

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
              Banking Automation & Rule Intelligence
            </span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Banking Exceptions</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Unknown transactions become the exception, not the normal workflow — every one includes a reason,
              the evidence behind it, and a recommended action.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "open", label: "Open", value: String(open), icon: IconAlertTriangle },
          { key: "resolved", label: "Resolved", value: String(resolved), icon: IconShieldCheck },
          { key: "dismissed", label: "Dismissed", value: String(dismissed), icon: IconListChecks },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample exceptions. Every action is disabled until Supabase is configured.
        </p>
      )}

      <BankingExceptionsTab companyId={companyId} exceptions={exceptions} previewMode={previewMode} />
    </div>
  );
}

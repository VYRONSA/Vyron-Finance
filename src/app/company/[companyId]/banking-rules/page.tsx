import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { BankingRulesTabs } from "@/components/financial/banking-rules/banking-rules-tabs";
import { IconImport } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listBankingRules } from "@/server/services/banking-rule-service";
import { MOCK_BANKING_RULES } from "@/lib/mock/banking-automation-data";

export const metadata: Metadata = {
  title: "Automation Rules — VYRON FINANCE",
};

export default async function BankingRulesPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();
  const rules = previewMode ? MOCK_BANKING_RULES : await listBankingRules(companyId);

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
              Recurring Transactions & Autonomous Automation
            </span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Automation Rules</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              One Rule Engine across every domain — Banking, Sales, Purchasing, Inventory, General Ledger, VAT,
              Reporting, and Communications. Every rule composes, runs through the same Posting Engine where it
              posts, and leaves an unrecognised item as an exception, not a silent gap.
            </p>
          </div>
        </CardContent>
      </Card>

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample rules. Every action is disabled until Supabase is configured.
        </p>
      )}

      <BankingRulesTabs companyId={companyId} rules={rules} previewMode={previewMode} />
    </div>
  );
}

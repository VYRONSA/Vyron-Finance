import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { RecurringTemplatesTab } from "@/components/financial/automation/recurring-templates-tab";
import { IconAlertTriangle, IconImport, IconListChecks, IconRefresh } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listRecurringTemplates } from "@/server/services/recurring-template-service";
import { MOCK_RECURRING_TEMPLATES } from "@/lib/mock/automation-data";

export const metadata: Metadata = {
  title: "Recurring Templates — VYRON FINANCE",
};

export default async function RecurringTemplatesPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();
  const templates = previewMode ? MOCK_RECURRING_TEMPLATES : await listRecurringTemplates(companyId);

  const active = templates.filter((t) => t.isActive).length;
  const paused = templates.filter((t) => !t.isActive).length;
  const totalGenerated = templates.reduce((sum, t) => sum + t.occurrencesGenerated, 0);

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
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Recurring Templates</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Customer Invoices, Supplier Bills, Journals, Inventory Adjustments, Statements, Reminders, and Orders —
              every template generates a real document through the same service a manually-created one uses, run by
              the shared Automation Scheduler.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "active", label: "Active Templates", value: String(active), icon: IconListChecks },
          { key: "paused", label: "Paused Templates", value: String(paused), icon: IconAlertTriangle },
          { key: "generated", label: "Occurrences Generated", value: String(totalGenerated), icon: IconRefresh },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample templates. Every action is disabled until Supabase is configured.
        </p>
      )}

      <Card>
        <CardContent className="pt-5">
          <RecurringTemplatesTab companyId={companyId} templates={templates} previewMode={previewMode} />
        </CardContent>
      </Card>
    </div>
  );
}

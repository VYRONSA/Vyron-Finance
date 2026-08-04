import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { CommunicationsTabs } from "@/components/financial/communications/communications-tabs";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listCommunications, listTemplates } from "@/server/services/communication-service";
import { buildCommunicationDashboardSummary } from "@/server/communications/dashboard-engine";
import { MOCK_COMMUNICATIONS, MOCK_COMMUNICATION_TEMPLATES } from "@/lib/mock/communications-data";
import { IconImport } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Communications — VYRON FINANCE",
};

export default async function CommunicationsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const [communications, templates] = previewMode
    ? [MOCK_COMMUNICATIONS, MOCK_COMMUNICATION_TEMPLATES]
    : await Promise.all([listCommunications(companyId), listTemplates(companyId)]);

  const dashboard = buildCommunicationDashboardSummary(communications, new Date().toISOString());

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
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Communication Platform</span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Communications</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              One Communication Engine, every channel — Email now, In-App Notifications real, SMS/WhatsApp/Teams/
              Slack/Push named for the future. Every outbound message from every module produces one shared,
              auditable record here.
            </p>
          </div>
        </CardContent>
      </Card>

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample communications. Every action is disabled until Supabase is configured.
        </p>
      )}

      <CommunicationsTabs companyId={companyId} communications={communications} templates={templates} dashboard={dashboard} previewMode={previewMode} />
    </div>
  );
}

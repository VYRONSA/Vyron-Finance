import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { OperationsTabs } from "@/components/platform/operations/operations-tabs";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCurrentUserId } from "@/server/auth/require-session";
import { listCompaniesForUser } from "@/server/services/company-service";
import { requirePermission } from "@/server/services/permission-service";
import { buildCompanyOperationsSnapshot, type CompanyOperationsSnapshot } from "@/server/services/operations-service";
import { MOCK_OPERATIONS_SNAPSHOT } from "@/lib/mock/operations-data";
import { IconImport } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Operations Centre — VYRON FINANCE",
};

export default async function OperationsCentrePage() {
  const previewMode = !isSupabaseConfigured();

  let snapshots: CompanyOperationsSnapshot[];
  if (previewMode) {
    snapshots = [MOCK_OPERATIONS_SNAPSHOT];
  } else {
    const userId = await getCurrentUserId();
    const companies = await listCompaniesForUser(userId);
    const nowIso = new Date().toISOString();
    const allowed = await Promise.all(companies.map(async (c) => ((await requirePermission(c.id, "SystemAdministration")).ok ? c : null)));
    snapshots = await Promise.all(
      allowed.filter((c) => c !== null).map((c) => buildCompanyOperationsSnapshot(c.id, nowIso)),
    );
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
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Operations Centre</span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Operations Centre</h1>
            <p className="mt-1.5 max-w-[68ch] text-sm text-vf-on-dark-soft">
              The one operational command centre for running VYRON FINANCE in production — every
              engine, queue, integration, and security signal reports in here. Live data is marked
              Live, derived signals Calculated, and anything genuinely unmeasured is honestly
              Not Available — never invented.
            </p>
          </div>
        </CardContent>
      </Card>

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample operations data. Supabase is not configured.
        </p>
      )}

      {snapshots.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-vf-ink-faint">
            No company grants SystemAdministration to your account yet — the Operations Centre needs
            that permission in at least one company to show anything.
          </CardContent>
        </Card>
      ) : (
        <OperationsTabs snapshots={snapshots} previewMode={previewMode} />
      )}
    </div>
  );
}

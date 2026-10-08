import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { StatementInbox, type StatementInboxRow } from "@/components/financial/supplier-documents/statement-inbox";
import { IconAlertTriangle, IconClock, IconFileText, IconImport, IconReconcile, IconShieldCheck } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { STATEMENT_STAGES, statementStage, type StatementStage } from "@/lib/supplier-documents/statement-stages";
import type { CapturePermissions } from "@/lib/supplier-documents/capture-stages";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listSupplierStatements } from "@/server/services/supplier-statement-service";
import { listDocumentFilenames } from "@/server/repositories/supplier-statement-repository";
import { loadCapturePermissions, NO_CAPTURE_PERMISSIONS } from "@/server/services/supplier-document-access";

export const metadata: Metadata = {
  title: "Supplier Statements — PRECISIA",
};

export default async function SupplierStatementsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();
  const can: CapturePermissions = previewMode ? NO_CAPTURE_PERMISSIONS : await loadCapturePermissions(companyId);

  const rows: StatementInboxRow[] = [];
  if (!previewMode && can.view) {
    const [statements, suppliers] = await Promise.all([listSupplierStatements(companyId), listSuppliers(companyId)]);
    const filenames = await listDocumentFilenames(companyId, statements.map((s) => s.documentId));
    const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
    for (const s of statements) {
      rows.push({
        id: s.id,
        status: s.status,
        stage: statementStage(s.status),
        sourceType: s.sourceType,
        supplierName: (s.supplierId !== null ? supplierName.get(s.supplierId) : null) ?? s.supplierNameExtracted,
        supplierConfirmed: s.supplierConfirmed,
        statementDate: s.statementDate,
        closingBalance: s.closingBalance,
        currencyCode: s.currencyCode,
        validationStatus: s.validationStatus,
        filename: filenames.get(s.documentId) ?? null,
        receivedAt: s.createdAt,
      });
    }
  }

  const count = (stage: StatementStage) => rows.filter((r) => r.stage === stage).length;
  const icons: Record<StatementStage, typeof IconFileText> = {
    inbox: IconImport,
    "to-enter": IconClock,
    "needs-review": IconAlertTriangle,
    ready: IconShieldCheck,
    reconciled: IconReconcile,
    closed: IconFileText,
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <Card tone="hero" className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }} />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-8 lg:p-10">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Supplier Documents</span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Supplier Statements</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Compare each supplier&apos;s statement with what PRECISIA records. Reconciling never changes the books: differences are
              classified, and a person explains or links them.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar items={STATEMENT_STAGES.map((stage) => ({ key: stage.key, label: stage.label, value: String(count(stage.key)), icon: icons[stage.key] }))} />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — statements are stored per company, so there is nothing to show until Supabase is configured. Every action is disabled.
        </p>
      )}

      {!previewMode && !can.view ? (
        <Card>
          <EmptyState
            icon={<IconShieldCheck className="h-6 w-6" />}
            title="You do not have access to supplier statements"
            description="Viewing supplier statements needs the Purchasing View permission. Ask an administrator if you need it."
          />
        </Card>
      ) : (
        <StatementInbox companyId={companyId} rows={rows} can={can} previewMode={previewMode} />
      )}
    </div>
  );
}

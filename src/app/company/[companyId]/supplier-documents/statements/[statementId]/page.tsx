import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconShieldCheck } from "@/components/ui/icons";
import { StatementReviewWorkspace } from "@/components/financial/supplier-documents/statement-review";
import type {
  ReconItemDetailView,
  ReconRunDetailView,
  ReconRunSummaryView,
  RefLinkView,
  ResolutionView,
  StatementHeaderValues,
  StatementView,
  SupplierCandidateView,
} from "@/components/financial/supplier-documents/statement-types";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { formatDate, formatDateTime } from "@/lib/format";
import { SOURCE_LABEL, STATEMENT_STATUS_LABEL, STATEMENT_STATUS_TONE, type StatementStatus } from "@/lib/supplier-documents/statement-stages";
import { getDocument } from "@/server/repositories/document-repository";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { getSupplierStatement } from "@/server/services/supplier-statement-service";
import { getStatementReconciliation, listStatementReconciliations } from "@/server/services/supplier-statement-reconciliation-service";
import { loadCapturePermissions } from "@/server/services/supplier-document-access";

export const metadata: Metadata = {
  title: "Supplier statement — PRECISIA",
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const refs = (v: unknown): RefLinkView[] =>
  (Array.isArray(v) ? v : []).map((r: Record<string, unknown>) => ({
    refType: String(r.refType ?? ""),
    refId: Number(r.refId),
    amount: num(r.amount),
    date: str(r.date),
    number: str(r.number),
    note: str(r.note) ?? undefined,
    reason: str(r.reason) ?? undefined,
  }));

export default async function SupplierStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string; statementId: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { companyId, statementId } = await params;
  const { run: runParam } = await searchParams;
  const id = Number(statementId);
  if (!isSupabaseConfigured() || !Number.isInteger(id)) notFound();

  const can = await loadCapturePermissions(companyId);
  const backLink = <BackLink href={`/company/${companyId}/supplier-documents/statements`} label="Back to Statements" />;
  if (!can.view) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-6">
        {backLink}
        <Card>
          <EmptyState icon={<IconShieldCheck className="h-6 w-6" />} title="You do not have access to supplier statements" description="Viewing supplier statements needs the Purchasing View permission. Ask an administrator if you need it." />
        </Card>
      </div>
    );
  }

  const [detail, suppliers, reconciliation] = await Promise.all([
    getSupplierStatement(companyId, id),
    listSuppliers(companyId),
    listStatementReconciliations(companyId, id),
  ]);
  if (!detail) notFound();
  const s = detail.statement;
  const document = await getDocument(companyId, s.documentId);

  const latestRunId = reconciliation.runs[0]?.id ?? null;
  const wantedRun = runParam && Number.isInteger(Number(runParam)) ? Number(runParam) : latestRunId;
  const runDetail = wantedRun !== null ? await getStatementReconciliation(companyId, id, wantedRun) : null;

  const header: StatementHeaderValues = {
    statementDate: s.statementDate,
    periodFrom: s.periodFrom,
    periodTo: s.periodTo,
    currencyCode: s.currencyCode,
    openingBalance: s.openingBalance,
    closingBalance: s.closingBalance,
    printedTotalDebits: s.printedTotalDebits,
    printedTotalCredits: s.printedTotalCredits,
    signConvention: s.signConvention,
  };
  const ex = s.extractedHeader;
  const statement: StatementView = {
    id: s.id,
    status: s.status as StatementStatus,
    statusReason: s.statusReason,
    sourceType: s.sourceType,
    documentId: s.documentId,
    extractionMethod: s.extractionMethod,
    supplierId: s.supplierId,
    supplierConfirmed: s.supplierConfirmed,
    supplierConfirmedBy: s.supplierConfirmedBy,
    supplierConfirmedAt: s.supplierConfirmedAt,
    supplierMatchTier: s.supplierMatchTier,
    supplierCandidates: (Array.isArray(s.supplierCandidates) ? s.supplierCandidates : [])
      .map((c: Record<string, unknown>): SupplierCandidateView => ({ supplierId: Number(c.supplierId), supplierName: String(c.supplierName ?? ""), reason: str(c.reason) ?? undefined }))
      .filter((c) => Number.isInteger(c.supplierId)),
    supplierNameExtracted: s.supplierNameExtracted,
    supplierVatExtracted: s.supplierVatExtracted,
    supplierRegistrationExtracted: s.supplierRegistrationExtracted,
    accountNumberExtracted: s.accountNumberExtracted,
    header,
    extractedHeader: ex
      ? {
          statementDate: str(ex.statementDate),
          periodFrom: str(ex.periodFrom),
          periodTo: str(ex.periodTo),
          currencyCode: str(ex.currencyCode),
          openingBalance: num(ex.openingBalance),
          closingBalance: num(ex.closingBalance),
          printedTotalDebits: num(ex.printedTotalDebits),
          printedTotalCredits: num(ex.printedTotalCredits),
        }
      : null,
    currencySupported: s.currencySupported,
    pageCount: s.pageCount,
    validationStatus: s.validationStatus,
    validationFindings: Array.isArray(s.validationFindings) ? (s.validationFindings as StatementView["validationFindings"]) : [],
    warnings: Array.isArray(s.warnings) ? s.warnings : [],
    manualEntry: s.manualEntry,
    duplicateOfStatementId: s.duplicateOfStatementId,
    createdAt: s.createdAt,
  };

  const runs: ReconRunSummaryView[] = reconciliation.runs.map((r) => ({
    id: r.id,
    runNumber: r.runNumber,
    asAt: r.asAt,
    statementClosing: r.statementClosing,
    precisiaBalance: r.precisiaBalance,
    difference: r.difference,
    explained: r.explained,
    explainedByReviewer: r.explainedByReviewer,
    unexplained: r.unexplained,
    fingerprint: r.fingerprint,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  }));
  const selectedRun: ReconRunDetailView | null = runDetail
    ? {
        run: {
          id: runDetail.run.id,
          runNumber: runDetail.run.runNumber,
          asAt: runDetail.run.asAt,
          statementClosing: runDetail.run.statementClosing,
          precisiaBalance: runDetail.run.precisiaBalance,
          difference: runDetail.run.difference,
          explained: runDetail.run.explained,
          explainedByReviewer: runDetail.run.explainedByReviewer,
          unexplained: runDetail.run.unexplained,
          fingerprint: runDetail.run.fingerprint,
          createdBy: runDetail.run.createdBy,
          createdAt: runDetail.run.createdAt,
          windowFrom: runDetail.run.windowFrom,
          windowTo: runDetail.run.windowTo,
          statementOpening: runDetail.run.statementOpening,
          precisiaBalanceBeforeWindow: runDetail.run.precisiaBalanceBeforeWindow,
          residual: num((runDetail.run.summary as Record<string, { amount?: unknown }>)?.__residual?.amount) ?? 0,
        },
        items: runDetail.items.map(
          (i): ReconItemDetailView => ({
            order: i.order,
            statementLineId: i.statementLineId,
            statementLineOrder: i.statementLineOrder,
            category: i.category,
            subStatus: i.subStatus,
            matchTier: i.matchTier,
            refType: i.refType,
            refId: i.refId,
            relatedRefs: refs(i.relatedRefs),
            suggestions: refs(i.suggestions),
            statementAmount: i.statementAmount,
            precisiaAmount: i.precisiaAmount,
            amountDifference: i.amountDifference,
            effect: i.effect ?? 0,
            explained: i.explained,
            explainedByResolutionId: i.explainedByResolutionId,
            message: i.message,
          }),
        ),
      }
    : null;
  const resolutions: ResolutionView[] = reconciliation.resolutions.map((r) => ({ ...r, action: r.action as ResolutionView["action"] }));

  const supplierName = suppliers.find((x) => x.id === s.supplierId)?.name ?? s.supplierNameExtracted;

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {backLink}
      <Card tone="hero" className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }} />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-8 lg:p-10">
          <div className="min-w-0">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Supplier statement</span>
            <h1 className="mt-2 text-3xl font-medium break-words text-vf-on-dark sm:text-4xl">{supplierName ?? document?.filename ?? `Statement ${s.id}`}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-vf-on-dark-faint">
              <Badge tone={STATEMENT_STATUS_TONE[statement.status]}>{STATEMENT_STATUS_LABEL[statement.status]}</Badge>
              <Badge className="bg-white/12">{SOURCE_LABEL[s.sourceType] ?? s.sourceType}</Badge>
              {s.statementDate && <span>As at {formatDate(s.statementDate)}</span>}
              <span>Received {formatDateTime(s.createdAt)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <StatementReviewWorkspace
        companyId={companyId}
        statement={statement}
        lines={detail.lines}
        events={detail.events.map((e) => ({ ...e, detail: (e.detail ?? {}) as Record<string, unknown> }))}
        document={document ? { id: document.id, filename: document.filename, mimeType: document.mimeType, sizeBytes: document.sizeBytes } : null}
        suppliers={suppliers.filter((x) => x.status !== "Inactive" || x.id === s.supplierId)}
        can={can}
        runs={runs}
        selectedRun={selectedRun}
        latestRunId={latestRunId}
        resolutions={resolutions}
        stale={reconciliation.stale}
      />
    </div>
  );
}

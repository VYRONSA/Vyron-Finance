import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TONE_CLASSES: Record<"good" | "info" | "critical" | "muted" | "danger", string> = {
  good: "bg-vf-success/14 text-vf-success",
  info: "bg-vf-info/14 text-vf-info",
  critical: "bg-orange-500/16 text-vf-orange",
  muted: "bg-vf-paper-alt text-vf-ink-faint",
  danger: "bg-vf-danger/14 text-vf-danger",
};

function SummaryStat({ label, value, tone }: { label: string; value: number; tone: keyof typeof TONE_CLASSES }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-vf-md px-3 py-2.5", TONE_CLASSES[tone])}>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</span>
    </div>
  );
}

/** Pilot Review Board follow-up — "do not immediately send the user to
 * Transaction Explorer... display Import Complete." Shared by both the
 * PDF review flow (`PdfImportReviewPanel`) and the generic CSV/Excel/
 * OFX/QIF flow (`ImportUploadCard`) so the two don't diverge. `rulesAllocatedCount`
 * is 0 for the generic import path today — that path doesn't run the
 * Banking Rules engine automatically at confirm time (only the PDF path
 * does) — shown honestly rather than guessed at. */
export function ImportOutcomeSummary({
  companyId,
  batchId,
  importedCount,
  duplicateCount,
  rulesAllocatedCount,
  exceptionCount,
  rulePass,
  onImportAnother,
  onFinish,
}: {
  companyId: string;
  batchId: string;
  importedCount: number;
  duplicateCount: number;
  rulesAllocatedCount: number;
  exceptionCount: number;
  /** Phase 5C — what the Banking Rules pass deliberately did NOT do.
   * Optional so a caller that has no rule pass is unaffected. */
  rulePass?: { notPermitted: number; notAttempted: number; stopReason: "time-budget" | "posting-limit" | null } | null;
  onImportAnother: () => void;
  onFinish: () => void;
}) {
  const needsReview = Math.max(importedCount - rulesAllocatedCount, 0);
  // Phase 5C — an import that left transactions unposted must SAY so. The
  // rows are imported and unchanged, so nothing is lost, but reporting
  // only "Imported / Rules Applied" would let a permission refusal or a
  // bound look like a complete import.
  const notPermitted = rulePass?.notPermitted ?? 0;
  const notAttempted = rulePass?.notAttempted ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Complete</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <SummaryStat label="Imported" value={importedCount} tone="good" />
          <SummaryStat label="Rules Applied" value={rulesAllocatedCount} tone="info" />
          <SummaryStat label="Needs Review" value={needsReview} tone="critical" />
          <SummaryStat label="Duplicates" value={duplicateCount} tone="muted" />
          <SummaryStat label="Exceptions" value={exceptionCount} tone={exceptionCount > 0 ? "danger" : "muted"} />
        </div>

        {notPermitted > 0 && (
          <p role="status" className="text-sm text-vf-warning">
            {notPermitted === 1 ? "1 transaction was" : `${notPermitted} transactions were`} not posted because posting needs the
            &ldquo;Banking:Post&rdquo; permission. {notPermitted === 1 ? "It is" : "They are"} imported and unchanged — someone with that
            permission can still post {notPermitted === 1 ? "it" : "them"}.
          </p>
        )}

        {notAttempted > 0 && (
          <p role="status" className="text-sm text-vf-warning">
            {notAttempted === 1 ? "1 transaction was" : `${notAttempted} transactions were`} not processed by the Banking Rules in this
            import because it reached its {rulePass?.stopReason === "posting-limit" ? "posting limit" : "time limit"}.{" "}
            {notAttempted === 1 ? "It is" : "They are"} imported and unchanged, and will be picked up by the next Banking Rules run.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" href={`/company/${companyId}/transactions?importBatch=${encodeURIComponent(batchId)}`}>
            Review Transactions
          </Button>
          <Button variant="subtle" size="sm" onClick={onImportAnother}>
            Import Another Statement
          </Button>
          <Button variant="subtle" size="sm" onClick={onFinish}>
            Finish
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

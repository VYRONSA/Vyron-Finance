import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconShieldCheck } from "@/components/ui/icons";
import type { VatDashboardSummary } from "@/server/services/vat-summary-service";
import type { VatException, VatReturn } from "@/server/vat/types";

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function VatDashboardTab({ summary, exceptions, vatReturns }: { summary: VatDashboardSummary; exceptions: VatException[]; vatReturns: VatReturn[] }) {
  const openExceptions = exceptions.filter((e) => e.status === "Open");
  const latestReturn = [...vatReturns].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-vf-md border border-vf-paper-border p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-vf-ink">Compliance Score</p>
          <span className="flex items-center gap-1.5 font-mono text-lg tabular-nums text-vf-ink">
            <IconShieldCheck className={`h-4 w-4 ${summary.complianceScorePercent >= 80 ? "text-vf-success" : summary.complianceScorePercent >= 50 ? "text-vf-warning" : "text-vf-danger"}`} />
            {summary.complianceScorePercent}%
          </span>
        </div>
        <p className="mt-1 text-xs text-vf-ink-faint">
          100, minus a real penalty per open exception (weighted by severity) and per Draft return awaiting action — every point traces to a specific, visible cause below.
        </p>
      </div>

      {latestReturn && (
        <div className="rounded-vf-md border border-vf-paper-border p-4">
          <p className="text-sm font-semibold text-vf-ink">Latest VAT Return</p>
          <p className="mt-1 text-xs text-vf-ink-faint">{latestReturn.periodStart} to {latestReturn.periodEnd}</p>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <span>Output: <span className="font-mono tabular-nums">{money(latestReturn.totalOutputVat)}</span></span>
            <span>Input: <span className="font-mono tabular-nums">{money(latestReturn.totalInputVat)}</span></span>
            <span>Net {latestReturn.netPayable >= 0 ? "Payable" : "Receivable"}: <span className="font-mono tabular-nums">{money(Math.abs(latestReturn.netPayable))}</span></span>
            <Badge tone={latestReturn.status === "Submitted" ? "good" : latestReturn.status === "Approved" ? "info" : "warn"}>{latestReturn.status}</Badge>
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-vf-ink">Open Exceptions ({openExceptions.length})</h3>
        {openExceptions.length === 0 ? (
          <EmptyState title="No open VAT exceptions." description="Everything scanned so far is clean." />
        ) : (
          <ul className="flex flex-col gap-2 text-sm text-vf-ink-soft">
            {openExceptions.slice(0, 5).map((e) => (
              <li key={e.id} className="border-t border-vf-paper-border pt-2 first:border-0 first:pt-0">
                <Badge tone="danger">{e.exceptionType}</Badge> <span className="ml-1">{e.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

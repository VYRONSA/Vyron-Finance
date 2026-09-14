import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import type { AuditWorkingPaperType } from "@/server/audit/types";
import { formatAmount, formatDateTime } from "@/lib/format";

function money(value: unknown): string {
  return typeof value === "number" ? formatAmount(value) : String(value ?? "");
}

function Fallback({ content }: { content: Record<string, unknown> }) {
  return <pre className="max-h-96 overflow-auto rounded-vf-sm bg-vf-ink/5 p-3 text-xs text-vf-ink-soft">{JSON.stringify(content, null, 2)}</pre>;
}

type LeadScheduleContent = {
  asOfDate: string;
  sections: { accountType: string; lines: { accountCode: string; description: string; debitBalance: number; creditBalance: number }[]; subtotalDebit: number; subtotalCredit: number }[];
};

function LeadScheduleView({ content }: { content: LeadScheduleContent }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-vf-ink-faint">As of {content.asOfDate}</p>
      {content.sections.map((s) => (
        <div key={s.accountType} className="rounded-vf-sm border border-vf-paper-border">
          <p className="border-b border-vf-paper-border bg-vf-paper-alt/50 px-3 py-1.5 text-xs font-semibold text-vf-ink">{s.accountType}</p>
          <Table>
            <TableHead>
              <tr>
                <TableHeadCell>Account</TableHeadCell>
                <TableHeadCell className="text-right">Debit</TableHeadCell>
                <TableHeadCell className="text-right">Credit</TableHeadCell>
              </tr>
            </TableHead>
            <TableBody>
              {s.lines.map((l) => (
                <TableRow key={l.accountCode}>
                  <TableCell><span className="font-mono text-xs text-vf-ink-faint">{l.accountCode}</span> {l.description}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{l.debitBalance > 0 ? money(l.debitBalance) : ""}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{l.creditBalance > 0 ? money(l.creditBalance) : ""}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t border-vf-paper-border">
                <TableCell className="text-xs font-semibold text-vf-ink-faint">Subtotal</TableCell>
                <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">{money(s.subtotalDebit)}</TableCell>
                <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">{money(s.subtotalCredit)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  );
}

type SupportingScheduleContent = {
  accountCode: string;
  description: string;
  transactions: { id: number; postingDate: string; reference: string; description: string; debit: number; credit: number; journalNumber: string }[];
  totalDebit: number;
  totalCredit: number;
  transactionCount: number;
};

function SupportingScheduleView({ content }: { content: SupportingScheduleContent }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-vf-ink-faint">{content.transactionCount} transaction(s) behind {content.accountCode} — {content.description}</p>
      <Table>
        <TableHead>
          <tr>
            <TableHeadCell>Date</TableHeadCell>
            <TableHeadCell>Journal</TableHeadCell>
            <TableHeadCell>Reference</TableHeadCell>
            <TableHeadCell>Description</TableHeadCell>
            <TableHeadCell className="text-right">Debit</TableHeadCell>
            <TableHeadCell className="text-right">Credit</TableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {content.transactions.map((t) => (
            <TableRow key={t.id}>
              <TableCell>{t.postingDate}</TableCell>
              <TableCell className="font-mono text-xs">{t.journalNumber}</TableCell>
              <TableCell>{t.reference || "—"}</TableCell>
              <TableCell className="text-vf-ink-soft">{t.description}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{t.debit > 0 ? money(t.debit) : ""}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{t.credit > 0 ? money(t.credit) : ""}</TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t border-vf-paper-border">
            <TableCell colSpan={4} className="text-xs font-semibold text-vf-ink-faint">Total</TableCell>
            <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">{money(content.totalDebit)}</TableCell>
            <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">{money(content.totalCredit)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

type ReconciliationContent = {
  asOfDate: string;
  byStatus: Record<string, { count: number; amount: number }>;
  totalTransactions: number;
};

function ReconciliationView({ content }: { content: ReconciliationContent }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-vf-ink-faint">As of {content.asOfDate} — {content.totalTransactions} transaction(s)</p>
      <Table>
        <TableHead>
          <tr>
            <TableHeadCell>Status</TableHeadCell>
            <TableHeadCell className="text-right">Count</TableHeadCell>
            <TableHeadCell className="text-right">Amount</TableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {Object.entries(content.byStatus).map(([status, s]) => (
            <TableRow key={status}>
              <TableCell><Badge tone={status === "Matched" || status === "Allocated" ? "good" : status === "Suggested" ? "warn" : "muted"}>{status}</Badge></TableCell>
              <TableCell className="text-right font-mono tabular-nums">{s.count}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(s.amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type AccountAnalysisContent = {
  accountCode: string;
  description: string;
  dateFrom: string;
  dateTo: string;
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  monthlyTrend: { month: string; debit: number; credit: number; netMovement: number }[];
};

function AccountAnalysisView({ content }: { content: AccountAnalysisContent }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-vf-ink-faint">{content.accountCode} — {content.description} · {content.dateFrom} to {content.dateTo}</p>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-vf-ink-faint">Opening Balance</dt><dd className="font-mono tabular-nums">{money(content.openingBalance)}</dd></div>
        <div><dt className="text-xs text-vf-ink-faint">Closing Balance</dt><dd className="font-mono tabular-nums">{money(content.closingBalance)}</dd></div>
        <div><dt className="text-xs text-vf-ink-faint">Total Debit</dt><dd className="font-mono tabular-nums">{money(content.totalDebit)}</dd></div>
        <div><dt className="text-xs text-vf-ink-faint">Total Credit</dt><dd className="font-mono tabular-nums">{money(content.totalCredit)}</dd></div>
      </dl>
      {content.monthlyTrend.length > 0 && (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Month</TableHeadCell>
              <TableHeadCell className="text-right">Debit</TableHeadCell>
              <TableHeadCell className="text-right">Credit</TableHeadCell>
              <TableHeadCell className="text-right">Net Movement</TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {content.monthlyTrend.map((m) => (
              <TableRow key={m.month}>
                <TableCell>{m.month}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(m.debit)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(m.credit)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(m.netMovement)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

type VarianceReportContent = {
  label: string;
  rows: { accountCode: string; description: string; expected: number; actual: number; variance: number; variancePercent: number | null }[];
};

function VarianceReportView({ content }: { content: VarianceReportContent }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-vf-ink-faint">{content.label}</p>
      <Table>
        <TableHead>
          <tr>
            <TableHeadCell>Account</TableHeadCell>
            <TableHeadCell className="text-right">Expected</TableHeadCell>
            <TableHeadCell className="text-right">Actual</TableHeadCell>
            <TableHeadCell className="text-right">Variance</TableHeadCell>
            <TableHeadCell className="text-right">Variance %</TableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {content.rows.map((r) => (
            <TableRow key={r.accountCode}>
              <TableCell><span className="font-mono text-xs text-vf-ink-faint">{r.accountCode}</span> {r.description}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(r.expected)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(r.actual)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(r.variance)}</TableCell>
              <TableCell className="text-right">{r.variancePercent === null ? "—" : `${r.variancePercent}%`}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type RiskSummaryContent = {
  risks: { riskDescription: string; area: string; likelihood: string; impact: string; response: string }[];
  openFindingsBySeverity: Record<string, number>;
  totalOpenFindings: number;
};

function RiskSummaryView({ content }: { content: RiskSummaryContent }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {Object.entries(content.openFindingsBySeverity).map(([severity, count]) => (
          <Badge key={severity} tone={severity === "Critical" ? "danger" : severity === "High" ? "warn" : "info"}>{severity}: {count}</Badge>
        ))}
        <span className="text-xs text-vf-ink-faint">{content.totalOpenFindings} open finding(s) total</span>
      </div>
      <Table>
        <TableHead>
          <tr>
            <TableHeadCell>Risk</TableHeadCell>
            <TableHeadCell>Area</TableHeadCell>
            <TableHeadCell>Likelihood</TableHeadCell>
            <TableHeadCell>Impact</TableHeadCell>
            <TableHeadCell>Response</TableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {content.risks.map((r, i) => (
            <TableRow key={i}>
              <TableCell className="text-vf-ink-soft">{r.riskDescription}</TableCell>
              <TableCell>{r.area}</TableCell>
              <TableCell>{r.likelihood}</TableCell>
              <TableCell>{r.impact}</TableCell>
              <TableCell>{r.response}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type ExceptionReportContent = {
  totalOpen: number;
  byType: Record<string, number>;
  findings: { findingType: string; category: string; severity: string; reason: string; evidence: string; relatedType: string | null; relatedId: number | null }[];
};

function ExceptionReportView({ content }: { content: ExceptionReportContent }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {Object.entries(content.byType).map(([type, count]) => (
          <Badge key={type} tone="info">{type}: {count}</Badge>
        ))}
        <span className="text-xs text-vf-ink-faint">{content.totalOpen} open exception(s) total</span>
      </div>
      <Table>
        <TableHead>
          <tr>
            <TableHeadCell>Type</TableHeadCell>
            <TableHeadCell>Severity</TableHeadCell>
            <TableHeadCell>Reason</TableHeadCell>
            <TableHeadCell>Evidence</TableHeadCell>
            <TableHeadCell>Related</TableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {content.findings.map((f, i) => (
            <TableRow key={i}>
              <TableCell>{f.findingType}</TableCell>
              <TableCell><Badge tone={f.severity === "Critical" ? "danger" : f.severity === "High" ? "warn" : "info"}>{f.severity}</Badge></TableCell>
              <TableCell className="text-vf-ink-soft">{f.reason}</TableCell>
              <TableCell className="text-vf-ink-faint">{f.evidence}</TableCell>
              <TableCell className="text-xs text-vf-ink-faint">{f.relatedType ? `${f.relatedType} #${f.relatedId}` : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type SamplingListContent = {
  populationSize: number;
  sampleSize: number;
  interval?: number;
  method: string;
  sample: { id: number; label: string; amount: number }[];
};

function SamplingListView({ content }: { content: SamplingListContent }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-vf-ink-faint">
        {content.method} sampling — {content.sampleSize} of {content.populationSize} item(s){content.interval ? ` (every ${content.interval})` : ""}
      </p>
      {content.sample.length === 0 ? (
        <EmptyState className="px-0 py-4" title="No items sampled" description="The population was empty, so there was nothing to draw a sample from." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Item</TableHeadCell>
              <TableHeadCell className="text-right">Amount</TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {content.sample.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.label}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(s.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

type AuditNoteContent = { note: string; author: string; createdAt: string };

function AuditNoteView({ content }: { content: AuditNoteContent }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="whitespace-pre-wrap text-sm text-vf-ink-soft">{content.note}</p>
      <p className="text-xs text-vf-ink-faint">{content.author} · {formatDateTime(content.createdAt)}</p>
    </div>
  );
}

/** Finding #047 — every working paper rendered as a raw
 * `JSON.stringify(paper.content, null, 2)` dump. Each `paperType`'s shape
 * is already well-defined by its own pure builder in
 * `working-paper-engine.ts` — this is a UI-only task, one formatted
 * renderer per shape. Falls back to the original JSON view only for a
 * `paperType` this component doesn't recognize (e.g. a future addition
 * to `AUDIT_WORKING_PAPER_TYPES` not yet given its own renderer) — every
 * recognized type trusts its own builder's shape, the same "trust
 * internal generation, only guard system boundaries" convention the rest
 * of this codebase already follows. */
export function WorkingPaperContent({ paperType, content }: { paperType: AuditWorkingPaperType; content: Record<string, unknown> }) {
  switch (paperType) {
    case "LeadSchedule":
      return <LeadScheduleView content={content as unknown as LeadScheduleContent} />;
    case "SupportingSchedule":
      return <SupportingScheduleView content={content as unknown as SupportingScheduleContent} />;
    case "Reconciliation":
      return <ReconciliationView content={content as unknown as ReconciliationContent} />;
    case "AccountAnalysis":
      return <AccountAnalysisView content={content as unknown as AccountAnalysisContent} />;
    case "VarianceReport":
      return <VarianceReportView content={content as unknown as VarianceReportContent} />;
    case "RiskSummary":
      return <RiskSummaryView content={content as unknown as RiskSummaryContent} />;
    case "ExceptionReport":
      return <ExceptionReportView content={content as unknown as ExceptionReportContent} />;
    case "SamplingList":
      return <SamplingListView content={content as unknown as SamplingListContent} />;
    case "AuditNote":
      return <AuditNoteView content={content as unknown as AuditNoteContent} />;
    default:
      return <Fallback content={content} />;
  }
}

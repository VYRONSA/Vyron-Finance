"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { TrendChart } from "@/components/ui/charts/trend-chart";
import { IconAlertTriangle, IconFileText, IconShieldCheck, IconSparkles } from "@/components/ui/icons";
import { AuditTrail } from "./journals-tab";
import type { Journal, JournalStatus } from "@/server/accounting/types";
import type { AccountActivity, ChartOfAccount, GlTransactionWithContext } from "@/server/general-ledger/types";
import type { AccountYearComparison } from "@/server/services/account-activity-service";
import type {
  LargestMovement,
  MissingPostingAlert,
  PossibleDuplicateJournal,
  UnusualGrowthAlert,
} from "@/server/services/financial-intelligence-service";
import type { AuditFinding, AuditWorkingPaper } from "@/server/audit/types";

const FINDING_SEVERITY_TONE: Record<AuditFinding["severity"], "muted" | "info" | "warn" | "danger"> = { Low: "muted", Medium: "info", High: "warn", Critical: "danger" };

const STATUS_TONE: Record<JournalStatus, "muted" | "info" | "good" | "danger"> = {
  Draft: "muted",
  Submitted: "info",
  Approved: "info",
  Rejected: "danger",
  Posted: "good",
  Cancelled: "muted",
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function SourceTransactions({ companyId, journalId }: { companyId: string; journalId: number }) {
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [transactions, setTransactions] = useState<{ id: number; description: string; reference: string; transactionDate: string | null }[]>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/by-journal/${journalId}`);
      const data = await res.json();
      setTransactions(data.transactions ?? []);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  if (!loaded) {
    return (
      <Button variant="subtle" size="sm" disabled={loading} onClick={load}>
        {loading ? "Tracing…" : "Trace to Source Bank Transaction"}
      </Button>
    );
  }

  if (transactions.length === 0) {
    return <p className="text-xs text-vf-ink-faint">No source bank transaction is linked to this journal.</p>;
  }

  return (
    <ul className="flex flex-col gap-1 text-xs">
      {transactions.map((t) => (
        <li key={t.id}>
          <Link href={`/company/${companyId}/transactions?transaction=${t.id}`} className="text-vf-red-600 hover:underline">
            {t.transactionDate ?? "—"} — {t.description || t.reference}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AccountActivityView({
  companyId,
  accountId,
  account,
  activity,
  yearComparison,
  transactions,
  relatedJournals,
  intelligence,
  auditEvidence,
  previewMode,
}: {
  companyId: string;
  accountId: number;
  account: ChartOfAccount;
  activity: AccountActivity;
  yearComparison: AccountYearComparison | null;
  transactions: GlTransactionWithContext[];
  relatedJournals: Journal[];
  intelligence: {
    largestMovements: LargestMovement[];
    possibleDuplicateJournals: PossibleDuplicateJournal[];
    unusualGrowth: UnusualGrowthAlert[];
    missingPostings: MissingPostingAlert[];
  };
  auditEvidence: { findings: AuditFinding[]; workingPapers: AuditWorkingPaper[] };
  previewMode: boolean;
}) {
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState(activity.dateFrom);
  const [dateTo, setDateTo] = useState(activity.dateTo);
  const [expandedJournalId, setExpandedJournalId] = useState<number | null>(null);

  function applyDateRange() {
    router.push(`/company/${companyId}/general-ledger/${accountId}?dateFrom=${dateFrom}&dateTo=${dateTo}`);
  }

  const trendPoints = activity.monthlyTrend.map((m) => ({ date: `${m.month}-01`, value: m.netMovement }));
  const hasIntelligence =
    intelligence.largestMovements.length > 0 ||
    intelligence.possibleDuplicateJournals.length > 0 ||
    intelligence.unusualGrowth.length > 0 ||
    intelligence.missingPostings.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-44">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="aa-date-from">From</label>
          <Input id="aa-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="w-44">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="aa-date-to">To</label>
          <Input id="aa-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <Button variant="subtle" size="sm" onClick={applyDateRange}>
          Apply Period
        </Button>
        <Button href={`/company/${companyId}/general-ledger?tab=trial-balance`} variant="subtle" size="sm" className="ml-auto">
          Back to Trial Balance
        </Button>
      </div>

      {/* Account Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card tone="dark">
          <CardContent className="p-5">
            <p className="font-mono text-2xl font-semibold tabular-nums text-vf-on-dark">{money(activity.openingBalance)}</p>
            <p className="mt-1 text-xs text-vf-on-dark-faint">Opening Balance</p>
          </CardContent>
        </Card>
        <Card tone="dark">
          <CardContent className="p-5">
            <p className="font-mono text-2xl font-semibold tabular-nums text-vf-on-dark">{money(activity.closingBalance)}</p>
            <p className="mt-1 text-xs text-vf-on-dark-faint">Closing Balance</p>
          </CardContent>
        </Card>
        <Card tone="dark">
          <CardContent className="p-5">
            <p className="font-mono text-2xl font-semibold tabular-nums text-vf-on-dark">{money(activity.totalDebit)}</p>
            <p className="mt-1 text-xs text-vf-on-dark-faint">Total Debit (Period)</p>
          </CardContent>
        </Card>
        <Card tone="dark">
          <CardContent className="p-5">
            <p className="font-mono text-2xl font-semibold tabular-nums text-vf-on-dark">{money(activity.totalCredit)}</p>
            <p className="mt-1 text-xs text-vf-on-dark-faint">Total Credit (Period)</p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Trend */}
      <Card tone="dark">
        <CardHeader>
          <CardTitle className="text-vf-on-dark">Monthly Activity</CardTitle>
          <CardDescription className="text-vf-on-dark-faint">Net movement (debit − credit) by month for {account.accountCode} — {account.description}.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {trendPoints.length < 2 ? (
            <p className="text-sm text-vf-on-dark-faint">Not enough months of activity in this period to chart a trend.</p>
          ) : (
            <TrendChart data={trendPoints} suffix="" />
          )}
          {yearComparison && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-vf-dark-border pt-4 text-sm">
              <span className="text-vf-on-dark-faint">Vs. same period last year:</span>
              <span className="font-mono tabular-nums text-vf-on-dark">{money(yearComparison.previousTotal)}</span>
              <span className="text-vf-on-dark-faint">→</span>
              <span className="font-mono tabular-nums text-vf-on-dark">{money(yearComparison.currentTotal)}</span>
              <Badge tone={yearComparison.variance >= 0 ? "good" : "danger"}>
                {yearComparison.variance >= 0 ? "+" : ""}
                {money(yearComparison.variance)}
                {yearComparison.variancePercent !== null && ` (${yearComparison.variancePercent >= 0 ? "+" : ""}${yearComparison.variancePercent}%)`}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Financial Intelligence */}
      <Card tone="dark">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-vf-on-dark">
            <IconSparkles className="h-4 w-4" /> Financial Intelligence
          </CardTitle>
          <CardDescription className="text-vf-on-dark-faint">
            Computed signals for this account, not AI-generated — every insight explains exactly what was found and why it matters.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {!hasIntelligence ? (
            <p className="text-sm text-vf-on-dark-faint">No signals for this account in the selected period.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {intelligence.largestMovements.map((m, i) => (
                <div key={`lm-${i}`} className="rounded-vf-sm border border-white/10 bg-white/5 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-vf-on-dark">Largest Movement — {money(m.amount)} on {m.postingDate}</span>
                    <Badge tone="info">Largest Movement</Badge>
                  </div>
                  <p className="mt-1 text-xs text-vf-on-dark-faint">{m.reasoning}</p>
                </div>
              ))}
              {intelligence.possibleDuplicateJournals.map((d, i) => (
                <div key={`dup-${i}`} className="rounded-vf-sm border border-vf-warning/30 bg-vf-warning/10 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-vf-on-dark">Possible Duplicate — {money(d.amount)} on {d.postingDate}</span>
                    <Badge tone="warn">Duplicate</Badge>
                  </div>
                  <p className="mt-1 text-xs text-vf-on-dark-faint">{d.reasoning}</p>
                </div>
              ))}
              {intelligence.unusualGrowth.map((g, i) => (
                <div key={`growth-${i}`} className="rounded-vf-sm border border-white/10 bg-white/5 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-vf-on-dark">Unusual Change</span>
                    <Badge tone="warn">Anomaly</Badge>
                  </div>
                  <p className="mt-1 text-xs text-vf-on-dark-faint">{g.reasoning}</p>
                </div>
              ))}
              {intelligence.missingPostings.map((m, i) => (
                <div key={`mp-${i}`} className="rounded-vf-sm border border-vf-danger/30 bg-vf-danger/10 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-vf-on-dark">{m.journalNumber} — Missing Posting</span>
                    <Badge tone="danger">{m.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-vf-on-dark-faint">{m.reasoning}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transactions */}
      <Card tone="dark">
        <CardHeader>
          <CardTitle className="text-vf-on-dark">Transactions</CardTitle>
          <CardDescription className="text-vf-on-dark-faint">Every posting to this account in the selected period.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {transactions.length === 0 ? (
            <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No postings in this period." description="Widen the date range above to see more history." />
          ) : (
            <Table tone="dark">
              <TableHead tone="dark">
                <tr>
                  <TableHeadCell>Date</TableHeadCell>
                  <TableHeadCell>Description</TableHeadCell>
                  <TableHeadCell>Reference</TableHeadCell>
                  <TableHeadCell>Journal</TableHeadCell>
                  <TableHeadCell className="text-right">Debit</TableHeadCell>
                  <TableHeadCell className="text-right">Credit</TableHeadCell>
                </tr>
              </TableHead>
              <TableBody tone="dark">
                {transactions.map((t) => (
                  <TableRow key={t.id} tone="dark">
                    <TableCell tone="dark">{t.postingDate}</TableCell>
                    <TableCell tone="dark" className="max-w-xs truncate text-vf-on-dark">{t.description}</TableCell>
                    <TableCell tone="dark" className="text-xs text-vf-on-dark-faint">{t.reference}</TableCell>
                    <TableCell tone="dark">
                      <Link href={`/company/${companyId}/general-ledger?tab=journals&journal=${t.journalNumber}`} className="font-mono text-xs text-vf-red-300 hover:underline">
                        {t.journalNumber}
                      </Link>
                    </TableCell>
                    <TableCell tone="dark" className="text-right font-mono tabular-nums">{t.debit > 0 ? money(t.debit) : ""}</TableCell>
                    <TableCell tone="dark" className="text-right font-mono tabular-nums">{t.credit > 0 ? money(t.credit) : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Related Journals + Audit Trail */}
      <Card tone="dark">
        <CardHeader>
          <CardTitle className="text-vf-on-dark">Related Journals</CardTitle>
          <CardDescription className="text-vf-on-dark-faint">
            Every journal that posted to this account in the period, with its full history — the audit trail behind each figure above.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0">
          {relatedJournals.length === 0 ? (
            <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No related journals." description="No journal posted to this account in the selected period." />
          ) : (
            relatedJournals.map((j) => {
              const isExpanded = expandedJournalId === j.id;
              return (
                <div key={j.id} className="rounded-vf-sm border border-white/10 bg-white/5 p-3">
                  <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setExpandedJournalId(isExpanded ? null : j.id)}>
                    <span>
                      <span className="font-mono text-xs text-vf-on-dark">{j.journalNumber}</span>
                      <span className="ml-2 text-sm text-vf-on-dark-soft">{j.description}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs tabular-nums text-vf-on-dark-faint">{j.journalDate}</span>
                      <Badge tone={STATUS_TONE[j.status]}>{j.status}</Badge>
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="mt-3 grid grid-cols-1 gap-4 border-t border-white/10 pt-3 lg:grid-cols-2">
                      <div>
                        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-vf-on-dark-faint">History</p>
                        <AuditTrail journal={j} />
                      </div>
                      <div>
                        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-vf-on-dark-faint">Source</p>
                        {j.sourceType === "bank_transactions_bulk" ? (
                          <SourceTransactions companyId={companyId} journalId={j.id} />
                        ) : (
                          <p className="text-xs text-vf-on-dark-faint">Source: {j.sourceType === "manual" ? "Manually entered" : j.sourceType}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Audit Evidence — the last two links of the Module 13 drill-through
          chain (Working Paper -> Audit Finding), over real
          `audit_findings`/`audit_working_papers` already generated by the
          Auditor Workspace; no new detector. */}
      <Card tone="dark">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-vf-on-dark">
            <IconShieldCheck className="h-4 w-4" /> Audit Evidence
          </CardTitle>
          <CardDescription className="text-vf-on-dark-faint">
            Audit Findings and Working Papers from the Auditor Workspace that reference this account — the closing link of the Financial
            Statement → Disclosure Note → General Ledger → Journal → Business Event → Source Document → Working Paper → Audit Finding chain.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {auditEvidence.findings.length === 0 && auditEvidence.workingPapers.length === 0 ? (
            <p className="text-sm text-vf-on-dark-faint">No Audit Findings or Working Papers reference this account.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {auditEvidence.findings.map((f) => (
                <div key={`finding-${f.id}`} className="rounded-vf-sm border border-white/10 bg-white/5 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-vf-on-dark">{f.findingType}</span>
                    <Badge tone={FINDING_SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-vf-on-dark-faint">{f.reason}</p>
                  <Button href={`/company/${companyId}/auditor?tab=findings`} variant="ghostDark" size="sm" className="mt-2">
                    View in Auditor Workspace
                  </Button>
                </div>
              ))}
              {auditEvidence.workingPapers.map((p) => (
                <div key={`paper-${p.id}`} className="rounded-vf-sm border border-white/10 bg-white/5 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-vf-on-dark">{p.title}</span>
                    <Badge tone="info">{p.paperType}</Badge>
                  </div>
                  <Button href={`/company/${companyId}/auditor?tab=working-papers`} variant="ghostDark" size="sm" className="mt-2">
                    View in Auditor Workspace
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconAlertTriangle className="h-3.5 w-3.5" />
          Preview Mode — this account activity is derived from sample data.
        </p>
      )}
    </div>
  );
}

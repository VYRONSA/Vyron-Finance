"use client";

import { useEffect, useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBarChart } from "@/components/ui/icons";

type RuleAnalyticsRow = {
  ruleId: number;
  ruleName: string;
  domain: string;
  ruleType: string;
  isActive: boolean;
  version: number;
  appliedCount: number;
  successCount: number;
  failureCount: number;
  successRatePercent: number;
  failureRatePercent: number;
  lastAppliedAt: string | null;
};

type HistoryEntry = { ruleId: number; bankTransactionId: number; appliedAt: string; succeeded: boolean };

function RateBadge({ percent, good }: { percent: number; good: boolean }) {
  return <Badge tone={percent === 0 ? "muted" : good ? "good" : "warn"}>{percent.toFixed(1)}%</Badge>;
}

function HistoryPanel({ companyId, ruleId, onClose }: { companyId: string; ruleId: number; onClose: () => void }) {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    fetch(`/api/companies/${companyId}/banking-rules/${ruleId}/history`)
      .then((res) => res.json())
      .then((data) => setHistory(data.history))
      .catch(() => setHistory([]));
  }, [companyId, ruleId]);

  return (
    <div className="mt-2 rounded-vf-md border border-vf-paper-border bg-vf-paper-alt/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Rule History — every application, most recent first</p>
        <Button variant="subtle" size="sm" onClick={onClose}>Close</Button>
      </div>
      {history === null ? (
        <p className="text-xs text-vf-ink-faint">Loading…</p>
      ) : history.length === 0 ? (
        <p className="text-xs text-vf-ink-faint">This rule has never fired.</p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto text-xs text-vf-ink-soft">
          {history.map((h, i) => (
            <li key={`${h.bankTransactionId}-${i}`} className="flex items-center gap-2">
              <Badge tone={h.succeeded ? "good" : "warn"}>{h.succeeded ? "Succeeded" : "Failed"}</Badge>
              <span>Transaction #{h.bankTransactionId}</span>
              <span className="text-vf-ink-faint">{new Date(h.appliedAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BankingRulesAnalyticsTab({ companyId, previewMode }: { companyId: string; previewMode: boolean }) {
  const [rows, setRows] = useState<RuleAnalyticsRow[] | null>(null);
  const [historyRuleId, setHistoryRuleId] = useState<number | null>(null);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    if (previewMode) return;
    fetch(`/api/companies/${companyId}/banking-rules/analytics`)
      .then((res) => res.json())
      .then((data) => setRows(data.rules))
      .catch(() => setRows([]));
  }, [companyId, previewMode]);

  const comparedRows = useMemo(() => (rows ?? []).filter((r) => compareIds.includes(r.ruleId)), [rows, compareIds]);

  if (previewMode) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-vf-ink-faint">
        Analytics reflect real rule-application outcomes once Supabase is configured.
      </p>
    );
  }

  if (rows === null) return <p className="text-sm text-vf-ink-faint">Loading…</p>;

  if (rows.length === 0) {
    return <EmptyState icon={<IconBarChart className="h-5 w-5" />} title="No rules yet." description="Analytics will populate once rules exist and have run." />;
  }

  function toggleCompare(ruleId: number) {
    setCompareIds((ids) => (ids.includes(ruleId) ? ids.filter((id) => id !== ruleId) : [...ids, ruleId]));
  }

  const displayRows = comparing ? comparedRows : rows;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-vf-ink-faint">
          Success % / Failure % are computed from each rule&rsquo;s own real applications resolving into a posted journal — the same
          success definition the Matching Dashboard already uses, applied per rule.
        </p>
        {compareIds.length >= 2 && (
          <Button variant="subtle" size="sm" onClick={() => setComparing((c) => !c)}>
            {comparing ? `Show All Rules` : `Compare ${compareIds.length} Selected`}
          </Button>
        )}
      </div>

      <Table>
        <TableHead>
          <tr>
            <TableHeadCell className="w-10">Compare</TableHeadCell>
            <TableHeadCell>Rule</TableHeadCell>
            <TableHeadCell>Type</TableHeadCell>
            <TableHeadCell>Status</TableHeadCell>
            <TableHeadCell className="text-right">Times Applied</TableHeadCell>
            <TableHeadCell className="text-right">Success %</TableHeadCell>
            <TableHeadCell className="text-right">Failure %</TableHeadCell>
            <TableHeadCell>Last Applied</TableHeadCell>
            <TableHeadCell>History</TableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {displayRows.map((r) => (
            <TableRow key={r.ruleId}>
              <TableCell>
                <input
                  type="checkbox"
                  aria-label={`Select ${r.ruleName} for comparison`}
                  checked={compareIds.includes(r.ruleId)}
                  onChange={() => toggleCompare(r.ruleId)}
                />
              </TableCell>
              <TableCell className="font-medium text-vf-ink">
                {r.ruleName} <span className="text-vf-ink-faint">v{r.version}</span>
              </TableCell>
              <TableCell>
                <Badge tone="info">{r.ruleType}</Badge>
              </TableCell>
              <TableCell>
                <Badge tone={r.isActive ? "good" : "muted"}>{r.isActive ? "Enabled" : "Disabled"}</Badge>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{r.appliedCount}</TableCell>
              <TableCell className="text-right">
                <RateBadge percent={r.successRatePercent} good={true} />
              </TableCell>
              <TableCell className="text-right">
                <RateBadge percent={r.failureRatePercent} good={false} />
              </TableCell>
              <TableCell className="text-xs text-vf-ink-faint">{r.lastAppliedAt ? new Date(r.lastAppliedAt).toLocaleString() : "Never"}</TableCell>
              <TableCell>
                <Button variant="subtle" size="sm" onClick={() => setHistoryRuleId(historyRuleId === r.ruleId ? null : r.ruleId)}>
                  {historyRuleId === r.ruleId ? "Hide" : "View"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {historyRuleId !== null && <HistoryPanel companyId={companyId} ruleId={historyRuleId} onClose={() => setHistoryRuleId(null)} />}
    </div>
  );
}

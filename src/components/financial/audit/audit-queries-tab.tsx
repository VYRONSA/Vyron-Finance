"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import { ConfirmActionRow, useConfirmTarget } from "@/components/ui/confirm-action";
import { IconArrowDown } from "@/components/ui/icons";
import { SortableHeadCell, useSearchAndSort } from "@/components/financial/matching/sortable-document-table";
import { downloadCsv } from "@/lib/csv-export";
import type { AuditQuery, AuditQueryCondition, AuditQuerySource } from "@/server/audit/types";

const SOURCES: AuditQuerySource[] = ["journals", "glTransactions", "bankTransactions"];
const OPERATORS: AuditQueryCondition["operator"][] = ["gt", "gte", "lt", "lte", "eq", "neq", "isWeekend"];
const PAGE_SIZE = 50;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Finding #048 — results used to be a raw `JSON.stringify(results.slice(0, 5))`
 * dump; the backend (`runAuditQuery`/`evaluateQuery`) already returns the
 * full unfiltered result set, so the 5-row cap was UI-only. Now a real
 * table with search/sort/pagination (same `useSearchAndSort` hook the
 * rest of this app already uses) and CSV export — columns are derived
 * from whatever fields the query's own source actually returned, since
 * different `AuditQuerySource`s shape their rows differently. */
function QueryResultsTable({ results }: { results: Record<string, unknown>[] }) {
  const columns = useMemo(() => (results.length > 0 ? Object.keys(results[0]) : []), [results]);
  const { search, setSearch, sort, toggleSort, result } = useSearchAndSort(results, (r) => columns.map((c) => cellText(r[c])).join(" "), columns[0] ?? "");
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(result.length / PAGE_SIZE));
  const pageRows = result.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (results.length === 0) return <p className="mt-3 text-sm text-vf-ink-faint">0 results.</p>;

  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Input aria-label="Search results" placeholder="Search results…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="w-56" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-vf-ink-faint">{result.length} result(s)</span>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => downloadCsv("audit-query-results.csv", columns, result.map((r) => columns.map((c) => cellText(r[c]))))}
          >
            <IconArrowDown className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <tr>
              {columns.map((c) => (
                <SortableHeadCell key={c} field={c} sort={sort} onSort={toggleSort}>{c}</SortableHeadCell>
              ))}
            </tr>
          </TableHead>
          <TableBody>
            {pageRows.map((row, i) => (
              <TableRow key={i}>
                {columns.map((c) => (
                  <TableCell key={c} className="font-mono text-xs">{cellText(row[c])}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pageCount > 1 && (
        <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-vf-ink-faint">
          <Button variant="subtle" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
          Page {page} of {pageCount}
          <Button variant="subtle" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

function QueryCard({ companyId, query, periodStart, periodEnd, previewMode }: { companyId: string; query: AuditQuery; periodStart: string; periodEnd: string; previewMode: boolean }) {
  const router = useRouter();
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [loading, setLoading] = useState(false);
  // Finding #233 (RC-3) — mirrors the established `ConfirmActionRow`/
  // `useConfirmTarget` pattern used everywhere else for a destructive
  // one-click action.
  const deleteConfirm = useConfirmTarget<true>();
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function run() {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/audit/queries/${query.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart, periodEnd }),
      });
      const data = await res.json();
      if (res.ok) setResults(data.results);
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    setLoading(true);
    try {
      await fetch(`/api/companies/${companyId}/audit/queries/${query.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setLoading(false);
      deleteConfirm.cancel();
    }
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-vf-ink">{query.name}</p>
            <Badge tone="info">{query.queryDefinition.source}</Badge>
          </div>
          {query.description && <p className="mt-1 text-xs text-vf-ink-faint">{query.description}</p>}
        </div>
        {deleteConfirm.isConfirming(true) ? (
          <ConfirmActionRow message={`Delete "${query.name}"?`} loading={loading} tone="danger" onConfirm={remove} onCancel={deleteConfirm.cancel} />
        ) : (
          <div className="flex gap-2">
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={run}>
              Run
            </Button>
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => deleteConfirm.request(true)}>
              Delete
            </Button>
          </div>
        )}
      </div>
      {results !== null && <QueryResultsTable results={results} />}
    </div>
  );
}

export function AuditQueriesTab({ companyId, queries, periodStart, periodEnd, previewMode }: { companyId: string; queries: AuditQuery[]; periodStart: string; periodEnd: string; previewMode: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [source, setSource] = useState<AuditQuerySource>("journals");
  const [field, setField] = useState("amount");
  const [operator, setOperator] = useState<AuditQueryCondition["operator"]>("gt");
  const [value, setValue] = useState("500000");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function save() {
    setLoading(true);
    setError(null);
    try {
      const condition: AuditQueryCondition = operator === "isWeekend" ? { field, operator } : { field, operator, value: Number.isNaN(Number(value)) ? value : Number(value) };
      const res = await fetch(`/api/companies/${companyId}/audit/queries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, queryDefinition: { source, conditions: [condition] } }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setName("");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <p className="text-xs text-vf-ink-faint">Save reusable audit procedures — e.g. &quot;Transactions &gt; R500,000&quot;, &quot;All journals posted on weekends&quot;.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Large journals" className="w-56" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Source</label>
              <select value={source} onChange={(e) => setSource(e.target.value as AuditQuerySource)} className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Field</label>
              <Input value={field} onChange={(e) => setField(e.target.value)} className="w-32" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Operator</label>
              <select value={operator} onChange={(e) => setOperator(e.target.value as AuditQueryCondition["operator"])} className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
                {OPERATORS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            {operator !== "isWeekend" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Value</label>
                <Input value={value} onChange={(e) => setValue(e.target.value)} className="w-32" />
              </div>
            )}
            <Button variant="primary" size="sm" disabled={previewMode || loading || !name.trim()} title={disabledTitle} onClick={save}>
              Save Query
            </Button>
          </div>
          {error && <p className="text-sm text-vf-danger">{error}</p>}
        </CardContent>
      </Card>

      {queries.length === 0 ? (
        <EmptyState title="No saved audit queries yet." description="Save one above to reuse it every engagement." />
      ) : (
        <div className="flex flex-col gap-3">
          {queries.map((q) => (
            <QueryCard key={q.id} companyId={companyId} query={q} periodStart={periodStart} periodEnd={periodEnd} previewMode={previewMode} />
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import type { AuditQuery, AuditQueryCondition, AuditQuerySource } from "@/server/audit/types";

const SOURCES: AuditQuerySource[] = ["journals", "glTransactions", "bankTransactions"];
const OPERATORS: AuditQueryCondition["operator"][] = ["gt", "gte", "lt", "lte", "eq", "neq", "isWeekend"];

function QueryCard({ companyId, query, periodStart, periodEnd, previewMode }: { companyId: string; query: AuditQuery; periodStart: string; periodEnd: string; previewMode: boolean }) {
  const router = useRouter();
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [loading, setLoading] = useState(false);
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
        <div className="flex gap-2">
          <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={run}>
            Run
          </Button>
          <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={remove}>
            Delete
          </Button>
        </div>
      </div>
      {results !== null && (
        <p className="mt-3 text-sm text-vf-ink-soft">
          {results.length} result(s).{" "}
          {results.length > 0 && <span className="font-mono text-xs">{JSON.stringify(results.slice(0, 5))}</span>}
        </p>
      )}
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

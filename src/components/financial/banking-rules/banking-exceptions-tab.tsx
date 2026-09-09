"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { IconMinus, IconShieldCheck } from "@/components/ui/icons";
import { EXCEPTION_LABEL, type BankingException, type ExceptionStatus, type ExceptionType } from "@/server/banking-rules/types";

export { EXCEPTION_LABEL };

const EXCEPTION_TYPES = Object.keys(EXCEPTION_LABEL) as ExceptionType[];
const ALL_TYPES = "All";

const STATUS_TONE: Record<ExceptionStatus, "warn" | "good" | "muted"> = {
  Open: "warn",
  Resolved: "good",
  Dismissed: "muted",
};

function ExceptionCard({
  exception,
  companyId,
  previewMode,
  selected,
  onToggleSelect,
}: {
  exception: BankingException;
  companyId: string;
  previewMode: boolean;
  selected: boolean;
  onToggleSelect: (id: number) => void;
}) {
  const router = useRouter();
  const [noting, setNoting] = useState<"Resolved" | "Dismissed" | "Open" | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function submit(status: "Resolved" | "Dismissed" | "Open") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/banking-exceptions/${exception.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setNoting(null);
      setNote("");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {exception.status === "Open" && (
            <input type="checkbox" className="mt-1" checked={selected} onChange={() => onToggleSelect(exception.id)} aria-label={`Select exception ${exception.id}`} />
          )}
          <div>
            <div className="flex items-center gap-2">
              <Badge tone="danger">{EXCEPTION_LABEL[exception.exceptionType]}</Badge>
              <Badge tone={STATUS_TONE[exception.status]}>{exception.status}</Badge>
            </div>
            <p className="mt-1.5 text-sm font-medium text-vf-ink">{exception.reason}</p>
          </div>
        </div>
        {exception.status === "Open" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => setNoting("Resolved")}>
              <IconShieldCheck className="h-4 w-4" /> Resolve
            </Button>
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => setNoting("Dismissed")}>
              <IconMinus className="h-4 w-4" /> Dismiss
            </Button>
          </div>
        ) : (
          // Finding #096 — Resolved/Dismissed was previously a one-way
          // door; Reopen is the explicit reverse action.
          <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => setNoting("Open")}>
            Reopen
          </Button>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-vf-ink-faint">Evidence</dt>
          <dd className="text-vf-ink-soft">{exception.evidence || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-vf-ink-faint">Recommended Action</dt>
          <dd className="text-vf-ink-soft">{exception.recommendedAction || "—"}</dd>
        </div>
      </dl>

      {exception.status !== "Open" && (
        <p className="mt-2 text-xs text-vf-ink-faint">
          {exception.status} by {exception.resolvedBy} {exception.resolvedAt ? `on ${new Date(exception.resolvedAt).toLocaleString()}` : ""}
          {exception.resolutionNote && ` — "${exception.resolutionNote}"`}
        </p>
      )}

      {noting && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-vf-paper-border pt-3">
          {noting !== "Open" && <Input placeholder="Resolution note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-xs" />}
          <Button variant="primary" size="sm" disabled={loading} onClick={() => submit(noting)}>
            Confirm {noting === "Open" ? "Reopen" : noting}
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setNoting(null)}>
            Cancel
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function BankingExceptionsTab({ companyId, exceptions, previewMode }: { companyId: string; exceptions: BankingException[]; previewMode: boolean }) {
  // Finding #151 — filter/search that was entirely missing (contrast
  // with Duplicate Detection's entity-type chips in the same module
  // family), plus bulk Resolve/Dismiss for the Open section, mirroring
  // the pattern already established for Banking Rules (#150).
  const [typeFilter, setTypeFilter] = useState<ExceptionType | typeof ALL_TYPES>(ALL_TYPES);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkNote, setBulkNote] = useState("");
  const [bulkWorking, setBulkWorking] = useState(false);
  const router = useRouter();
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return exceptions.filter((e) => {
      if (typeFilter !== ALL_TYPES && e.exceptionType !== typeFilter) return false;
      if (!term) return true;
      return e.reason.toLowerCase().includes(term) || e.evidence.toLowerCase().includes(term);
    });
  }, [exceptions, typeFilter, search]);

  const open = filtered.filter((e) => e.status === "Open");
  const resolved = filtered.filter((e) => e.status !== "Open");

  function toggleSelect(id: number) {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkSubmit(status: "Resolved" | "Dismissed") {
    setBulkWorking(true);
    try {
      await Promise.all(
        [...selectedIds].map((id) =>
          fetch(`/api/companies/${companyId}/banking-exceptions/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status, note: bulkNote }),
          }),
        ),
      );
      setSelectedIds(new Set());
      setBulkNote("");
      router.refresh();
    } finally {
      setBulkWorking(false);
    }
  }

  if (exceptions.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState title="No exceptions." description="Every transaction has been recognised by a rule, or is still awaiting the Rule Engine's next run." />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52">
          <label htmlFor="exc-type" className="mb-1 block text-xs font-medium text-vf-ink-faint">Type</label>
          <select
            id="exc-type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as ExceptionType | typeof ALL_TYPES)}
            className="w-full rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink"
          >
            <option value={ALL_TYPES}>All types</option>
            {EXCEPTION_TYPES.map((t) => (
              <option key={t} value={t}>{EXCEPTION_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[220px]">
          <label htmlFor="exc-search" className="mb-1 block text-xs font-medium text-vf-ink-faint">Search</label>
          <Input id="exc-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Reason or evidence…" />
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-vf-md border border-vf-paper-border bg-vf-paper-alt/60 px-3 py-2 text-sm">
          <span className="text-vf-ink-soft">{selectedIds.size} selected</span>
          <Input placeholder="Resolution note (optional, applied to all)" value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} className="max-w-xs" />
          <Button variant="subtle" size="sm" disabled={previewMode || bulkWorking} title={disabledTitle} onClick={() => bulkSubmit("Resolved")}>
            Resolve Selected
          </Button>
          <Button variant="subtle" size="sm" disabled={previewMode || bulkWorking} title={disabledTitle} onClick={() => bulkSubmit("Dismissed")}>
            Dismiss Selected
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setSelectedIds(new Set())}>
            Clear Selection
          </Button>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold text-vf-ink">Open ({open.length})</h2>
        {open.length === 0 ? (
          <p className="text-sm text-vf-ink-faint">Nothing awaiting review.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {open.map((e) => (
              <ExceptionCard key={e.id} exception={e} companyId={companyId} previewMode={previewMode} selected={selectedIds.has(e.id)} onToggleSelect={toggleSelect} />
            ))}
          </div>
        )}
      </div>

      {resolved.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-vf-ink">Resolution History ({resolved.length})</h2>
          <div className="flex flex-col gap-3">
            {resolved.map((e) => (
              <ExceptionCard key={e.id} exception={e} companyId={companyId} previewMode={previewMode} selected={false} onToggleSelect={toggleSelect} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

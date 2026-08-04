"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { IconMinus, IconShieldCheck } from "@/components/ui/icons";
import type { BankingException, ExceptionStatus, ExceptionType } from "@/server/banking-rules/types";

const EXCEPTION_LABEL: Record<ExceptionType, string> = {
  UnknownMerchant: "Unknown Merchant",
  MissingSupplier: "Missing Supplier",
  PossibleDuplicate: "Possible Duplicate",
  UnbalancedAllocation: "Unbalanced Allocation",
  MissingInvoice: "Missing Invoice",
  UnexpectedVAT: "Unexpected VAT",
  PeriodConflict: "Period Conflict",
  LargeUnusualPayment: "Large Unusual Payment",
};

const STATUS_TONE: Record<ExceptionStatus, "warn" | "good" | "muted"> = {
  Open: "warn",
  Resolved: "good",
  Dismissed: "muted",
};

function ExceptionCard({ exception, companyId, previewMode }: { exception: BankingException; companyId: string; previewMode: boolean }) {
  const router = useRouter();
  const [noting, setNoting] = useState<"Resolved" | "Dismissed" | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function submit(status: "Resolved" | "Dismissed") {
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
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="danger">{EXCEPTION_LABEL[exception.exceptionType]}</Badge>
            <Badge tone={STATUS_TONE[exception.status]}>{exception.status}</Badge>
          </div>
          <p className="mt-1.5 text-sm font-medium text-vf-ink">{exception.reason}</p>
        </div>
        {exception.status === "Open" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => setNoting("Resolved")}>
              <IconShieldCheck className="h-4 w-4" /> Resolve
            </Button>
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => setNoting("Dismissed")}>
              <IconMinus className="h-4 w-4" /> Dismiss
            </Button>
          </div>
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
          <Input placeholder="Resolution note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-xs" />
          <Button variant="primary" size="sm" disabled={loading} onClick={() => submit(noting)}>
            Confirm {noting}
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
  const open = exceptions.filter((e) => e.status === "Open");
  const resolved = exceptions.filter((e) => e.status !== "Open");

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
      <div>
        <h2 className="mb-3 text-sm font-semibold text-vf-ink">Open ({open.length})</h2>
        {open.length === 0 ? (
          <p className="text-sm text-vf-ink-faint">Nothing awaiting review.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {open.map((e) => (
              <ExceptionCard key={e.id} exception={e} companyId={companyId} previewMode={previewMode} />
            ))}
          </div>
        )}
      </div>

      {resolved.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-vf-ink">Resolution History ({resolved.length})</h2>
          <div className="flex flex-col gap-3">
            {resolved.map((e) => (
              <ExceptionCard key={e.id} exception={e} companyId={companyId} previewMode={previewMode} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconFileText, IconPlus } from "@/components/ui/icons";
import type { VatReturn, VatReturnStatus } from "@/server/vat/types";

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_TONE: Record<VatReturnStatus, "warn" | "info" | "good" | "muted"> = { Draft: "warn", Review: "info", Approved: "info", Submitted: "good" };

function GenerateReturnForm({ companyId, onDone, onCancel }: { companyId: string; onDone: () => void; onCancel: () => void }) {
  const today = new Date();
  const [periodStart, setPeriodStart] = useState(new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/vat-returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart, periodEnd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      onDone();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <p className="mb-3 text-sm font-semibold text-vf-ink">Generate VAT Return</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Period Start" htmlFor="ret-start" required>
          <Input id="ret-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </Field>
        <Field label="Period End" htmlFor="ret-end" required>
          <Input id="ret-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-vf-ink-faint">Computed live from VAT Input (2100) / VAT Output (2200) account activity for this period.</p>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading} onClick={submit}>
          Generate
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

function ReturnCard({ vatReturn, companyId, previewMode }: { vatReturn: VatReturn; companyId: string; previewMode: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sarsReference, setSarsReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function act(body: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/vat-returns/${vatReturn.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
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
            <Badge tone={STATUS_TONE[vatReturn.status]}>{vatReturn.status}</Badge>
            {vatReturn.isAmendment && <Badge tone="muted">Amendment</Badge>}
          </div>
          <p className="mt-1 text-sm font-semibold text-vf-ink">{vatReturn.periodStart} to {vatReturn.periodEnd}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {vatReturn.status === "Draft" && (
            <>
              <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => act({ action: "recalculate" })}>
                Recalculate
              </Button>
              <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => act({ action: "review" })}>
                Move to Review
              </Button>
            </>
          )}
          {(vatReturn.status === "Draft" || vatReturn.status === "Review") && (
            <Button variant="primary" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => act({ action: "approve" })}>
              Approve
            </Button>
          )}
          {vatReturn.status === "Approved" && !submitting && (
            <Button variant="primary" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => setSubmitting(true)}>
              Submit
            </Button>
          )}
          {vatReturn.status === "Submitted" && (
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => act({ action: "amend" })}>
              Create Amendment
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-vf-ink-faint">Output VAT</dt>
          <dd className="font-mono tabular-nums text-vf-ink">{money(vatReturn.totalOutputVat)}</dd>
        </div>
        <div>
          <dt className="text-xs text-vf-ink-faint">Input VAT</dt>
          <dd className="font-mono tabular-nums text-vf-ink">{money(vatReturn.totalInputVat)}</dd>
        </div>
        <div>
          <dt className="text-xs text-vf-ink-faint">Net {vatReturn.netPayable >= 0 ? "Payable" : "Receivable"}</dt>
          <dd className="font-mono tabular-nums text-vf-ink">{money(Math.abs(vatReturn.netPayable))}</dd>
        </div>
        <div>
          <dt className="text-xs text-vf-ink-faint">Submission Method</dt>
          <dd className="text-vf-ink">
            {vatReturn.submissionMethod === "Manual" ? "Manual" : "SARS eFiling"}
          </dd>
        </div>
      </dl>

      {vatReturn.sarsReference && <p className="mt-2 text-xs text-vf-ink-faint">SARS reference: {vatReturn.sarsReference}</p>}

      {submitting && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-vf-paper-border pt-3">
          <Input placeholder="SARS reference (optional)" value={sarsReference} onChange={(e) => setSarsReference(e.target.value)} className="max-w-xs" />
          <Button variant="primary" size="sm" disabled={loading} onClick={() => { act({ action: "submit", sarsReference: sarsReference || undefined }); setSubmitting(false); }}>
            Confirm Submitted
          </Button>
          <Button
            variant="subtle"
            size="sm"
            disabled
            title="Real-time SARS eFiling is not connected yet — this is a real extension point, not a working submission. See docs/MIGRATION_ROADMAP.md."
          >
            Submit via SARS eFiling
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setSubmitting(false)}>
            Cancel
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function VatReturnsTab({ companyId, vatReturns, previewMode }: { companyId: string; vatReturns: VatReturn[]; previewMode: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setCreating((c) => !c)}>
          <IconPlus className="h-4 w-4" /> {creating ? "Close" : "Generate Return"}
        </Button>
      </div>

      {creating && (
        <GenerateReturnForm
          companyId={companyId}
          onDone={() => {
            setCreating(false);
            router.refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {vatReturns.length === 0 ? (
        <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No VAT Returns yet." description="Generate your first return above." />
      ) : (
        vatReturns.map((r) => <ReturnCard key={r.id} vatReturn={r} companyId={companyId} previewMode={previewMode} />)
      )}
    </div>
  );
}

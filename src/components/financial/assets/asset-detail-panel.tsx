"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DocumentsPanel } from "@/components/financial/documents/documents-panel";
import type { AssetLifecycleEvent, FixedAssetWithNetBookValue } from "@/server/assets/types";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type ActionForm = "capitalise" | "improve" | "transfer" | "revalue" | "dispose" | null;

export function AssetDetailPanel({ companyId, asset, lifecycleEvents, previewMode }: { companyId: string; asset: FixedAssetWithNetBookValue; lifecycleEvents: AssetLifecycleEvent[]; previewMode: boolean }) {
  const router = useRouter();
  const [activeForm, setActiveForm] = useState<ActionForm>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  // Shared form fields — only the ones relevant to the open action matter.
  const [inServiceDate, setInServiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [paymentAccountCode, setPaymentAccountCode] = useState("1000");
  const [description, setDescription] = useState("");
  const [delta, setDelta] = useState("");
  const [disposeEventType, setDisposeEventType] = useState<"Disposal" | "WriteOff" | "Retirement">("Disposal");
  const [proceeds, setProceeds] = useState("0");

  async function submit(path: string, body: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/assets/register/${asset.id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setActiveForm(null);
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  const canCapitalise = asset.status === "Draft";
  const isTerminal = asset.status === "Disposed" || asset.status === "WrittenOff" || asset.status === "Retired";

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-vf-ink-faint">{asset.assetNumber}</span>
            <p className="text-sm font-semibold text-vf-ink">{asset.description}</p>
            <Badge tone={asset.status === "Active" ? "good" : isTerminal ? "muted" : "warn"}>{asset.status}</Badge>
          </div>
          <p className="mt-1 text-xs text-vf-ink-faint">{asset.location || "No location"} · {asset.custodian || "No custodian"}</p>
        </div>
        {!isTerminal && (
          <div className="flex flex-wrap gap-2">
            {canCapitalise && (
              <Button variant="subtle" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setActiveForm("capitalise")}>
                Capitalise
              </Button>
            )}
            <Button variant="subtle" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setActiveForm("improve")}>
              Improve
            </Button>
            <Button variant="subtle" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setActiveForm("transfer")}>
              Transfer
            </Button>
            <Button variant="subtle" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setActiveForm("revalue")}>
              Revalue / Impair
            </Button>
            <Button variant="subtle" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setActiveForm("dispose")}>
              Disposal
            </Button>
          </div>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <div>
          <dt className="text-xs text-vf-ink-faint">Cost</dt>
          <dd className="font-mono tabular-nums">{money(asset.cost)}</dd>
        </div>
        <div>
          <dt className="text-xs text-vf-ink-faint">Accumulated Depreciation</dt>
          <dd className="font-mono tabular-nums">{money(asset.accumulatedDepreciation)}</dd>
        </div>
        <div>
          <dt className="text-xs text-vf-ink-faint">Accumulated Impairment</dt>
          <dd className="font-mono tabular-nums">{money(asset.accumulatedImpairment)}</dd>
        </div>
        <div>
          <dt className="text-xs text-vf-ink-faint">Net Book Value</dt>
          <dd className="font-mono tabular-nums font-semibold">{money(asset.netBookValue)}</dd>
        </div>
        <div>
          <dt className="text-xs text-vf-ink-faint">Depreciation Method</dt>
          <dd>{asset.depreciationMethod}</dd>
        </div>
      </dl>

      {activeForm === "capitalise" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-vf-paper-border pt-3">
          <Input type="date" value={inServiceDate} onChange={(e) => setInServiceDate(e.target.value)} className="w-40" />
          <Button variant="primary" size="sm" disabled={loading} onClick={() => submit("capitalise", { inServiceDate })}>
            Confirm Capitalise
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setActiveForm(null)}>Cancel</Button>
        </div>
      )}

      {activeForm === "improve" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-vf-paper-border pt-3">
          <Input placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" />
          <Input placeholder="Paid from (account code)" value={paymentAccountCode} onChange={(e) => setPaymentAccountCode(e.target.value)} className="w-40" />
          <Input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} className="w-56" />
          <Button variant="primary" size="sm" disabled={loading || !amount} onClick={() => submit("improve", { amount: Number(amount), paymentAccountCode, description })}>
            Confirm Improvement
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setActiveForm(null)}>Cancel</Button>
        </div>
      )}

      {activeForm === "transfer" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-vf-paper-border pt-3">
          <Input placeholder="New location" value={description} onChange={(e) => setDescription(e.target.value)} className="w-56" />
          <Button variant="primary" size="sm" disabled={loading} onClick={() => submit("transfer", { location: description })}>
            Confirm Transfer
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setActiveForm(null)}>Cancel</Button>
        </div>
      )}

      {activeForm === "revalue" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-vf-paper-border pt-3">
          <Input placeholder="Delta (+ increase / - impairment)" value={delta} onChange={(e) => setDelta(e.target.value)} className="w-64" />
          <Button variant="primary" size="sm" disabled={loading || !delta} onClick={() => submit("revalue", { delta: Number(delta) })}>
            Confirm
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setActiveForm(null)}>Cancel</Button>
        </div>
      )}

      {activeForm === "dispose" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-vf-paper-border pt-3">
          <select value={disposeEventType} onChange={(e) => setDisposeEventType(e.target.value as typeof disposeEventType)} className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
            <option value="Disposal">Disposal</option>
            <option value="WriteOff">Write-Off</option>
            <option value="Retirement">Retirement</option>
          </select>
          <Input placeholder="Proceeds" value={proceeds} onChange={(e) => setProceeds(e.target.value)} className="w-32" />
          <Input placeholder="Paid into (account code, if proceeds > 0)" value={paymentAccountCode} onChange={(e) => setPaymentAccountCode(e.target.value)} className="w-56" />
          <Button
            variant="primary"
            size="sm"
            disabled={loading}
            onClick={() => submit("dispose", { eventType: disposeEventType, proceeds: Number(proceeds), paymentAccountCode: Number(proceeds) > 0 ? paymentAccountCode : null, description })}
          >
            Confirm {disposeEventType}
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setActiveForm(null)}>Cancel</Button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}

      <div className="mt-4 border-t border-vf-paper-border pt-3">
        <p className="mb-2 text-xs font-semibold text-vf-ink-faint">Lifecycle History</p>
        {lifecycleEvents.length === 0 ? (
          <p className="text-sm text-vf-ink-faint">No lifecycle events yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {lifecycleEvents.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 border-t border-vf-paper-border pt-1.5 first:border-0">
                <span className="text-vf-ink-soft">
                  <Badge tone="info">{e.eventType}</Badge> {e.description}
                </span>
                <span className="text-xs text-vf-ink-faint">{e.eventDate}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 border-t border-vf-paper-border pt-3">
        <DocumentsPanel companyId={companyId} entityType="Asset" entityId={asset.id} previewMode={previewMode} />
      </div>
    </div>
  );
}

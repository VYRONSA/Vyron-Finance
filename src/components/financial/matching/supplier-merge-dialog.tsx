"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import type { SupplierMergeCandidate, SupplierMergeResult } from "@/server/services/merge-service";

/** Phase 33A — replaces the previous arbitrary "whichever finding row you
 * clicked" survivor pick (Phase 33's own flagged ambiguity — see migration
 * 0090's docstring) with a real, explicit two-step choice: pick a
 * survivor from BOTH real records shown side by side (never preselected),
 * then confirm an unambiguous KEEP/MERGE summary before anything is
 * written. Wired to the already-built atomic engine
 * (`mergeService.mergeSuppliers` via `POST /suppliers/merge`) — no second
 * merge implementation. */
export function SupplierMergeDialog({
  companyId,
  supplierAId,
  supplierBId,
  onClose,
  onMerged,
}: {
  companyId: string;
  supplierAId: number;
  supplierBId: number;
  onClose: () => void;
  onMerged: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, panelRef);

  const [preview, setPreview] = useState<{ supplierA: SupplierMergeCandidate; supplierB: SupplierMergeCandidate } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSurvivorId, setSelectedSurvivorId] = useState<number | null>(null);
  const [step, setStep] = useState<"choosing" | "confirming">("choosing");
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [result, setResult] = useState<SupplierMergeResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/companies/${companyId}/suppliers/merge-preview?a=${supplierAId}&b=${supplierBId}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data.error ?? `Request failed (${res.status})`);
          return;
        }
        setPreview(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't reach the API. Check the dev server is running.");
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, supplierAId, supplierBId]);

  // Phase 33B — Cancel at the FINAL confirmation step used to just step
  // back to survivor selection (still open, choice preserved). The
  // approved correction: Cancel here closes the dialog outright — no API
  // request, no merge, no partial "still open, still on some step"
  // state left behind. Resets local state before calling `onClose` so a
  // parent that keeps this component mounted (rather than conditionally
  // rendering it) never shows a stale selection on reopen.
  function cancelFromConfirmation() {
    setSelectedSurvivorId(null);
    setStep("choosing");
    setMergeError(null);
    onClose();
  }

  async function confirmMerge() {
    if (selectedSurvivorId === null || !preview) return;
    const duplicateId = selectedSurvivorId === preview.supplierA.id ? preview.supplierB.id : preview.supplierA.id;
    setMerging(true);
    setMergeError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/suppliers/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ survivingSupplierId: selectedSurvivorId, duplicateSupplierId: duplicateId }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Phase 33A, Part 9 — never show success if the RPC failed; the
        // atomic transaction itself already guarantees nothing partial
        // was written, so surfacing the real reason here is safe and
        // accurate, not a guess about what may have happened.
        setMergeError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setResult(data.result);
      onMerged();
    } catch {
      setMergeError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setMerging(false);
    }
  }

  function candidateCard(candidate: SupplierMergeCandidate, label: "A" | "B") {
    const selected = selectedSurvivorId === candidate.id;
    return (
      <div className={`flex flex-1 flex-col gap-2 rounded-vf-md border p-4 ${selected ? "border-vf-red-500 bg-vf-red-500/5" : "border-vf-paper-border"}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Supplier {label}</span>
          <Badge tone={candidate.status === "Active" ? "good" : "muted"}>{candidate.status}</Badge>
        </div>
        <p className="text-sm font-semibold text-vf-ink">{candidate.name}</p>
        <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-vf-ink-soft">
          <dt className="text-vf-ink-faint">Supplier Code</dt>
          <dd className="text-right font-mono">{candidate.supplierCode || "—"}</dd>
          <dt className="text-vf-ink-faint">VAT Number</dt>
          <dd className="text-right">{candidate.vatNumber || "—"}</dd>
          <dt className="text-vf-ink-faint">Tax Number</dt>
          <dd className="text-right">{candidate.taxNumber || "—"}</dd>
          <dt className="text-vf-ink-faint">Payment Terms</dt>
          <dd className="text-right">{candidate.paymentTermsDays} days</dd>
          <dt className="text-vf-ink-faint">Linked Records</dt>
          <dd className="text-right font-semibold tabular-nums">{candidate.linkedRecordCount}</dd>
        </dl>
        <Button
          variant={selected ? "primary" : "subtle"}
          size="sm"
          onClick={() => setSelectedSurvivorId(candidate.id)}
        >
          {selected ? `✓ Keeping Supplier ${label}` : `Keep Supplier ${label}`}
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplier-merge-heading"
        tabIndex={-1}
        className="relative flex w-full max-w-2xl flex-col gap-4 rounded-vf-lg bg-vf-paper p-6 shadow-2xl"
      >
        <h2 id="supplier-merge-heading" className="text-lg font-semibold text-vf-ink">
          Merge Suppliers
        </h2>

        {result ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-vf-md border border-vf-success/40 bg-vf-success/10 p-4">
              <p className="font-medium text-[#1f6e4b]">Supplier merged successfully.</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm text-vf-ink-soft">
                <dt className="font-medium text-vf-ink">Kept:</dt>
                <dd>{result.survivingSupplierName} {result.survivingSupplierCode ? `(${result.survivingSupplierCode})` : ""}</dd>
                <dt className="font-medium text-vf-ink">Deactivated:</dt>
                <dd>{result.mergedSupplierName} {result.mergedSupplierCode ? `(${result.mergedSupplierCode})` : ""}</dd>
                <dt className="font-medium text-vf-ink">Records transferred:</dt>
                <dd>{result.totalRecordsRepointed === 0 ? "0 — this duplicate had no linked records." : result.totalRecordsRepointed}</dd>
              </dl>
            </div>
            <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
          </div>
        ) : loadError ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-vf-danger">{loadError}</p>
            <Button variant="subtle" size="sm" onClick={onClose}>Close</Button>
          </div>
        ) : !preview ? (
          <p className="text-sm text-vf-ink-faint">Loading supplier details…</p>
        ) : step === "choosing" ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-vf-ink-soft">Choose which supplier record should remain active. The other will be deactivated and its linked records transferred to the one you keep.</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              {candidateCard(preview.supplierA, "A")}
              {candidateCard(preview.supplierB, "B")}
            </div>
            <div className="flex gap-2 border-t border-vf-paper-border pt-3">
              <Button variant="subtle" size="sm" onClick={onClose}>Cancel</Button>
              <Button variant="primary" size="sm" disabled={selectedSurvivorId === null} onClick={() => setStep("confirming")}>
                Continue
              </Button>
            </div>
          </div>
        ) : (
          (() => {
            const survivor = selectedSurvivorId === preview.supplierA.id ? preview.supplierA : preview.supplierB;
            const duplicate = selectedSurvivorId === preview.supplierA.id ? preview.supplierB : preview.supplierA;
            return (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-sm font-medium text-vf-ink">Merge suppliers?</p>
                  <p className="mt-1 text-sm text-vf-ink-soft">
                    <span className="font-semibold">{survivor.name}</span> will remain active. <span className="font-semibold">{duplicate.name}</span> will be deactivated and its linked records will be transferred to <span className="font-semibold">{survivor.name}</span>.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex-1 rounded-vf-md border border-vf-success/40 bg-vf-success/10 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#1f6e4b]">Keep</p>
                    <p className="text-sm font-semibold text-vf-ink">{survivor.name}</p>
                    <p className="font-mono text-xs text-vf-ink-faint">{survivor.supplierCode || "—"}</p>
                  </div>
                  <div className="flex-1 rounded-vf-md border border-vf-danger/40 bg-vf-danger/10 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-vf-danger">Merge (deactivate)</p>
                    <p className="text-sm font-semibold text-vf-ink">{duplicate.name}</p>
                    <p className="font-mono text-xs text-vf-ink-faint">{duplicate.supplierCode || "—"}</p>
                  </div>
                </div>
                {mergeError && (
                  <div className="rounded-vf-md border border-vf-danger/40 bg-vf-danger/10 p-3">
                    <p className="text-sm font-medium text-vf-danger">Supplier merge failed</p>
                    <p className="mt-1 text-xs text-vf-ink-soft">{mergeError}</p>
                  </div>
                )}
                <div className="flex gap-2 border-t border-vf-paper-border pt-3">
                  <Button variant="subtle" size="sm" disabled={merging} onClick={cancelFromConfirmation}>Cancel</Button>
                  <Button variant="primary" size="sm" disabled={merging} onClick={confirmMerge}>
                    {merging ? "Merging…" : "Merge Suppliers"}
                  </Button>
                </div>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}

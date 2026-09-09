"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmActionRow, useConfirmTarget } from "@/components/ui/confirm-action";
import { SupplierMergeDialog } from "./supplier-merge-dialog";
import type { DuplicateEntityType, DuplicateFinding } from "@/server/services/duplicate-detection-service";

const ENTITY_TYPES: DuplicateEntityType[] = [
  "Customer", "Supplier", "Merchant", "InventoryItem", "Transaction",
  "SalesOrder", "PurchaseOrder", "Quotation", "Bill", "Payment", "Receipt", "Journal",
];

const ALL = "All";

function confidenceTone(confidence: number): "muted" | "warn" | "danger" {
  if (confidence >= 0.8) return "danger";
  if (confidence >= 0.6) return "warn";
  return "muted";
}

function FindingRow({ companyId, finding, previewMode, onDismissedLocally }: { companyId: string; finding: DuplicateFinding; previewMode: boolean; onDismissedLocally: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"override" | "ignore" | "merge" | null>(null);
  const mergeConfirm = useConfirmTarget<true>();
  // Phase 33A — Supplier findings no longer use the old arbitrary-survivor
  // ConfirmActionRow flow below at all; they open the explicit-choice
  // dialog instead. `otherSupplierId` is just "the other real record in
  // this finding's group" — never a survivor guess, since the dialog
  // itself is what makes that choice, deliberately, every time.
  const [supplierMergeOpen, setSupplierMergeOpen] = useState(false);
  const otherSupplierId = finding.entityType === "Supplier" ? finding.groupIds.find((id) => id !== finding.relatedId) : undefined;
  // Finding #149 — Permanent Ignore is an irreversible, persisted action
  // (unlike the session-only "Ignore" button below) that fired on a
  // single click with no confirmation, distinguished from "Ignore" only
  // by a border/text color. Same confirm pattern as Suggested Merge above.
  const permanentIgnoreConfirm = useConfirmTarget<true>();
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function manualOverride() {
    setBusy("override");
    try {
      const res = await fetch(`/api/companies/${companyId}/matching/duplicates/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: finding.entityType, relatedId: finding.relatedId, reason: reason || "Reviewed — confirmed not a duplicate." }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function permanentIgnore() {
    setBusy("ignore");
    try {
      const res = await fetch(`/api/companies/${companyId}/matching/duplicates/ignore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: finding.entityType, relatedId: finding.relatedId, reason: reason || "Permanently ignored by reviewer." }),
      });
      if (res.ok) {
        permanentIgnoreConfirm.cancel();
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function suggestedMerge() {
    setBusy("merge");
    try {
      // The record this finding is FOR always merges INTO another real
      // member of its own duplicate group — never into itself. See
      // docs/DEFECT_REGISTER.md D-026: this used to submit the same ID
      // for both sides, which the API correctly (and silently, from
      // this button's perspective) rejected every single time.
      const survivingId = finding.groupIds.find((id) => id !== finding.relatedId);
      if (survivingId === undefined) return; // no real merge target in this finding's group — nothing to do

      const endpoint =
        finding.entityType === "Merchant"
          ? `/api/companies/${companyId}/matching/merchants/merge`
          : `/api/companies/${companyId}/matching/parties/merge`;
      const body =
        finding.entityType === "Merchant"
          ? { survivingMerchantId: survivingId, mergedMerchantId: finding.relatedId }
          : { partyType: finding.entityType, survivingPartyId: survivingId, mergedPartyId: finding.relatedId };
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        mergeConfirm.cancel();
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="info">{finding.entityType}</Badge>
            <Badge tone={confidenceTone(finding.confidence)}>{Math.round(finding.confidence * 100)}% confidence</Badge>
          </div>
          <p className="mt-1.5 text-sm text-vf-ink">{finding.reason}</p>
          <p className="mt-0.5 text-xs text-vf-ink-faint">{finding.evidence}</p>
        </div>
        <Button href={finding.detailHref} variant="subtle" size="sm">
          Open Record
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-vf-paper-border pt-3">
        <div className="min-w-[220px] flex-1">
          <label htmlFor={`reason-${finding.id}`} className="mb-1 block text-xs font-medium text-vf-ink-faint">Reason (for Manual Override / Permanent Ignore)</label>
          <Input id={`reason-${finding.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional note…" />
        </div>
        {finding.supportsMerge && finding.entityType === "Supplier" ? (
          // Phase 33A — real, explicit-survivor-choice merge, replacing
          // the arbitrary-pick ConfirmActionRow flow other entity types
          // below still use. See migration 0090's docstring / Phase 33
          // report for why this needed its own interaction rather than
          // reusing that flow with the new atomic engine underneath it.
          otherSupplierId !== undefined && (
            <Button variant="subtle" size="sm" disabled={previewMode || busy !== null} title={disabledTitle} onClick={() => setSupplierMergeOpen(true)}>
              Merge Suppliers
            </Button>
          )
        ) : (
          finding.supportsMerge &&
          (mergeConfirm.isConfirming(true) ? (
            <ConfirmActionRow
              message={
                // Phase 33 — this used to claim "This repoints all linked
                // transactions" for every merge-supporting entity type,
                // which is only true for Merchant. For Customer, "Suggested
                // Merge" only records the decision for manual review today
                // — it does not repoint any financial history or
                // deactivate either record (Supplier now has its own real,
                // explicit-choice flow above instead — see Phase 33/33A).
                finding.entityType === "Merchant"
                  ? "Merge these records? This repoints all linked transactions and cannot be undone."
                  : "Flag these records as a confirmed duplicate? This records the decision for review — it does not merge financial history or deactivate either record."
              }
              confirmLabel="Confirm Merge"
              confirmingLabel="Merging…"
              loading={busy === "merge"}
              tone="danger"
              onConfirm={suggestedMerge}
              onCancel={mergeConfirm.cancel}
            />
          ) : (
            <Button variant="subtle" size="sm" disabled={previewMode || busy !== null} title={disabledTitle} onClick={() => mergeConfirm.request(true)}>
              Suggested Merge
            </Button>
          ))
        )}
        <Button variant="subtle" size="sm" disabled={previewMode || busy !== null} title={disabledTitle} onClick={manualOverride}>
          {busy === "override" ? "Saving…" : "Manual Override"}
        </Button>
        <Button variant="subtle" size="sm" onClick={onDismissedLocally}>
          Ignore
        </Button>
        {permanentIgnoreConfirm.isConfirming(true) ? (
          <ConfirmActionRow
            message="Permanently ignore this pair? This is persisted and cannot be undone from this screen."
            confirmLabel="Confirm Permanent Ignore"
            confirmingLabel="Saving…"
            loading={busy === "ignore"}
            tone="danger"
            onConfirm={permanentIgnore}
            onCancel={permanentIgnoreConfirm.cancel}
          />
        ) : (
          <Button
            variant="subtle"
            size="sm"
            className="border-vf-danger/40 text-vf-danger hover:border-vf-danger hover:text-vf-danger"
            disabled={previewMode || busy !== null}
            title={disabledTitle}
            onClick={() => permanentIgnoreConfirm.request(true)}
          >
            Permanent Ignore Rule
          </Button>
        )}
      </div>
      {supplierMergeOpen && otherSupplierId !== undefined && (
        <SupplierMergeDialog
          companyId={companyId}
          supplierAId={finding.relatedId}
          supplierBId={otherSupplierId}
          onClose={() => setSupplierMergeOpen(false)}
          onMerged={() => {
            setSupplierMergeOpen(false);
            // The merged/deactivated duplicate no longer feeds into
            // future scans (see duplicate-detection-service.ts's Active-
            // only filter), but this finding was computed from the PRE-
            // merge scan still in state — dismiss it locally too so it
            // disappears immediately rather than waiting for the next
            // full re-scan.
            onDismissedLocally();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** "Duplicate Detection: Confidence, Reason, Suggested Merge, Manual
 * Override, Ignore, Permanent Ignore Rule — Customers, Suppliers,
 * Transactions, Sales Orders, Purchase Orders, Quotations, Bills,
 * Payments, Receipts, Inventory Items, Merchants, Journals." Every
 * finding is fetched from the ONE composition service
 * (`duplicate-detection-service.ts`), which itself reuses an existing
 * detector per entity type — nothing here re-derives a duplicate signal.
 * "Ignore" is a session-only local dismiss (no persistence); "Manual
 * Override" and "Permanent Ignore Rule" are both real, persisted actions
 * — see that service's own docstring for the distinction. */
export function DuplicateDetectionTab({ companyId, previewMode, initialFindings }: { companyId: string; previewMode: boolean; initialFindings?: DuplicateFinding[] }) {
  const [findings, setFindings] = useState<DuplicateFinding[] | null>(previewMode ? (initialFindings ?? []) : null);
  const [typeFilter, setTypeFilter] = useState<DuplicateEntityType | typeof ALL>(ALL);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (previewMode) return;
    fetch(`/api/companies/${companyId}/matching/duplicates`)
      .then((res) => res.json())
      .then((data) => setFindings(data.findings))
      .catch(() => setFindings([]));
  }, [companyId, previewMode]);

  const visible = useMemo(() => {
    const list = findings ?? [];
    return list.filter((f) => (typeFilter === ALL || f.entityType === typeFilter) && !dismissedIds.has(f.id));
  }, [findings, typeFilter, dismissedIds]);

  const counts = useMemo(() => {
    const map = new Map<DuplicateEntityType, number>();
    for (const f of findings ?? []) map.set(f.entityType, (map.get(f.entityType) ?? 0) + 1);
    return map;
  }, [findings]);

  if (findings === null) return <p className="text-sm text-vf-ink-faint">Scanning every entity type for duplicates…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTypeFilter(ALL)}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${typeFilter === ALL ? "border-vf-red-600 bg-vf-red-500/10 text-vf-red-600" : "border-vf-paper-border text-vf-ink-soft hover:border-vf-red-400"}`}
        >
          All ({findings.length})
        </button>
        {ENTITY_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(t)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${typeFilter === t ? "border-vf-red-600 bg-vf-red-500/10 text-vf-red-600" : "border-vf-paper-border text-vf-ink-soft hover:border-vf-red-400"}`}
          >
            {t} ({counts.get(t) ?? 0})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No duplicates found." description="Every entity type this workspace scans is clean, or every finding here has been dismissed for this session." />
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((f) => (
            <FindingRow key={f.id} companyId={companyId} finding={f} previewMode={previewMode} onDismissedLocally={() => setDismissedIds((s) => new Set(s).add(f.id))} />
          ))}
        </div>
      )}
    </div>
  );
}

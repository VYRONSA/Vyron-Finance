"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
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
      if (res.ok) router.refresh();
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
      if (res.ok) router.refresh();
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
        {finding.supportsMerge && (
          <Button variant="subtle" size="sm" disabled={previewMode || busy !== null} title={disabledTitle} onClick={suggestedMerge}>
            {busy === "merge" ? "Merging…" : "Suggested Merge"}
          </Button>
        )}
        <Button variant="subtle" size="sm" disabled={previewMode || busy !== null} title={disabledTitle} onClick={manualOverride}>
          {busy === "override" ? "Saving…" : "Manual Override"}
        </Button>
        <Button variant="subtle" size="sm" onClick={onDismissedLocally}>
          Ignore
        </Button>
        <Button variant="subtle" size="sm" className="border-vf-danger/40 text-vf-danger hover:border-vf-danger hover:text-vf-danger" disabled={previewMode || busy !== null} title={disabledTitle} onClick={permanentIgnore}>
          {busy === "ignore" ? "Saving…" : "Permanent Ignore Rule"}
        </Button>
      </div>
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

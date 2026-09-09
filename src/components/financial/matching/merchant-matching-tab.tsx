"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import type { Merchant } from "@/server/banking-rules/types";

/** "Merchant Matching: Learn merchants, Alias management, Confidence,
 * Merge merchants" — the first real UI for `merchant-service.ts`, which
 * previously had only raw API routes. Aliases are the actual matching
 * mechanism (`findMerchantByBeneficiary` in the Rule Engine) — editing
 * them here is real, not decorative. */
function MerchantRow({ companyId, merchant, allMerchants, previewMode }: { companyId: string; merchant: Merchant; allMerchants: Merchant[]; previewMode: boolean }) {
  const router = useRouter();
  const [editingAliases, setEditingAliases] = useState(false);
  const [aliasText, setAliasText] = useState(merchant.aliases.join(", "));
  const [mergeTargetId, setMergeTargetId] = useState<number>(allMerchants.find((m) => m.id !== merchant.id)?.id ?? 0);
  const [loading, setLoading] = useState(false);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function saveAliases() {
    setLoading(true);
    try {
      const aliases = aliasText.split(",").map((a) => a.trim()).filter(Boolean);
      const res = await fetch(`/api/companies/${companyId}/merchants/${merchant.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aliases }) });
      if (res.ok) {
        setEditingAliases(false);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  async function merge() {
    if (!mergeTargetId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/matching/merchants/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ survivingMerchantId: merchant.id, mergedMerchantId: mergeTargetId }),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-vf-ink">{merchant.name}</p>
          {merchant.defaultGlAccount && <p className="mt-0.5 text-xs text-vf-ink-faint">Default GL: {merchant.defaultGlAccount}</p>}
        </div>
        <Button variant="subtle" size="sm" onClick={() => setEditingAliases((v) => !v)}>
          {editingAliases ? "Cancel" : "Manage Aliases"}
        </Button>
      </div>

      {!editingAliases && merchant.aliases.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {merchant.aliases.map((alias) => (
            <span key={alias} className="rounded-full border border-vf-paper-border px-2 py-1 text-xs text-vf-ink-soft">
              {alias}
            </span>
          ))}
        </div>
      )}

      {editingAliases && (
        <div className="mt-3 flex flex-col gap-3 border-t border-vf-paper-border pt-3">
          <div>
            <label htmlFor={`alias-${merchant.id}`} className="mb-1 block text-xs font-medium text-vf-ink-faint">
              Aliases (comma-separated — every one is a real beneficiary string the Rule Engine will match to this merchant)
            </label>
            <Input id={`alias-${merchant.id}`} value={aliasText} onChange={(e) => setAliasText(e.target.value)} />
          </div>
          <Button variant="primary" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={saveAliases}>
            Save Aliases
          </Button>

          {allMerchants.length > 1 && (
            <div className="flex flex-wrap items-end gap-2 border-t border-vf-paper-border pt-3">
              <div>
                <label htmlFor={`merge-${merchant.id}`} className="mb-1 block text-xs font-medium text-vf-ink-faint">
                  Merge another merchant into this one
                </label>
                <select id={`merge-${merchant.id}`} value={mergeTargetId} onChange={(e) => setMergeTargetId(Number(e.target.value))} className="min-w-[200px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
                  {allMerchants.filter((m) => m.id !== merchant.id).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={merge}>
                Merge & Repoint Transactions
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MerchantMatchingTab({ companyId, merchants, previewMode }: { companyId: string; merchants: Merchant[]; previewMode: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function create() {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/merchants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (res.ok) {
        setName("");
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="new-merchant-name" className="mb-1 block text-xs font-medium text-vf-ink-faint">New Merchant Name</label>
            <Input id="new-merchant-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Woolworths" />
          </div>
          <Button variant="primary" size="sm" disabled={previewMode || loading || !name.trim()} title={disabledTitle} onClick={create}>
            Learn Merchant
          </Button>
        </CardContent>
      </Card>

      {merchants.length === 0 ? (
        <EmptyState title="No merchants learned yet." description="Add one above, or resolve an Unknown Merchant exception from the Review Queue." />
      ) : (
        <div className="flex flex-col gap-3">
          {merchants.map((m) => (
            <MerchantRow key={m.id} companyId={companyId} merchant={m} allMerchants={merchants} previewMode={previewMode} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-vf-ink-faint">
        <Badge tone="muted">Confidence</Badge>
        <span>Merchant resolution is an exact name/alias match (no fuzzy scoring) — real, deterministic, reproducible, same discipline as the Matching Engine.</span>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { IconChevronLeft } from "@/components/ui/icons";
import type { BankTransactionRecord } from "@/server/accounting/types";
import type { BankingRule, Merchant } from "@/server/banking-rules/types";

function money(t: BankTransactionRecord): string {
  const amount = t.debit > 0 ? t.debit : t.credit;
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Most frequent non-empty value in a list — used for "typically
 * allocated to GL 440000" rather than just showing the most recent one,
 * which could be a one-off correction. */
function mode(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, count] of counts) {
    if (count > bestCount) {
      best = v;
      bestCount = count;
    }
  }
  return best;
}

/** Pilot Review Board follow-up — combines "Merchant Intelligence Panel"
 * (times allocated, typical GL/VAT, confidence) and "Merchant
 * Management" (previous transactions, existing rules, defaults,
 * supplier/customer links) into one click-triggered panel, rather than
 * a separate hover tooltip plus a separate side panel — the same
 * information either way, one surface instead of two. Deliberately
 * page-scoped for "previously allocated N times" and "previous
 * transactions" (computed from the already-loaded `transactions` page,
 * labelled honestly as such) rather than a new company-wide historical
 * query — matches this redesign's established "This page" pattern
 * elsewhere (the live allocation-stats bar, the auto-fill suggestions).
 * "Option to merge merchant aliases" from the original ask is NOT
 * implemented here — that's a real write-capable merchant-management
 * feature (alias CRUD, conflict handling) that doesn't exist anywhere
 * in this codebase yet and is out of scope for this pass; existing
 * aliases are shown read-only. */
export function MerchantIntelligencePanel({
  companyId,
  transaction,
  transactions,
  merchants,
  onClose,
}: {
  companyId: string;
  transaction: BankTransactionRecord;
  transactions: BankTransactionRecord[];
  merchants: Merchant[];
  onClose: () => void;
}) {
  const [rules, setRules] = useState<BankingRule[] | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/companies/${companyId}/banking-rules`)
      .then((res) => (res.ok ? res.json() : { rules: [] }))
      .then((body) => {
        if (!cancelled) setRules(body.rules ?? []);
      })
      .catch(() => {
        if (!cancelled) setRules([]);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const beneficiary = transaction.beneficiary;

  const matches = useMemo(() => transactions.filter((t) => t.beneficiary === beneficiary), [transactions, beneficiary]);
  const allocated = useMemo(() => matches.filter((t) => t.allocationStatus === "Allocated" || t.allocationStatus === "Matched"), [matches]);
  const typicalGl = useMemo(() => mode(allocated.map((t) => t.suggestedGlAccount)), [allocated]);
  const typicalVat = useMemo(() => mode(allocated.map((t) => t.suggestedVatCode)), [allocated]);
  const confidenceScores = matches.map((t) => t.confidenceScore).filter((c): c is number => c !== null);
  const avgConfidence = confidenceScores.length > 0 ? Math.round(confidenceScores.reduce((sum, c) => sum + c, 0) / confidenceScores.length) : null;

  const merchantRecord = useMemo(
    () => merchants.find((m) => m.name.toLowerCase() === beneficiary.toLowerCase() || m.aliases.some((a) => a.toLowerCase() === beneficiary.toLowerCase())),
    [merchants, beneficiary],
  );

  const matchingRules = useMemo(() => {
    if (!rules) return null;
    const needle = beneficiary.toLowerCase();
    return rules.filter((r) => r.conditions.some((c) => c.field === "beneficiary" && needle.includes(c.value.toLowerCase())));
  }, [rules, beneficiary]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close merchant intelligence" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="merchant-intel-heading" className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-vf-paper p-6 shadow-2xl">
        <button type="button" onClick={onClose} className="mb-4 flex items-center gap-1 self-start text-sm text-vf-ink-faint hover:text-vf-ink">
          <IconChevronLeft className="h-4 w-4" />
          Close
        </button>

        <h2 id="merchant-intel-heading" className="text-lg font-semibold text-vf-ink">
          {beneficiary || "Unknown merchant"}
        </h2>
        <p className="mt-1 text-sm text-vf-ink-faint">Merchant intelligence — this page only, not the whole company history.</p>

        <div className="mt-4 grid grid-cols-2 gap-3 rounded-vf-md border border-vf-paper-border bg-vf-paper-alt p-3 text-sm">
          <div>
            <span className="block text-[11px] uppercase tracking-wide text-vf-ink-faint">Previously allocated</span>
            <span className="font-medium text-vf-ink">{allocated.length} time{allocated.length === 1 ? "" : "s"} on this page</span>
          </div>
          <div>
            <span className="block text-[11px] uppercase tracking-wide text-vf-ink-faint">Confidence</span>
            <span className="font-medium text-vf-ink">{avgConfidence !== null ? `${avgConfidence}%` : "—"}</span>
          </div>
          <div>
            <span className="block text-[11px] uppercase tracking-wide text-vf-ink-faint">Typical GL</span>
            <span className="font-medium text-vf-ink">{typicalGl ?? merchantRecord?.defaultGlAccount ?? "—"}</span>
          </div>
          <div>
            <span className="block text-[11px] uppercase tracking-wide text-vf-ink-faint">Typical VAT</span>
            <span className="font-medium text-vf-ink">{typicalVat ?? merchantRecord?.defaultVatCode ?? "—"}</span>
          </div>
        </div>

        {merchantRecord && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-vf-ink">Merchant record</h3>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm text-vf-ink-soft">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-vf-ink-faint">Default GL</dt>
                <dd>{merchantRecord.defaultGlAccount || "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-vf-ink-faint">Default VAT</dt>
                <dd>{merchantRecord.defaultVatCode || "—"}</dd>
              </div>
              {merchantRecord.aliases.length > 0 && (
                <div className="col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide text-vf-ink-faint">Known aliases</dt>
                  <dd className="flex flex-wrap gap-1.5 mt-1">
                    {merchantRecord.aliases.map((a) => (
                      <Badge key={a} tone="muted">{a}</Badge>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}

        <div className="mt-4">
          <h3 className="text-sm font-semibold text-vf-ink">Existing rules</h3>
          {matchingRules === null ? (
            <p className="mt-1 text-sm text-vf-ink-faint">Loading…</p>
          ) : matchingRules.length === 0 ? (
            <p className="mt-1 text-sm text-vf-ink-faint">No existing rule matches this merchant yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {matchingRules.map((r) => (
                <li key={r.id} className="rounded-vf-md border border-vf-paper-border p-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-vf-ink">{r.name}</span>
                    <Badge tone={r.isActive ? "good" : "muted"}>{r.isActive ? "Active" : "Disabled"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-vf-ink-faint">
                    {r.conditions.map((c) => `${c.field} ${c.operator} "${c.value}"`).join(" AND ")} → {r.actions.map((a) => a.actionType).join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-semibold text-vf-ink">Previous transactions (this page)</h3>
          {matches.length <= 1 ? (
            <p className="mt-1 text-sm text-vf-ink-faint">No other transactions from this merchant on the current page.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {matches
                .filter((t) => t.id !== transaction.id)
                .slice(0, 20)
                .map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-vf-ink-soft">{t.transactionDate ?? "—"}</span>
                    <span className="flex-1 truncate px-2 text-vf-ink-faint">{t.description || "—"}</span>
                    <span className="font-mono tabular-nums text-vf-ink">{money(t)}</span>
                    <Badge tone={t.allocationStatus === "Allocated" || t.allocationStatus === "Matched" ? "good" : "muted"}>{t.allocationStatus}</Badge>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

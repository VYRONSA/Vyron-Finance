"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { IconChevronLeft } from "@/components/ui/icons";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import type { BankTransactionRecord } from "@/server/accounting/types";
import type { BankingRule, Merchant } from "@/server/banking-rules/types";
import type { MerchantStats } from "@/server/services/transaction-explorer-service";
import { ModalPortal } from "@/components/ui/modal-portal";
import { formatAmount } from "@/lib/format";

function money(t: BankTransactionRecord): string {
  const amount = t.debit > 0 ? t.debit : t.credit;
  return formatAmount(amount);
}

/** Pilot Review Board follow-up — combines "Merchant Intelligence Panel"
 * (times allocated, typical GL/VAT, confidence) and "Merchant
 * Management" (previous transactions, existing rules, defaults,
 * supplier/customer links) into one click-triggered panel, rather than
 * a separate hover tooltip plus a separate side panel — the same
 * information either way, one surface instead of two.
 *
 * Master Implementation Tracker — Epic E2, Finding #089. The "times
 * allocated"/"typical GL/VAT"/confidence stats used to be computed only
 * from the currently loaded page (deliberately, and honestly labelled
 * as such, at the time) — now sourced from `getMerchantStats`, a real
 * company-wide query. "Option to merge merchant aliases" remains out of
 * scope — that's a real write-capable merchant-management feature (alias
 * CRUD, conflict handling) that doesn't exist anywhere in this codebase
 * yet; existing aliases are shown read-only. */
export function MerchantIntelligencePanel({
  companyId,
  transaction,
  merchants,
  onClose,
  previewMode,
}: {
  companyId: string;
  transaction: BankTransactionRecord;
  merchants: Merchant[];
  onClose: () => void;
  previewMode?: boolean;
}) {
  const [rules, setRules] = useState<BankingRule[] | null>(null);
  const [stats, setStats] = useState<MerchantStats | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, panelRef);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Phase 43 — production defect investigation found every fetch in this
  // panel used a `cancelled` boolean that only suppresses the resulting
  // `setState` after unmount; it never actually cancels the underlying
  // HTTP request, which keeps holding a real browser connection to the
  // origin until the server eventually responds. A real
  // `AbortController` closes the connection immediately on unmount —
  // one real fewer request left hanging every time this panel opens and
  // closes (repeatedly, potentially, per accountant session).
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/companies/${companyId}/banking-rules`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { rules: [] }))
      .then((body) => setRules(body.rules ?? []))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setRules([]);
      });
    return () => controller.abort();
  }, [companyId]);

  const beneficiary = transaction.beneficiary;

  useEffect(() => {
    if (previewMode) return;
    const controller = new AbortController();
    fetch(`/api/companies/${companyId}/transactions/merchant-stats?beneficiary=${encodeURIComponent(beneficiary)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setStats(body?.stats ?? null))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStats(null);
      });
    return () => controller.abort();
  }, [companyId, beneficiary, previewMode]);

  const allocated = stats?.allocatedCount ?? 0;
  const typicalGl = stats?.typicalGlAccount ?? null;
  const typicalVat = stats?.typicalVatCode ?? null;
  const avgConfidence = stats?.avgConfidence ?? null;
  const previousTransactions = stats?.previousTransactions ?? [];

  const merchantRecord = useMemo(
    () => merchants.find((m) => m.name.toLowerCase() === beneficiary.toLowerCase() || m.aliases.some((a) => a.toLowerCase() === beneficiary.toLowerCase())),
    [merchants, beneficiary],
  );

  const matchingRules = useMemo(() => {
    if (!rules) return null;
    const needle = beneficiary.toLowerCase();
    return rules.filter((r) => r.conditions.some((c) => c.field === "beneficiary" && needle.includes(c.value.toLowerCase())));
  }, [rules, beneficiary]);

  // Portaled to <body> so no hovered/transformed page ancestor (e.g. a
  // paper Card's hover lift) can become this fixed overlay's containing
  // block — see `ModalPortal`.
  return (
    <ModalPortal>
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close merchant intelligence" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="merchant-intel-heading" tabIndex={-1} className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-vf-paper p-6 shadow-2xl">
        <button type="button" onClick={onClose} className="mb-4 flex items-center gap-1 self-start text-sm text-vf-ink-faint hover:text-vf-ink">
          <IconChevronLeft className="h-4 w-4" />
          Close
        </button>

        <h2 id="merchant-intel-heading" className="text-lg font-semibold text-vf-ink">
          {beneficiary || "Unknown merchant"}
        </h2>
        <p className="mt-1 text-sm text-vf-ink-faint">Merchant intelligence — the whole company&rsquo;s history with this merchant.</p>

        <div className="mt-4 grid grid-cols-2 gap-3 rounded-vf-md border border-vf-paper-border bg-vf-paper-alt p-3 text-sm">
          <div>
            <span className="block text-[11px] uppercase tracking-wide text-vf-ink-faint">Previously allocated</span>
            <span className="font-medium text-vf-ink">{stats === null && !previewMode ? "Loading…" : `${allocated} time${allocated === 1 ? "" : "s"}`}</span>
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
          <h3 className="text-sm font-semibold text-vf-ink">Previous transactions</h3>
          {previousTransactions.length <= 1 ? (
            <p className="mt-1 text-sm text-vf-ink-faint">{stats === null && !previewMode ? "Loading…" : "No other transactions from this merchant."}</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {previousTransactions
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
    </ModalPortal>
  );
}

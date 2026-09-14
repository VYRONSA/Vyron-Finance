"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import type { AccountType, ChartOfAccount, NormalBalance } from "@/server/general-ledger/types";
import { ModalPortal } from "@/components/ui/modal-portal";

const ACCOUNT_TYPES: AccountType[] = ["Asset", "Liability", "Equity", "Income", "Cost of Sales", "Expense", "Other Income", "Other Expense"];
const NORMAL_BALANCES: NormalBalance[] = ["Debit", "Credit"];

/** Phase 26G — "+ Add General Ledger Account", reachable directly from
 * the Transaction Explorer's GL account combobox (Part L). Deliberately
 * NOT a second Chart of Accounts system: this posts to the exact same
 * `POST /api/companies/[companyId]/general-ledger/chart-of-accounts`
 * route (session/permission-checked via the existing `requireSession`/
 * `requirePermission(companyId, "GeneralLedger:Create")`) the standalone
 * Chart of Accounts page's own "Add Account" action would use — same
 * validation (`validateChartOfAccountInput`), same `unique(company_id,
 * account_code)` DB constraint, same master-data-only write (creates
 * exactly one `chart_of_accounts` row — never a journal, never touches
 * VAT, never touches any transaction, never allocates the transaction
 * the user was mid-way through when they opened this).
 *
 * Phase 44 — production defect: this used to call `router.refresh()` on
 * success to make the new account visible, which forced Transaction
 * Explorer's whole page (all 7 of its sequential server data loads, plus
 * a full reconcile of the entire, often hundreds-of-rows, transaction
 * grid) to reload just to add one row to a small master-data list — a
 * reproduced, confirmed cause of a browser-level "Page Unresponsive"
 * hang. `onCreated` now reports the created account straight to the
 * parent, which holds `chartOfAccounts` as local state and appends it
 * instantly — no page reload needed at all. */
export function AddGlAccountModal({
  companyId,
  initialAccountCode,
  onClose,
  onCreated,
}: {
  companyId: string;
  initialAccountCode: string;
  onClose: () => void;
  onCreated: (account: ChartOfAccount) => void;
}) {
  const [accountCode, setAccountCode] = useState(initialAccountCode);
  const [description, setDescription] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("Expense");
  const [normalBalance, setNormalBalance] = useState<NormalBalance>("Debit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, panelRef);

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/general-ledger/chart-of-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountCode, description, accountType, normalBalance }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      onCreated(body.account as ChartOfAccount);
      onClose();
    } catch {
      setError("Couldn't reach the API. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  // Portaled to <body> so no hovered/transformed page ancestor can become
  // this fixed overlay's containing block — see `ModalPortal`.
  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-gl-account-heading"
        tabIndex={-1}
        className="relative flex w-full max-w-md flex-col gap-4 rounded-vf-lg bg-vf-paper p-6 shadow-2xl"
      >
        <h2 id="add-gl-account-heading" className="text-lg font-semibold text-vf-ink">
          Add General Ledger Account
        </h2>
        <p className="text-sm text-vf-ink-faint">
          Creates a new account on this company&rsquo;s Chart of Accounts. It won&rsquo;t post a journal or allocate this transaction — pick it from the list afterwards.
        </p>

        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="new-gl-account-code" className="mb-1 block text-xs font-medium text-vf-ink-soft">
              Account Code
            </label>
            <Input id="new-gl-account-code" autoFocus value={accountCode} onChange={(e) => setAccountCode(e.target.value)} placeholder="e.g. 6950" />
          </div>
          <div>
            <label htmlFor="new-gl-account-description" className="mb-1 block text-xs font-medium text-vf-ink-soft">
              Description
            </label>
            <Input id="new-gl-account-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Marketing Materials" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-gl-account-type" className="mb-1 block text-xs font-medium text-vf-ink-soft">
                Account Type
              </label>
              <Select id="new-gl-account-type" value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="new-gl-account-balance" className="mb-1 block text-xs font-medium text-vf-ink-soft">
                Normal Balance
              </label>
              <Select id="new-gl-account-balance" value={normalBalance} onChange={(e) => setNormalBalance(e.target.value as NormalBalance)}>
                {NORMAL_BALANCES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-vf-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="subtle" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleCreate} disabled={saving || !accountCode.trim() || !description.trim()}>
            {saving ? "Creating…" : "Create Account"}
          </Button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

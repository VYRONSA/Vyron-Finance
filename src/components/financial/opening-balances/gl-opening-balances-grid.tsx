"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { BatchEntryGrid, type GridColumn } from "@/components/financial/shared/batch-entry-grid";
import type { OpeningBalanceEntry, OpeningBalanceGovernance } from "@/server/opening-balances/types";
import type { BankAccount } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

/**
 * Pilot Review Round 1 (Board revision) — "The Opening Balances Centre
 * must present the accountant with the entire Chart of Accounts in a
 * spreadsheet-style interface," not a sequence of individual forms. One
 * row per active GL account, Debit/Credit cells, Tab/Enter/Arrow-key
 * navigation and paste-from-Excel via the shared `BatchEntryGrid`
 * (`allowRowManagement={false}` — rows are the Chart of Accounts, not
 * user-managed). Saves through the bulk endpoint
 * (`opening-balance-service.ts::bulkUpsertGlOpeningBalances`), which
 * reuses the existing single-entry create/edit/delete functions
 * underneath — same validation, same governance gate, same audit trail.
 *
 * A bank account's own GL row writes a `BankAccount`-category entry
 * (syncs that account's cached balance on posting — see
 * `postOpeningBalances`); every other row writes a plain `GeneralLedger`
 * entry against its own code. The Debtors/Creditors control account rows
 * are a disclosed special case: editable here only when no individual
 * Customer/Supplier opening balances exist yet (captured on the
 * "Detailed Customer/Supplier Balances" section below this grid) —
 * otherwise shown read-only as the computed subsidiary total, since a
 * direct entry at the same GL code would double the posted balance
 * (both net to the same account — see `resolveAccountCode`). This
 * mirrors real accounting-package behaviour: a control account is either
 * entered as one lump sum OR built up from subsidiary detail, never both.
 */
type GridRow = {
  accountCode: string;
  accountDescription: string;
  bankAccountId: number | null;
  debit: number;
  credit: number;
  isPosted: boolean;
  isReadOnlyControl: string | null;
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildInitialRows(
  chartOfAccounts: ChartOfAccount[],
  bankAccounts: BankAccount[],
  entries: OpeningBalanceEntry[],
): GridRow[] {
  const bankAccountByGl = new Map(bankAccounts.filter((b) => b.glAccount?.trim()).map((b) => [b.glAccount!.trim(), b]));
  const debtorsSubsidiaryTotal = entries.filter((e) => e.category === "Customer" && e.status !== "posted").reduce((s, e) => s + e.amount, 0);
  const creditorsSubsidiaryTotal = entries.filter((e) => e.category === "Supplier" && e.status !== "posted").reduce((s, e) => s + e.amount, 0);
  const hasSubsidiaryDebtors = entries.some((e) => e.category === "Customer");
  const hasSubsidiaryCreditors = entries.some((e) => e.category === "Supplier");

  return chartOfAccounts
    .filter((a) => a.isActive)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode))
    .map((account) => {
      const bank = bankAccountByGl.get(account.accountCode);
      const isDebtorsControl = account.isControlAccount && account.description === "Debtors";
      const isCreditorsControl = account.isControlAccount && account.description === "Creditors";

      if (isDebtorsControl && hasSubsidiaryDebtors) {
        return rowFor(account, null, debtorsSubsidiaryTotal, false, "Captured via individual Customer opening balances below.");
      }
      if (isCreditorsControl && hasSubsidiaryCreditors) {
        return rowFor(account, null, creditorsSubsidiaryTotal, false, "Captured via individual Supplier opening balances below.");
      }

      const entry = bank
        ? entries.find((e) => e.category === "BankAccount" && e.bankAccountId === bank.id)
        : entries.find((e) => (e.category === "GeneralLedger" || e.category === "VATControl" || e.category === "Loan") && e.accountCode === account.accountCode);

      return rowFor(account, bank?.id ?? null, entry?.amount ?? 0, entry?.status === "posted", entry?.status === "posted" ? "Already posted to the General Ledger." : null);
    });
}

function rowFor(account: ChartOfAccount, bankAccountId: number | null, amount: number, isPosted: boolean, readOnlyReason: string | null): GridRow {
  return {
    accountCode: account.accountCode,
    accountDescription: account.description,
    bankAccountId,
    debit: amount > 0 ? amount : 0,
    credit: amount < 0 ? -amount : 0,
    isPosted,
    isReadOnlyControl: readOnlyReason,
  };
}

export function GlOpeningBalancesGrid({
  companyId,
  entries,
  governance,
  bankAccounts,
  chartOfAccounts,
}: {
  companyId: string;
  entries: OpeningBalanceEntry[];
  governance: OpeningBalanceGovernance;
  bankAccounts: BankAccount[];
  chartOfAccounts: ChartOfAccount[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<GridRow[]>(() => buildInitialRows(chartOfAccounts, bankAccounts, entries));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const isBalanced = Math.round((totalDebit - totalCredit) * 100) === 0;
  const enteredCount = rows.filter((r) => r.debit !== 0 || r.credit !== 0).length;

  const amountReadOnlyReason = (row: GridRow) => (row.isPosted ? "Already posted to the General Ledger." : row.isReadOnlyControl);

  const gridColumns = useMemo<GridColumn<GridRow>[]>(
    () => [
      { key: "accountCode", label: "GL Code", type: "text", width: "w-28", readOnlyReason: () => "Derived from the Chart of Accounts." },
      { key: "accountDescription", label: "Account Description", type: "text", readOnlyReason: () => "Derived from the Chart of Accounts." },
      { key: "debit", label: "Debit", type: "number", align: "right", width: "w-36", readOnlyReason: amountReadOnlyReason },
      { key: "credit", label: "Credit", type: "number", align: "right", width: "w-36", readOnlyReason: amountReadOnlyReason },
    ],
    [],
  );

  function updateRows(nextRows: GridRow[]) {
    // A row's own Debit/Credit cells are mutually exclusive — typing into
    // one clears the other, matching how a real trial-balance import
    // grid behaves (a single account balance is never both at once).
    setRows(
      nextRows.map((row, index) => {
        const prev = rows[index];
        if (!prev) return row;
        if (row.debit !== prev.debit && row.debit !== 0) return { ...row, credit: 0 };
        if (row.credit !== prev.credit && row.credit !== 0) return { ...row, debit: 0 };
        return row;
      }),
    );
  }

  async function handleSaveDraft() {
    setError(null);
    setNotice(null);
    if (governance.reasonRequired && !reason.trim()) {
      setError("A reason is required for opening balance changes after go-live.");
      return;
    }
    setLoading(true);
    try {
      const payload = rows
        .filter((r) => !r.isPosted && !r.isReadOnlyControl)
        .map((r) => ({
          accountCode: r.accountCode,
          bankAccountId: r.bankAccountId,
          amount: r.debit - r.credit,
          description: `Opening balance — ${r.accountDescription}`,
          reason: reason.trim(),
        }));

      const res = await fetch(`/api/companies/${companyId}/opening-balances/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload, reason: reason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        return;
      }
      const r = json.result;
      setNotice(`Saved — ${r.created} created, ${r.updated} updated, ${r.deleted} cleared${r.skipped.length ? `, ${r.skipped.length} skipped (see tooltips)` : ""}.`);
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePost() {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/opening-balances/post`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        return;
      }
      setNotice(`Posted ${json.result.entryCount} entries as journal ${json.result.journalNumber} (${money(json.result.totalDebit)} debit / ${money(json.result.totalCredit)} credit).`);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-vf-ink-faint uppercase">Accounts entered</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-vf-ink">
              {enteredCount} / {rows.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-vf-ink-faint uppercase">Total Debit</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-vf-ink">{money(totalDebit)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-vf-ink-faint uppercase">Total Credit</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-vf-ink">{money(totalCredit)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-medium text-vf-ink-faint uppercase">Balance status</p>
              <div className="mt-1.5">
                <Badge tone={isBalanced ? "good" : "warn"}>{isBalanced ? "Balanced" : "Out of balance"}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {governance.reasonRequired && (
        <Field label="Reason for this session's changes" htmlFor="ob-grid-reason" required>
          <Input id="ob-grid-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are these opening balances being captured/changed?" />
        </Field>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-vf-danger/25 bg-vf-danger/8 px-3.5 py-2.5 text-sm text-vf-danger">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-vf-success/25 bg-vf-success/8 px-3.5 py-2.5 text-sm text-[#1f6e4b]">{notice}</p>
      )}

      <BatchEntryGrid
        columns={gridColumns}
        rows={rows}
        onRowsChange={updateRows}
        createEmptyRow={() => ({ accountCode: "", accountDescription: "", bankAccountId: null, debit: 0, credit: 0, isPosted: false, isReadOnlyControl: null })}
        getRowId={(row) => row.accountCode}
        totals={[{ key: "debit", label: "Debit" }, { key: "credit", label: "Credit" }]}
        allowRowManagement={false}
        disabled={loading}
      />

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={handleSaveDraft}>
          Save as Draft
        </Button>
        <Button type="button" variant="primary" size="sm" disabled={loading || !isBalanced || enteredCount === 0} onClick={handlePost}>
          Post Opening Balances
        </Button>
        <p className="text-xs text-vf-ink-faint">Save at any point and return later — posting is only enabled once the journal balances.</p>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBanknote, IconShieldCheck } from "@/components/ui/icons";
import { OPENING_BALANCE_UI_CATEGORIES, type OpeningBalanceCategory, type OpeningBalanceEntry, type OpeningBalanceGovernance } from "@/server/opening-balances/types";
import type { BankAccount, Supplier } from "@/server/accounting/types";
import type { Customer } from "@/server/customer-management/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

const CATEGORY_LABELS: Record<OpeningBalanceCategory, string> = {
  GeneralLedger: "General Ledger",
  BankAccount: "Bank Account",
  Customer: "Customer (Debtor)",
  Supplier: "Supplier (Creditor)",
  Inventory: "Inventory",
  FixedAsset: "Fixed Asset",
  VATControl: "VAT Control",
  Loan: "Loans & Other Liabilities",
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function targetLabel(entry: OpeningBalanceEntry, bankAccounts: BankAccount[], customers: Customer[], suppliers: Supplier[], accounts: ChartOfAccount[]): string {
  if (entry.category === "BankAccount") return bankAccounts.find((a) => a.id === entry.bankAccountId)?.accountName ?? `Account #${entry.bankAccountId}`;
  if (entry.category === "Customer") return customers.find((c) => c.id === entry.customerId)?.name ?? `Customer #${entry.customerId}`;
  if (entry.category === "Supplier") return suppliers.find((s) => s.id === entry.supplierId)?.name ?? `Supplier #${entry.supplierId}`;
  const account = accounts.find((a) => a.accountCode === entry.accountCode);
  return account ? `${account.accountCode} — ${account.description}` : (entry.accountCode ?? "—");
}

export function OpeningBalancesCentre({
  companyId,
  entries,
  governance,
  bankAccounts,
  customers,
  suppliers,
  chartOfAccounts,
  previewMode,
}: {
  companyId: string;
  entries: OpeningBalanceEntry[];
  governance: OpeningBalanceGovernance;
  bankAccounts: BankAccount[];
  customers: Customer[];
  suppliers: Supplier[];
  chartOfAccounts: ChartOfAccount[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<OpeningBalanceCategory>("GeneralLedger");
  const [targetId, setTargetId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [postResult, setPostResult] = useState<string | null>(null);

  const draftEntries = entries.filter((e) => e.status === "draft");
  const totalDebit = draftEntries.reduce((sum, e) => sum + (e.amount > 0 ? e.amount : 0), 0);
  const totalCredit = draftEntries.reduce((sum, e) => sum + (e.amount < 0 ? -e.amount : 0), 0);
  const isBalanced = Math.round((totalDebit - totalCredit) * 100) === 0;

  const glAccountOptions = useMemo(() => {
    if (category === "VATControl") return chartOfAccounts.filter((a) => a.accountType === "Liability" || a.accountType === "Asset");
    if (category === "Loan") return chartOfAccounts.filter((a) => a.accountType === "Liability");
    return chartOfAccounts;
  }, [category, chartOfAccounts]);

  function resetForm() {
    setTargetId("");
    setDescription("");
    setAmount("");
    setReference("");
    setReason("");
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!description.trim()) return setError("Description is required.");
    const numericAmount = Number(amount);
    if (!amount || Number.isNaN(numericAmount)) return setError("Amount must be a number.");
    if ((category === "BankAccount" || category === "Customer" || category === "Supplier") && !targetId) {
      return setError(`Select a ${CATEGORY_LABELS[category].toLowerCase()}.`);
    }
    if ((category === "GeneralLedger" || category === "VATControl" || category === "Loan") && !targetId) {
      return setError("Select a GL account.");
    }
    if (governance.reasonRequired && !reason.trim()) return setError("A reason is required for opening balance changes after go-live.");

    setLoading(true);
    try {
      const body: Record<string, unknown> = { category, description: description.trim(), amount: numericAmount, reference: reference.trim(), reason: reason.trim() };
      if (category === "BankAccount") body.bankAccountId = Number(targetId);
      else if (category === "Customer") body.customerId = Number(targetId);
      else if (category === "Supplier") body.supplierId = Number(targetId);
      else body.accountCode = targetId;

      const res = await fetch(`/api/companies/${companyId}/opening-balances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        return;
      }
      resetForm();
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(entry: OpeningBalanceEntry) {
    let deleteReason = "";
    if (governance.reasonRequired) {
      deleteReason = window.prompt("This company has gone live. Enter a reason for removing this opening balance:") ?? "";
      if (!deleteReason.trim()) return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/opening-balances/${entry.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handlePost() {
    setError(null);
    setPostResult(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/opening-balances/post`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        return;
      }
      setPostResult(`Posted ${json.result.entryCount} entries as journal ${json.result.journalNumber} (${money(json.result.totalDebit)} debit / ${money(json.result.totalCredit)} credit).`);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {previewMode && (
        <p className="rounded-lg border border-vf-warning/25 bg-vf-warning/8 px-3.5 py-2.5 text-sm text-[#93601f]">
          No Supabase project is configured yet — this centre is fully functional but saving will fail until real
          credentials exist.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-vf-ink-faint uppercase">Draft entries</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-vf-ink">{draftEntries.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-vf-ink-faint uppercase">Total Debit / Credit</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-vf-ink">
              {money(totalDebit)} / {money(totalCredit)}
            </p>
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
            <Button variant="primary" size="sm" disabled={loading || draftEntries.length === 0 || !isBalanced} onClick={handlePost}>
              Post Opening Balances
            </Button>
          </CardContent>
        </Card>
      </div>

      {governance.requiresGovernance && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconShieldCheck className="h-3.5 w-3.5" />
          This company has gone live — every change requires the Manage Opening Balances permission, a reason, and is
          fully recorded in the audit trail.
        </p>
      )}

      {postResult && (
        <p className="rounded-lg border border-vf-success/25 bg-vf-success/8 px-3.5 py-2.5 text-sm text-[#1f6e4b]">{postResult}</p>
      )}

      <Card>
        <CardContent className="p-6">
          <p className="mb-4 text-sm font-semibold text-vf-ink">Add opening balance entry</p>
          <form onSubmit={handleAdd} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Category" htmlFor="ob-category">
                <Select
                  id="ob-category"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value as OpeningBalanceCategory);
                    setTargetId("");
                  }}
                >
                  {OPENING_BALANCE_UI_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Field>

              {category === "BankAccount" && (
                <Field label="Bank Account" htmlFor="ob-target">
                  <Select id="ob-target" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                    <option value="">Select…</option>
                    {bankAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountName}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {category === "Customer" && (
                <Field label="Customer" htmlFor="ob-target">
                  <Select id="ob-target" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                    <option value="">Select…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {category === "Supplier" && (
                <Field label="Supplier" htmlFor="ob-target">
                  <Select id="ob-target" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                    <option value="">Select…</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {(category === "GeneralLedger" || category === "VATControl" || category === "Loan") && (
                <Field label="GL Account" htmlFor="ob-target">
                  <Select id="ob-target" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                    <option value="">Select…</option>
                    {glAccountOptions.map((a) => (
                      <option key={a.accountCode} value={a.accountCode}>
                        {a.accountCode} — {a.description}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Description" htmlFor="ob-description">
                <Input id="ob-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Opening debtor balance" />
              </Field>
              <Field label="Amount (Dr positive, Cr negative)" htmlFor="ob-amount">
                <Input id="ob-amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="Reference" htmlFor="ob-reference">
                <Input id="ob-reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
              </Field>
            </div>

            {governance.reasonRequired && (
              <Field label="Reason" htmlFor="ob-reason" required>
                <Input id="ob-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being captured/changed?" />
              </Field>
            )}

            {error && (
              <p role="alert" className="rounded-lg border border-vf-danger/25 bg-vf-danger/8 px-3.5 py-2.5 text-sm text-vf-danger">
                {error}
              </p>
            )}

            <div>
              <Button type="submit" variant="primary" size="sm" disabled={loading}>
                Add Entry
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {entries.length === 0 ? (
        <EmptyState icon={<IconBanknote className="h-5 w-5" />} title="No opening balance entries yet" description="Add your first entry above — General Ledger, Bank Accounts, Customers, Suppliers, VAT Control, and Loans are all supported." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Category</TableHeadCell>
              <TableHeadCell>Target</TableHeadCell>
              <TableHeadCell>Description</TableHeadCell>
              <TableHeadCell className="text-right">Amount</TableHeadCell>
              <TableHeadCell>Reference</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell />
            </tr>
          </TableHead>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{CATEGORY_LABELS[entry.category]}</TableCell>
                <TableCell>{targetLabel(entry, bankAccounts, customers, suppliers, chartOfAccounts)}</TableCell>
                <TableCell>{entry.description}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(entry.amount)}</TableCell>
                <TableCell>{entry.reference || "—"}</TableCell>
                <TableCell>
                  <Badge tone={entry.status === "posted" ? "good" : "muted"}>{entry.status === "posted" ? "Posted" : "Draft"}</Badge>
                </TableCell>
                <TableCell>
                  {entry.status === "draft" && (
                    <Button variant="subtle" size="sm" disabled={loading} onClick={() => handleDelete(entry)}>
                      Remove
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

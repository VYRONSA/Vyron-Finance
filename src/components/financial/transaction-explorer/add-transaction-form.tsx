"use client";

/**
 * Phase 39 — "+ Add Transaction." Manual bank-transaction capture from
 * inside Transaction Explorer itself, without importing a statement.
 * Posts to the new `POST /api/companies/[companyId]/transactions` route,
 * which is backed by `createManualExplorerTransaction` — the SAME
 * `cashbookRepo.createManualTransaction` insert Cashbook's own receipt/
 * payment/transfer capture already uses (Phase 31C's immutable import
 * identity, `entry_source: "Manual"`), never a second manual-creation
 * path. Debit/Credit are mutually exclusive, matching every other
 * amount-entry form in this codebase — never silently coerced.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { glAccountOptions, supplierOptions } from "@/lib/account-picker-options";
import type { BankTransactionRecord, Supplier } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

type MinimalBankAccount = { id: number; accountName: string };
type MinimalCustomer = { id: number; name: string; customerCode: string };
type AllocateAs = "none" | "supplier" | "customer";

export function AddTransactionForm({
  companyId,
  bankAccounts,
  suppliers,
  customers,
  chartOfAccounts,
  previewMode,
  onCreated,
  onCancel,
}: {
  companyId: string;
  bankAccounts: MinimalBankAccount[];
  suppliers: Supplier[];
  customers: MinimalCustomer[];
  chartOfAccounts: ChartOfAccount[];
  previewMode: boolean;
  onCreated: (transaction: BankTransactionRecord) => void;
  onCancel: () => void;
}) {
  const [bankAccountId, setBankAccountId] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [debit, setDebit] = useState("");
  const [credit, setCredit] = useState("");
  const [balance, setBalance] = useState("");
  const [glAccount, setGlAccount] = useState<string | null>(null);
  const [vat, setVat] = useState("");
  const [notes, setNotes] = useState("");
  const [allocateAs, setAllocateAs] = useState<AllocateAs>("none");
  const [supplierId, setSupplierId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const glOptions = glAccountOptions(chartOfAccounts);
  const supplierOpts = supplierOptions(suppliers);

  function clientError(): string | null {
    if (!bankAccountId) return "Bank account is required.";
    if (!transactionDate) return "Transaction date is required.";
    if (!description.trim()) return "Description is required.";
    if (!beneficiary.trim()) return "Beneficiary is required.";
    const d = Number(debit) || 0;
    const c = Number(credit) || 0;
    if (d > 0 && c > 0) return "A transaction cannot have both a Debit and a Credit amount — enter one or the other.";
    if (d <= 0 && c <= 0) return "Enter either a Debit or a Credit amount.";
    return null;
  }

  async function submit() {
    const clientMessage = clientError();
    if (clientMessage) {
      setError(clientMessage);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankAccountId: Number(bankAccountId),
          transactionDate,
          reference,
          description,
          beneficiary,
          debit: Number(debit) || 0,
          credit: Number(credit) || 0,
          balance: balance.trim() === "" ? null : Number(balance),
          glAccount: glAccount ?? "",
          vat: Number(vat) || 0,
          notes,
          supplierId: allocateAs === "supplier" && supplierId ? Number(supplierId) : null,
          customerId: allocateAs === "customer" && customerId ? Number(customerId) : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      onCreated(body.transaction as BankTransactionRecord);
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-vf-danger">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-vf-ink">
          Bank Account
          <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">Choose a bank account…</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountName}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-vf-ink">
          Date
          <Input type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-vf-ink">
          Reference
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-vf-ink">
          Beneficiary
          <Input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm text-vf-ink">
          Description
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-vf-ink">
          Debit
          <Input type="number" step="0.01" value={debit} onChange={(e) => setDebit(e.target.value)} disabled={Number(credit) > 0} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-vf-ink">
          Credit
          <Input type="number" step="0.01" value={credit} onChange={(e) => setCredit(e.target.value)} disabled={Number(debit) > 0} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-vf-ink">
          Balance
          <Input type="number" step="0.01" placeholder="Optional" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-vf-ink">
          VAT
          <Input type="number" step="0.01" placeholder="Optional" value={vat} onChange={(e) => setVat(e.target.value)} />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm text-vf-ink">
          GL Account
          <Combobox
            value={glAccount}
            options={glOptions}
            placeholder="Optional — search by code or description"
            aria-label="GL account code"
            onCommit={(val) => setGlAccount(val)}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm text-vf-ink">
          Notes
          <textarea
            className="w-full rounded-lg border border-vf-paper-border bg-vf-paper px-4 py-2.75 text-sm text-vf-ink shadow-vf-paper-sm outline-none transition-[border-color,box-shadow] duration-150 ease-vf-out placeholder:text-vf-ink-faint focus:border-vf-red-500 focus:shadow-[0_0_0_3.5px_rgba(15,108,189,0.12)]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-vf-paper-border bg-vf-paper-alt/60 p-2.5">
        <span className="text-sm font-medium text-vf-ink">Allocate to (optional)</span>
        <div className="flex items-center gap-4 text-sm text-vf-ink-soft">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="allocate-as" checked={allocateAs === "none"} onChange={() => setAllocateAs("none")} />
            None
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="allocate-as" checked={allocateAs === "supplier"} onChange={() => setAllocateAs("supplier")} />
            Supplier
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="allocate-as" checked={allocateAs === "customer"} onChange={() => setAllocateAs("customer")} />
            Customer
          </label>
        </div>
        {allocateAs === "supplier" && (
          <Combobox
            value={supplierId ? Number(supplierId) : null}
            options={supplierOpts}
            placeholder="Choose a supplier…"
            aria-label="Supplier"
            onCommit={(val) => setSupplierId(val !== null ? String(val) : "")}
          />
        )}
        {allocateAs === "customer" && (
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Choose a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={submit} disabled={submitting || previewMode} title={previewMode ? "Available once a production Supabase project is connected" : undefined}>
          {submitting ? "Creating…" : "Create Transaction"}
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

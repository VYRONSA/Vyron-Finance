"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import type { BankAccount } from "@/server/accounting/types";

const CURRENCIES = ["ZAR", "USD", "GBP", "EUR"];

export function BankAccountForm({
  companyId,
  mode,
  account,
  previewMode,
  governance,
}: {
  companyId: string;
  mode: "create" | "edit";
  account?: BankAccount;
  previewMode: boolean;
  governance?: { requiresGovernance: boolean; reasonRequired: boolean };
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    accountNumber: account?.accountNumber ?? "",
    accountName: account?.accountName ?? "",
    bankName: account?.bankName ?? "",
    accountType: account?.accountType ?? "",
    branch: account?.branch ?? "",
    currency: account?.currency ?? "ZAR",
    openingBalance: account ? String(account.openingBalance) : "0",
    openingBalanceDate: account?.openingBalanceDate ?? "",
    openingBalanceReference: account?.openingBalanceReference ?? "",
    reason: "",
    notes: account?.notes ?? "",
    glAccount: account?.glAccount ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  const openingBalanceChanged = mode === "edit" && account && Number(values.openingBalance) !== account.openingBalance;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (mode === "create" && !values.accountNumber.trim()) next.accountNumber = "Account number is required.";
    if (!values.accountName.trim()) next.accountName = "Account name is required.";
    if (!values.bankName.trim()) next.bankName = "Bank name is required.";
    if (openingBalanceChanged && governance?.reasonRequired && !values.reason.trim()) {
      next.reason = "A reason is required to change an opening balance after go-live.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setSubmitError(null);
    try {
      const url =
        mode === "create"
          ? `/api/companies/${companyId}/bank-accounts`
          : `/api/companies/${companyId}/bank-accounts/${account!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const body =
        mode === "create"
          ? {
              accountNumber: values.accountNumber.trim(),
              accountName: values.accountName.trim(),
              bankName: values.bankName.trim(),
              accountType: values.accountType.trim(),
              branch: values.branch.trim(),
              currency: values.currency,
              openingBalance: Number(values.openingBalance) || 0,
            }
          : {
              accountName: values.accountName.trim(),
              bankName: values.bankName.trim(),
              accountType: values.accountType.trim(),
              branch: values.branch.trim(),
              currency: values.currency,
              notes: values.notes,
              glAccount: values.glAccount,
              ...(openingBalanceChanged && {
                openingBalance: Number(values.openingBalance) || 0,
                openingBalanceDate: values.openingBalanceDate || null,
                openingBalanceReference: values.openingBalanceReference.trim(),
                reason: values.reason.trim(),
              }),
            };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitError(json.error ?? `Request failed (${res.status})`);
        return;
      }

      const targetId = mode === "create" ? json.account.id : account!.id;
      router.push(`/company/${companyId}/bank-accounts/${targetId}`);
      router.refresh();
    } catch {
      setSubmitError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {previewMode && (
        <p className="rounded-lg border border-vf-warning/25 bg-vf-warning/8 px-3.5 py-2.5 text-sm text-[#93601f]">
          No Supabase project is configured yet — this form is fully functional but saving will fail
          until real credentials exist. See ARCHITECTURE.md.
        </p>
      )}

      <Field label="Account Number" htmlFor="accountNumber" required error={errors.accountNumber}>
        <Input
          id="accountNumber"
          value={values.accountNumber}
          onChange={(e) => set("accountNumber", e.target.value)}
          disabled={mode === "edit"}
          placeholder="62050837304"
        />
        {mode === "edit" && <p className="text-xs text-vf-ink-faint">Account number cannot be changed after creation.</p>}
      </Field>

      <Field label="Account Name" htmlFor="accountName" required error={errors.accountName}>
        <Input
          id="accountName"
          value={values.accountName}
          onChange={(e) => set("accountName", e.target.value)}
          placeholder="Main Trading Account"
        />
      </Field>

      <Field label="Bank Name" htmlFor="bankName" required error={errors.bankName}>
        <Input
          id="bankName"
          value={values.bankName}
          onChange={(e) => set("bankName", e.target.value)}
          placeholder="First National Bank"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Account Type" htmlFor="accountType">
          <Input
            id="accountType"
            value={values.accountType}
            onChange={(e) => set("accountType", e.target.value)}
            placeholder="Business Cheque"
          />
        </Field>
        <Field label="Branch Code" htmlFor="branch">
          <Input id="branch" value={values.branch} onChange={(e) => set("branch", e.target.value)} placeholder="250655" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Currency" htmlFor="currency">
          <Select id="currency" value={values.currency} onChange={(e) => set("currency", e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        {mode === "create" && (
          <Field label="Opening Balance" htmlFor="openingBalance">
            <Input
              id="openingBalance"
              type="number"
              step="0.01"
              value={values.openingBalance}
              onChange={(e) => set("openingBalance", e.target.value)}
            />
          </Field>
        )}
      </div>

      {mode === "edit" && (
        <>
          <div className="rounded-lg border border-vf-paper-border bg-vf-paper-alt p-4">
            <p className="mb-3 text-xs font-semibold tracking-wide text-vf-ink-faint uppercase">Opening Balance</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Opening Balance" htmlFor="openingBalance" error={errors.openingBalance}>
                <Input
                  id="openingBalance"
                  type="number"
                  step="0.01"
                  value={values.openingBalance}
                  onChange={(e) => set("openingBalance", e.target.value)}
                />
              </Field>
              <Field label="Opening Balance Date" htmlFor="openingBalanceDate">
                <Input
                  id="openingBalanceDate"
                  type="date"
                  value={values.openingBalanceDate}
                  onChange={(e) => set("openingBalanceDate", e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Opening Balance Reference" htmlFor="openingBalanceReference">
                <Input
                  id="openingBalanceReference"
                  value={values.openingBalanceReference}
                  onChange={(e) => set("openingBalanceReference", e.target.value)}
                  placeholder="e.g. Migration from previous system"
                />
              </Field>
            </div>
            {openingBalanceChanged && (
              <div className="mt-4">
                <Field
                  label="Reason for change"
                  htmlFor="reason"
                  required={governance?.reasonRequired}
                  error={errors.reason}
                >
                  <Input
                    id="reason"
                    value={values.reason}
                    onChange={(e) => set("reason", e.target.value)}
                    placeholder="Why is this opening balance being corrected?"
                  />
                </Field>
                {governance?.requiresGovernance && (
                  <p className="mt-1.5 text-xs text-vf-ink-faint">
                    This company has gone live — this change requires the Manage Opening Balances permission and is
                    recorded in the audit trail with your name, the reason, and the old and new values.
                  </p>
                )}
              </div>
            )}
          </div>

          <Field label="GL Account" htmlFor="glAccount">
            <Input
              id="glAccount"
              value={values.glAccount}
              onChange={(e) => set("glAccount", e.target.value)}
              placeholder="1000 — Bank Current Account"
            />
            <p className="text-xs text-vf-ink-faint">
              The control account Journal generation uses for this account&apos;s side of the entry. Falls back to a
              generated code if left blank.
            </p>
          </Field>
          <Field label="Notes" htmlFor="notes">
            <textarea
              id="notes"
              value={values.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-vf-paper-border bg-vf-paper px-3.5 py-2.5 text-vf-ink outline-none focus:border-vf-red-500"
            />
          </Field>
        </>
      )}

      {submitError && (
        <p role="alert" className="rounded-lg border border-vf-danger/25 bg-vf-danger/8 px-3.5 py-2.5 text-sm text-vf-danger">
          {submitError}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? "Saving…" : mode === "create" ? "Create Bank Account" : "Save Changes"}
        </Button>
        <Button type="button" variant="subtle" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

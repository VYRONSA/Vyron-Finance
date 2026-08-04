"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import type { BankTransactionRecord, Supplier } from "@/server/accounting/types";
import type { Merchant } from "@/server/banking-rules/types";

export type BulkActionId =
  | "assign-merchant"
  | "assign-supplier"
  | "assign-customer"
  | "assign-gl"
  | "assign-vat"
  | "apply-rule"
  | "create-rule"
  | "generate-journal"
  | "approve"
  | "reject"
  | "ignore"
  | "delete-import";

type MinimalCustomer = { id: number; name: string };

type InlineForm = "assign-supplier" | "assign-merchant" | "assign-customer" | "assign-gl" | "assign-vat" | "review-note" | null;

export function TransactionBulkActionBar({
  selected,
  suppliers,
  customers,
  merchants,
  onAssignSupplier,
  onAssignMerchant,
  onAssignCustomer,
  onAssignGl,
  onAssignVat,
  onReview,
  onGenerateJournal,
  onApplyRule,
  onCreateRule,
  onDeleteImport,
  loading,
  previewMode,
}: {
  selected: BankTransactionRecord[];
  suppliers: Supplier[];
  customers: MinimalCustomer[];
  merchants: Merchant[];
  onAssignSupplier: (supplierId: number) => void;
  onAssignMerchant: (merchantId: number) => void;
  onAssignCustomer: (customerId: number) => void;
  onAssignGl: (glAccount: string) => void;
  onAssignVat: (vatCode: string) => void;
  onReview: (status: "Approved" | "Rejected" | "Ignored", note: string) => void;
  onGenerateJournal: () => void;
  onApplyRule: () => void;
  onCreateRule: () => void;
  onDeleteImport: () => void;
  loading: boolean;
  previewMode: boolean;
}) {
  const [inlineForm, setInlineForm] = useState<InlineForm>(null);
  const [inputValue, setInputValue] = useState("");
  const [pendingReviewStatus, setPendingReviewStatus] = useState<"Approved" | "Rejected" | "Ignored" | null>(null);

  if (selected.length === 0) return null;

  const sameImportBatch = selected.every((t) => t.importBatch === selected[0].importBatch) && selected[0].importBatch;
  const canGenerateJournal = selected.every((t) => t.journalId === null && t.suggestedGlAccount);

  function closeInline() {
    setInlineForm(null);
    setInputValue("");
    setPendingReviewStatus(null);
  }

  function submitInline() {
    if (inlineForm === "assign-supplier") onAssignSupplier(Number(inputValue));
    else if (inlineForm === "assign-merchant") onAssignMerchant(Number(inputValue));
    else if (inlineForm === "assign-customer") onAssignCustomer(Number(inputValue));
    else if (inlineForm === "assign-gl") onAssignGl(inputValue);
    else if (inlineForm === "assign-vat") onAssignVat(inputValue);
    else if (inlineForm === "review-note" && pendingReviewStatus) onReview(pendingReviewStatus, inputValue);
    closeInline();
  }

  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const actionsDisabled = loading || previewMode;

  return (
    <div className="flex flex-col gap-3 rounded-vf-lg border border-vf-red-500/25 bg-vf-red-500/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-vf-ink">{selected.length} selected</span>

        <Button variant="subtle" size="sm" disabled={actionsDisabled} title={disabledTitle} onClick={() => setInlineForm("assign-merchant")}>
          Assign Merchant
        </Button>
        <Button variant="subtle" size="sm" disabled={actionsDisabled} title={disabledTitle} onClick={() => setInlineForm("assign-supplier")}>
          Assign Supplier
        </Button>
        <Button variant="subtle" size="sm" disabled={actionsDisabled} title={disabledTitle} onClick={() => setInlineForm("assign-customer")}>
          Assign Customer
        </Button>
        <Button variant="subtle" size="sm" disabled={actionsDisabled} title={disabledTitle} onClick={() => setInlineForm("assign-gl")}>
          Assign GL
        </Button>
        <Button variant="subtle" size="sm" disabled={actionsDisabled} title={disabledTitle} onClick={() => setInlineForm("assign-vat")}>
          Assign VAT
        </Button>
        <Button variant="subtle" size="sm" disabled={actionsDisabled} title={disabledTitle} onClick={onApplyRule}>
          Apply Rule
        </Button>
        <Button
          variant="subtle"
          size="sm"
          disabled={actionsDisabled || selected.length !== 1}
          title={disabledTitle ?? (selected.length !== 1 ? "Select exactly one transaction to create a rule from it." : undefined)}
          onClick={onCreateRule}
        >
          Create Rule
        </Button>
        <Button
          variant="subtle"
          size="sm"
          disabled={actionsDisabled || !canGenerateJournal}
          title={disabledTitle ?? (!canGenerateJournal ? "Every selected transaction needs a GL account assigned and no existing journal." : undefined)}
          onClick={onGenerateJournal}
        >
          Generate Journal
        </Button>
        <Button
          variant="subtle"
          size="sm"
          disabled={actionsDisabled}
          title={disabledTitle}
          onClick={() => {
            setPendingReviewStatus("Approved");
            setInlineForm("review-note");
          }}
        >
          Approve
        </Button>
        <Button
          variant="subtle"
          size="sm"
          disabled={actionsDisabled}
          title={disabledTitle}
          onClick={() => {
            setPendingReviewStatus("Rejected");
            setInlineForm("review-note");
          }}
        >
          Reject
        </Button>
        <Button
          variant="subtle"
          size="sm"
          disabled={actionsDisabled}
          title={disabledTitle}
          onClick={() => {
            setPendingReviewStatus("Ignored");
            setInlineForm("review-note");
          }}
        >
          Ignore
        </Button>
        <Button
          variant="subtle"
          size="sm"
          disabled={actionsDisabled || !sameImportBatch}
          title={disabledTitle ?? (!sameImportBatch ? "Select transactions from a single import to delete it." : undefined)}
          onClick={onDeleteImport}
          className="text-vf-danger"
        >
          Delete Import
        </Button>
      </div>

      {inlineForm === "assign-supplier" && (
        <div className="flex items-center gap-2">
          <Select autoFocus className="max-w-xs" value={inputValue} onChange={(e) => setInputValue(e.target.value)}>
            <option value="">Choose a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Button variant="primary" size="sm" onClick={submitInline} disabled={!inputValue}>
            Confirm
          </Button>
          <Button variant="subtle" size="sm" onClick={closeInline}>
            Cancel
          </Button>
        </div>
      )}

      {inlineForm === "assign-merchant" && (
        <div className="flex items-center gap-2">
          <Select autoFocus className="max-w-xs" value={inputValue} onChange={(e) => setInputValue(e.target.value)}>
            <option value="">Choose a merchant…</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Button variant="primary" size="sm" onClick={submitInline} disabled={!inputValue}>
            Confirm
          </Button>
          <Button variant="subtle" size="sm" onClick={closeInline}>
            Cancel
          </Button>
        </div>
      )}

      {inlineForm === "assign-customer" && (
        <div className="flex items-center gap-2">
          <Select autoFocus className="max-w-xs" value={inputValue} onChange={(e) => setInputValue(e.target.value)}>
            <option value="">Choose a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Button variant="primary" size="sm" onClick={submitInline} disabled={!inputValue}>
            Confirm
          </Button>
          <Button variant="subtle" size="sm" onClick={closeInline}>
            Cancel
          </Button>
        </div>
      )}

      {(inlineForm === "assign-gl" || inlineForm === "assign-vat") && (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            className="max-w-xs"
            placeholder={inlineForm === "assign-gl" ? "GL account code" : "VAT treatment"}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <Button variant="primary" size="sm" onClick={submitInline} disabled={!inputValue.trim()}>
            Confirm
          </Button>
          <Button variant="subtle" size="sm" onClick={closeInline}>
            Cancel
          </Button>
        </div>
      )}

      {inlineForm === "review-note" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-vf-ink-soft">{pendingReviewStatus} — optional note:</span>
          <Input autoFocus className="max-w-xs" placeholder="Note" value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
          <Button variant="primary" size="sm" onClick={submitInline}>
            Confirm
          </Button>
          <Button variant="subtle" size="sm" onClick={closeInline}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

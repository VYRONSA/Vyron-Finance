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
  | "generate-journal"
  | "approve"
  | "reject"
  | "ignore"
  | "delete-import";

/** Pilot Review Round 1, Phase 5 — "Provide ☐ Create Banking Rule" while
 * allocating, instead of a separate "Create Rule" button that just
 * navigated away to the Banking Rules page (removed). Match Type maps
 * onto `ConditionOperator` (`rule-engine.ts`) except "Multiple Keywords",
 * which has no native OR-of-conditions support in the engine (a rule is
 * AND-of-conditions) — reusing the existing `regex` operator with a
 * `keyword1|keyword2` alternation is a disclosed, minimal-footprint way
 * to support it without redesigning the condition engine. */
export type MatchType = "contains" | "starts_with" | "ends_with" | "exact" | "multiple_keywords";
export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  contains: "Contains",
  starts_with: "Starts With",
  ends_with: "Ends With",
  exact: "Exact Match",
  multiple_keywords: "Multiple Keywords",
};

export type RuleCreationOptions = {
  matchDescription: string;
  matchType: MatchType;
  applyToRemaining: boolean;
  applyToFutureImports: boolean;
};

type MinimalCustomer = { id: number; name: string };

type InlineForm = "assign-supplier" | "assign-merchant" | "assign-customer" | "assign-gl" | "assign-vat" | "review-note" | null;

function CreateRulePanel({
  transaction,
  options,
  onChange,
}: {
  transaction: BankTransactionRecord;
  options: RuleCreationOptions | null;
  onChange: (next: RuleCreationOptions | null) => void;
}) {
  const checked = options !== null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-vf-paper-border bg-vf-paper-alt/60 p-2.5">
      <label className="flex items-center gap-2 text-sm text-vf-ink">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked ? { matchDescription: transaction.beneficiary, matchType: "contains", applyToRemaining: true, applyToFutureImports: true } : null)}
        />
        Create Banking Rule
      </label>
      {options && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <Input
            className="max-w-[220px]"
            placeholder="Match description"
            value={options.matchDescription}
            onChange={(e) => onChange({ ...options, matchDescription: e.target.value })}
          />
          <Select className="max-w-[160px]" value={options.matchType} onChange={(e) => onChange({ ...options, matchType: e.target.value as MatchType })}>
            {(Object.keys(MATCH_TYPE_LABELS) as MatchType[]).map((mt) => (
              <option key={mt} value={mt}>
                {MATCH_TYPE_LABELS[mt]}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-vf-ink-soft">
            <input type="checkbox" checked={options.applyToRemaining} onChange={(e) => onChange({ ...options, applyToRemaining: e.target.checked })} />
            Apply to Remaining Transactions
          </label>
          <label className="flex items-center gap-1.5 text-xs text-vf-ink-soft">
            <input type="checkbox" checked={options.applyToFutureImports} onChange={(e) => onChange({ ...options, applyToFutureImports: e.target.checked })} />
            Apply to Future Imports
          </label>
        </div>
      )}
    </div>
  );
}

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
  onDeleteImport,
  loading,
  previewMode,
}: {
  selected: BankTransactionRecord[];
  suppliers: Supplier[];
  customers: MinimalCustomer[];
  merchants: Merchant[];
  onAssignSupplier: (supplierId: number, ruleOptions: RuleCreationOptions | null) => void;
  onAssignMerchant: (merchantId: number) => void;
  onAssignCustomer: (customerId: number, ruleOptions: RuleCreationOptions | null) => void;
  onAssignGl: (glAccount: string, ruleOptions: RuleCreationOptions | null) => void;
  onAssignVat: (vatCode: string) => void;
  onReview: (status: "Approved" | "Rejected" | "Ignored", note: string) => void;
  onGenerateJournal: () => void;
  onApplyRule: () => void;
  onDeleteImport: () => void;
  loading: boolean;
  previewMode: boolean;
}) {
  const [inlineForm, setInlineForm] = useState<InlineForm>(null);
  const [inputValue, setInputValue] = useState("");
  const [pendingReviewStatus, setPendingReviewStatus] = useState<"Approved" | "Rejected" | "Ignored" | null>(null);
  const [ruleOptions, setRuleOptions] = useState<RuleCreationOptions | null>(null);

  if (selected.length === 0) return null;

  const sameImportBatch = selected.every((t) => t.importBatch === selected[0].importBatch) && selected[0].importBatch;
  const canGenerateJournal = selected.every((t) => t.journalId === null && t.suggestedGlAccount);
  const canCreateRule = selected.length === 1;

  function closeInline() {
    setInlineForm(null);
    setInputValue("");
    setPendingReviewStatus(null);
    setRuleOptions(null);
  }

  function submitInline() {
    if (inlineForm === "assign-supplier") onAssignSupplier(Number(inputValue), ruleOptions);
    else if (inlineForm === "assign-merchant") onAssignMerchant(Number(inputValue));
    else if (inlineForm === "assign-customer") onAssignCustomer(Number(inputValue), ruleOptions);
    else if (inlineForm === "assign-gl") onAssignGl(inputValue, ruleOptions);
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
        <div className="flex flex-col gap-2">
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
          {canCreateRule && <CreateRulePanel transaction={selected[0]} options={ruleOptions} onChange={setRuleOptions} />}
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
        <div className="flex flex-col gap-2">
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
          {canCreateRule && <CreateRulePanel transaction={selected[0]} options={ruleOptions} onChange={setRuleOptions} />}
        </div>
      )}

      {inlineForm === "assign-gl" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input autoFocus className="max-w-xs" placeholder="GL account code" value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
            <Button variant="primary" size="sm" onClick={submitInline} disabled={!inputValue.trim()}>
              Confirm
            </Button>
            <Button variant="subtle" size="sm" onClick={closeInline}>
              Cancel
            </Button>
          </div>
          {canCreateRule && <CreateRulePanel transaction={selected[0]} options={ruleOptions} onChange={setRuleOptions} />}
        </div>
      )}

      {inlineForm === "assign-vat" && (
        <div className="flex items-center gap-2">
          <Input autoFocus className="max-w-xs" placeholder="VAT treatment" value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
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

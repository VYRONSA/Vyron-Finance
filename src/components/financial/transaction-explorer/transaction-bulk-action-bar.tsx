"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmActionRow, useConfirmTarget } from "@/components/ui/confirm-action";
import { glAccountOptions, vatCodeOptions } from "@/lib/account-picker-options";
import type { BankTransactionRecord, Supplier } from "@/server/accounting/types";
import type { Merchant } from "@/server/banking-rules/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatTreatment } from "@/server/company-management/types";
import { isEligibleForAiClassification } from "@/server/ai/transaction-classification/types";
import { PostToAccountingPanel } from "./post-to-accounting-panel";
import type { BulkSaveSummary } from "./transaction-grid";

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
  | "delete-import"
  | "delete";

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

/** Phase 31B — which transaction field a new rule's condition actually
 * compares against. Both values already exist in the rule engine's own
 * `CONDITION_FIELDS` vocabulary (`banking-rules/types.ts`) and the full
 * Banking Rules page already lets an accountant pick "description" there
 * today — this only brings the inline Set Rule flow in line with a
 * capability that already existed, never a new one. Kept to these two
 * (not the full `CONDITION_FIELDS` list, which also has amount/debit/
 * credit — irrelevant to a text search box) since they're the only two
 * meaningful "narration" fields for this workflow. */
export type RuleMatchField = "description" | "beneficiary";

export type RuleCreationOptions = {
  matchField: RuleMatchField;
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
          onChange={(e) =>
            onChange(
              e.target.checked
                ? // Phase 51 — production defect: `applyToRemaining` used to
                  // default to true here too, silently sweeping the whole
                  // company the moment a rule was created — see the Phase 50
                  // forensic report and `transaction-explorer.tsx`'s
                  // `createRuleFromAllocation` doc comment.
                  { matchField: "beneficiary", matchDescription: transaction.beneficiary, matchType: "contains", applyToRemaining: false, applyToFutureImports: true }
                : null,
            )
          }
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
  chartOfAccounts,
  vatTreatments,
  onAssignSupplier,
  onAssignMerchant,
  onAssignCustomer,
  onAssignGl,
  onAssignVat,
  onReview,
  onGenerateJournal,
  onApplyRule,
  onDeleteImport,
  onDeleteTransactions,
  onClassifyWithAi,
  onSaveSelected,
  saveSelectedDirtyCount,
  savingSelected,
  pendingAllocationIds,
  onCommitPendingAllocations,
  summarizeSave,
  loading,
  previewMode,
  companyId,
  onPosted,
}: {
  selected: BankTransactionRecord[];
  suppliers: Supplier[];
  customers: MinimalCustomer[];
  merchants: Merchant[];
  chartOfAccounts: ChartOfAccount[];
  vatTreatments: VatTreatment[];
  onAssignSupplier: (supplierId: number, ruleOptions: RuleCreationOptions | null) => void;
  onAssignMerchant: (merchantId: number) => void;
  onAssignCustomer: (customerId: number, ruleOptions: RuleCreationOptions | null) => void;
  onAssignGl: (glAccount: string, ruleOptions: RuleCreationOptions | null) => void;
  onAssignVat: (vatCode: string) => void;
  onReview: (status: "Approved" | "Rejected" | "Ignored", note: string) => void;
  onGenerateJournal: () => void;
  onApplyRule: () => void;
  onDeleteImport: () => void;
  /** Phase 39 — deletes only the SELECTED transactions (never "the whole
   * import," unlike Delete Import above). The server independently
   * enforces that a posted transaction can never be deleted regardless
   * of what's selected — this confirmation is a UX safeguard, not the
   * actual protection boundary. */
  onDeleteTransactions: () => void;
  /** Phase 22B — fires with every selected id; the server (not this
   * component) re-validates eligibility/feature/usage and reports which
   * ones were actually skipped and why. */
  onClassifyWithAi: () => void;
  /** Phase 31 — "Save Selected." Persists the pending inline-grid edits
   * (Type/Account/VAT/Notes/Set Rule) on every SELECTED row that
   * actually has one — never all selected rows, never rows outside the
   * selection. `saveSelectedDirtyCount` (computed by the parent from the
   * grid's own dirty-edit state) is what the button's enabled state and
   * label are driven by, not `selected.length`. */
  onSaveSelected: () => void;
  saveSelectedDirtyCount: number;
  savingSelected: boolean;
  loading: boolean;
  previewMode: boolean;
  /** Bank Accounting Posting — the Explorer's company scope, needed for
   * the posting endpoint, and its refetch, since posting changes a
   * transaction's status, journal link and posting batch. */
  companyId: string;
  onPosted: () => void | Promise<void>;
  /** Rows with an unsaved allocation edit, and the commit that writes
   * them. "Post to Accounting" saves before it posts, so the accountant
   * does not press two buttons for one intention — see the panel's own
   * doc comment. */
  pendingAllocationIds: Set<number>;
  onCommitPendingAllocations: () => Promise<BulkSaveSummary | null>;
  summarizeSave: (summary: BulkSaveSummary) => string;
}) {
  const [inlineForm, setInlineForm] = useState<InlineForm>(null);
  const [inputValue, setInputValue] = useState("");
  const [pendingReviewStatus, setPendingReviewStatus] = useState<"Approved" | "Rejected" | "Ignored" | null>(null);
  const [ruleOptions, setRuleOptions] = useState<RuleCreationOptions | null>(null);
  // Master Implementation Tracker — Epic E11, Finding #003. Delete Import
  // used to fire immediately on click with no confirmation, for an action
  // that deletes every transaction in a batch. See also #004 (server-side
  // journaled-status guard) in `deleteImport`/`countJournaledInBatch`.
  const confirmDeleteImport = useConfirmTarget<true>();
  // Phase 39 — Delete Transaction. A distinct confirm target from Delete
  // Import above: this deletes only the selection, and "Cancel" here must
  // fully close (never step back into a second confirm), same as every
  // other single-step `ConfirmActionRow` in this codebase.
  const confirmDeleteTransactions = useConfirmTarget<true>();
  // Master Implementation Tracker — Programme 2, Root Cause RC-7,
  // Finding #026. Assign GL/Assign VAT used to be plain free-text
  // inputs with no existence validation — the same `Combobox` primitive
  // Transaction Explorer's own grid cells already use.
  const glOptions = useMemo(() => glAccountOptions(chartOfAccounts), [chartOfAccounts]);
  const vatOptions = useMemo(() => vatCodeOptions(vatTreatments), [vatTreatments]);

  if (selected.length === 0) return null;

  const sameImportBatch = selected.every((t) => t.importBatch === selected[0].importBatch) && selected[0].importBatch;
  const canGenerateJournal = selected.every((t) => t.journalId === null && t.suggestedGlAccount);
  const canCreateRule = selected.length === 1;
  // Phase 22B — the SAME shared eligibility check the server uses (never
  // a second, client-only definition of "eligible"). The server always
  // re-validates regardless — this only drives the button's enabled
  // state/label, never a security boundary.
  const eligibleForAiCount = selected.filter(isEligibleForAiClassification).length;

  // Master Implementation Tracker — Programme 2, Epic E2, Finding #146.
  // One generic message previously covered two entirely different
  // failure modes (already-journaled vs. no-GL-account) — the user
  // couldn't tell which applied, or how many transactions were affected.
  function generateJournalDisabledReason(): string | undefined {
    if (canGenerateJournal) return undefined;
    const alreadyJournaled = selected.filter((t) => t.journalId !== null).length;
    const missingGl = selected.filter((t) => !t.suggestedGlAccount).length;
    const reasons: string[] = [];
    if (alreadyJournaled > 0) reasons.push(`${alreadyJournaled} transaction${alreadyJournaled === 1 ? "" : "s"} already journaled`);
    if (missingGl > 0) reasons.push(`${missingGl} transaction${missingGl === 1 ? "" : "s"} missing a GL account`);
    return reasons.length > 0 ? reasons.join("; ") : "Every selected transaction needs a GL account assigned and no existing journal.";
  }

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

        {/* Phase 31 — "Save Selected." Placed first and given the primary
         * (not subtle) button style: for a grid whose whole workflow is
         * select-many/edit-many, this is the one action that actually
         * commits those edits, not just another allocation shortcut. */}
        <Button
          variant="primary"
          size="sm"
          disabled={actionsDisabled || savingSelected || saveSelectedDirtyCount === 0}
          title={disabledTitle ?? (saveSelectedDirtyCount === 0 ? "No changes to save in the current selection." : `Save ${saveSelectedDirtyCount} changed transaction${saveSelectedDirtyCount === 1 ? "" : "s"}`)}
          onClick={onSaveSelected}
        >
          {savingSelected ? `Saving ${saveSelectedDirtyCount}…` : saveSelectedDirtyCount > 0 ? `Save Selected (${saveSelectedDirtyCount})` : "Save Selected"}
        </Button>

        {/* Bank Accounting Posting — the step that takes a processed
         * transaction into the General Ledger. Sits next to "Save
         * Selected" because these are the two actions that commit
         * something; everything to their right only classifies. It is
         * deliberately a separate action from "Generate Journal": that
         * one creates a Draft journal for the manual approval workflow,
         * this one posts to the ledger. */}
        <PostToAccountingPanel
          companyId={companyId}
          selected={selected}
          disabled={actionsDisabled}
          disabledTitle={disabledTitle}
          onPosted={onPosted}
          pendingAllocationIds={pendingAllocationIds}
          onCommitPendingAllocations={onCommitPendingAllocations}
          summarizeSave={summarizeSave}
        />

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
          disabled={actionsDisabled || eligibleForAiCount === 0}
          title={disabledTitle ?? (eligibleForAiCount === 0 ? "No selected transactions are eligible for AI classification (already classified, allocated, or matched)." : undefined)}
          onClick={onClassifyWithAi}
        >
          Classify with AI{eligibleForAiCount > 0 && eligibleForAiCount < selected.length ? ` (${eligibleForAiCount})` : ""}
        </Button>
        <Button
          variant="subtle"
          size="sm"
          disabled={actionsDisabled || !canGenerateJournal}
          title={disabledTitle ?? generateJournalDisabledReason()}
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
          disabled={actionsDisabled}
          title={disabledTitle}
          onClick={() => confirmDeleteTransactions.request(true)}
          className="text-vf-danger"
        >
          {selected.length === 1 ? "Delete" : "Delete Selected"}
        </Button>
        <Button
          variant="subtle"
          size="sm"
          disabled={actionsDisabled || !sameImportBatch}
          title={disabledTitle ?? (!sameImportBatch ? "Select transactions from a single import to delete it." : undefined)}
          onClick={() => confirmDeleteImport.request(true)}
          className="text-vf-danger"
        >
          Delete Import
        </Button>
      </div>

      {confirmDeleteImport.isConfirming(true) && (
        <ConfirmActionRow
          layout="panel"
          tone="danger"
          message={`Delete this entire import batch (${selected.length} transaction${selected.length === 1 ? "" : "s"})? This cannot be undone.`}
          loading={loading}
          confirmingLabel="Deleting…"
          onConfirm={() => {
            onDeleteImport();
            confirmDeleteImport.cancel();
          }}
          onCancel={confirmDeleteImport.cancel}
        />
      )}

      {confirmDeleteTransactions.isConfirming(true) && (
        <ConfirmActionRow
          layout="panel"
          tone="danger"
          message={
            <>
              {selected.length === 1 ? "Delete this transaction?" : `Delete ${selected.length} transactions?`}
              <br />
              These transactions will be permanently removed.
            </>
          }
          confirmLabel="Delete Transactions"
          loading={loading}
          confirmingLabel="Deleting…"
          onConfirm={() => {
            onDeleteTransactions();
            confirmDeleteTransactions.cancel();
          }}
          onCancel={confirmDeleteTransactions.cancel}
        />
      )}

      {inlineForm === "assign-supplier" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Select autoFocus className="max-w-xs" value={inputValue} onChange={(e) => setInputValue(e.target.value)}>
              <option value="">Choose a supplier…</option>
              {/* Phase 38 — Inactive suppliers (e.g. deactivated merge
               * duplicates) must never be assignable to a new transaction. */}
              {suppliers.filter((s) => s.status === "Active").map((s) => (
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
            <Combobox
              autoFocus
              className="max-w-xs"
              value={inputValue || null}
              options={glOptions}
              placeholder="GL account code"
              aria-label="GL account code"
              onCommit={(val) => setInputValue(val ?? "")}
            />
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
          <Combobox
            autoFocus
            className="max-w-xs"
            value={inputValue || null}
            options={vatOptions}
            placeholder="VAT treatment"
            aria-label="VAT treatment"
            onCommit={(val) => setInputValue(val ?? "")}
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

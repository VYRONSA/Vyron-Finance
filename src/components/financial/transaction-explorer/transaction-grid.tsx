"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnSizingState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { BankTransactionRecord, Supplier } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatTreatment } from "@/server/company-management/types";
import { REQUIRED_ACTION_DUPLICATE_PAYMENT } from "@/server/accounting/matching-engine";
import type { RuleCreationOptions } from "./transaction-bulk-action-bar";

type MatchStatusTone = "good" | "warn" | "info" | "danger" | "muted" | "critical";

// Pilot Review Board follow-up — "the accountant should instantly see
// the status": one badge per row combining every signal that currently
// exists into a single, precedence-ordered colour, rather than the
// pre-existing badge that only ever showed the Matching/Allocation
// Engine's own four-value status. Precedence (most attention-worthy
// first) is a judgment call, documented here rather than left implicit:
// a row that can't be saved (Invalid) always wins; a flagged possible
// duplicate payment is the next most consequential; an explicit
// required-action (Needs Review) outranks the merely informational fact
// that a rule already fired; Suggested/Allocated/Matched are the
// resting states, in that order.
export function computeMatchStatus(
  t: BankTransactionRecord,
  touched: boolean,
  invalid: boolean,
): { label: string; tone: MatchStatusTone } {
  if (touched && invalid) return { label: "Invalid", tone: "danger" };
  if (t.requiredAction === REQUIRED_ACTION_DUPLICATE_PAYMENT) return { label: "Duplicate", tone: "muted" };
  if (t.requiredAction) return { label: "Needs Review", tone: "critical" };
  if (t.ruleId !== null || t.rulesTriggered.length > 0) return { label: "Rule Created", tone: "info" };
  if (t.allocationStatus === "Matched") return { label: "Matched", tone: "good" };
  if (t.allocationStatus === "Suggested") return { label: "Suggested", tone: "warn" };
  if (t.allocationStatus === "Allocated") return { label: "Allocated", tone: "good" };
  return { label: "Unallocated", tone: "muted" };
}

function money(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type MinimalCustomer = { id: number; name: string; customerCode: string };

// ---------------------------------------------------------------------
// Bank Transaction Allocation Workspace (Transaction Explorer Redesign,
// Phase 1) — the pending-edit model behind the six new inline-editable
// columns (Type/Account Code/Account Description/VAT Code/Notes/Set
// Rule). Each row's in-progress edit lives in a `Map<transactionId, ...>`
// in `TransactionGrid` below, not on the transaction itself — the row is
// only ever written to the server when focus actually leaves it (blur
// bubbling from the row's `<tr>`, see `handleRowBlur`) or the accountant
// explicitly moves on via Arrow Down/Enter, never on every keystroke and
// never behind a separate manual "Save" button/screen.
// ---------------------------------------------------------------------

export type PendingRowEdit = {
  type: "G" | "C" | "S";
  accountCode: string;
  supplierId: number | null;
  customerId: number | null;
  vatCode: string;
  allocationNotes: string;
  setRule: boolean;
};

export type AllocateRowPayload = {
  type: "G" | "C" | "S";
  accountCode: string | null;
  supplierId: number | null;
  customerId: number | null;
  vatCode: string | null;
  allocationNotes: string;
};

/** Shared between the actual rule-creation call (`transaction-explorer.tsx`)
 * and this grid's own duplicate-rule pre-check (`onCheckDuplicateRule`) —
 * both MUST build the identical action set, or the check would compare
 * against a different rule than the one that actually gets created.
 * Pilot Review Board follow-up — "Set Rule" now also captures the VAT
 * code as a second action, not just the primary GL/Customer/Supplier
 * target. */
export function ruleTypeFor(type: "G" | "C" | "S"): "GL" | "Customer" | "Supplier" {
  return type === "G" ? "GL" : type === "C" ? "Customer" : "Supplier";
}

export function ruleActionsFor(input: AllocateRowPayload): { actionType: string; targetId?: number; targetText?: string }[] {
  const primary =
    input.type === "G"
      ? { actionType: "set_gl_account", targetText: input.accountCode ?? "" }
      : input.type === "S"
        ? { actionType: "set_supplier", targetId: input.supplierId ?? undefined }
        : { actionType: "set_customer", targetId: input.customerId ?? undefined };
  return input.vatCode ? [primary, { actionType: "set_vat_code", targetText: input.vatCode }] : [primary];
}

function initialEdit(t: BankTransactionRecord): PendingRowEdit {
  const type: "G" | "C" | "S" = t.allocationType ?? (t.matchedSupplierId !== null ? "S" : t.matchedCustomerId !== null ? "C" : "G");
  return {
    type,
    accountCode: t.suggestedGlAccount ?? "",
    supplierId: t.matchedSupplierId,
    customerId: t.matchedCustomerId,
    vatCode: t.suggestedVatCode ?? "",
    allocationNotes: t.allocationNotes ?? "",
    setRule: false,
  };
}

// Pilot Review Board follow-up — "the user must be able to type 15, 0,
// or E without opening a dropdown." The data model has one VAT concept
// (code/name/rate — see migration research notes), not a separate
// shorthand field, so the shorthand is derived here and folded into the
// combobox's own search text/exact-match tokens rather than adding a
// second column.
function vatShorthand(v: VatTreatment): string {
  if (v.vatType === "Exempt") return "E";
  return String(v.rate);
}

function accountDescriptionFor(edit: PendingRowEdit, chartOfAccounts: ChartOfAccount[], suppliers: Supplier[], customers: MinimalCustomer[]): string {
  if (edit.type === "G") return chartOfAccounts.find((a) => a.accountCode === edit.accountCode)?.description ?? "";
  if (edit.type === "S") return suppliers.find((s) => s.id === edit.supplierId)?.name ?? "";
  return customers.find((c) => c.id === edit.customerId)?.name ?? "";
}

const helper = createColumnHelper<BankTransactionRecord>();

export const ALL_COLUMN_IDS = [
  "transactionDate", "description", "reference", "debit", "credit", "balance", "bankAccount",
  "merchant", "type", "accountCode", "accountDescription", "vatCode", "allocationNotes", "setRule",
  "supplier", "customer", "glAccount", "vatTreatment", "allocationStatus",
  "rulesApplied", "journalStatus", "confidenceScore", "requiredAction",
] as const;

export const COLUMN_LABELS: Record<(typeof ALL_COLUMN_IDS)[number], string> = {
  transactionDate: "Date",
  description: "Description",
  reference: "Reference",
  debit: "Debit",
  credit: "Credit",
  balance: "Balance",
  bankAccount: "Bank Account",
  merchant: "Merchant",
  type: "Type",
  accountCode: "Account Code",
  accountDescription: "Account Description",
  vatCode: "VAT Code",
  allocationNotes: "Notes",
  setRule: "Set Rule",
  supplier: "Supplier",
  customer: "Customer",
  glAccount: "GL Account",
  vatTreatment: "VAT Treatment",
  allocationStatus: "Matching Status",
  rulesApplied: "Rule Applied",
  journalStatus: "Journal Status",
  confidenceScore: "Confidence",
  requiredAction: "Recovery Status",
};

// Six new editable/derived columns — clicking into any of them must never
// also fire the row's own `onRowClick` (which opens the read-only detail
// drawer), same reasoning as the pre-existing `select` checkbox column.
const NEW_ALLOCATION_COLUMN_IDS = new Set(["type", "accountCode", "accountDescription", "vatCode", "allocationNotes", "setRule"]);

// VR-022 — "Frozen columns (Date, Description, Amount) should remain
// visible while scrolling if practical." No single "Amount" column
// exists (debit/credit/balance are separate, since this is a
// double-entry ledger, not a single signed-amount feed) — pinning all
// three would eat most of the visible width before the user even
// scrolls, so only Date and Description are pinned; `leftOffset` below
// already computes each pinned column's position dynamically, so this
// set can grow without any other change.
// Pilot Review Board follow-up — "Freeze key columns (Date,
// Description, Type)." Type is a single character wide, so pinning it
// costs almost no horizontal space compared to Date/Description.
const PINNED_COLUMN_IDS = new Set(["select", "transactionDate", "description", "type"]);

const TYPE_LABELS: Record<"G" | "C" | "S", string> = { G: "GL Account", C: "Customer", S: "Supplier" };

// Pilot Review Board follow-up — "typing g must instantly become G, no
// dropdown required." A plain single-character input beats a `<select>`
// here: a native select already accepts type-ahead, but always shows the
// full option label, not just the letter, and this workflow is typed
// dozens of times per statement. `onFocus` selects the existing character
// so the very next keystroke overwrites it instead of appending.
function TypeCell({
  value,
  disabled,
  onChange,
  cellRef,
}: {
  value: "G" | "C" | "S";
  disabled: boolean;
  onChange: (next: "G" | "C" | "S") => void;
  cellRef: (el: HTMLInputElement | null) => void;
}) {
  return (
    <input
      ref={cellRef}
      type="text"
      maxLength={1}
      disabled={disabled}
      value={value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const next = e.target.value.trim().slice(-1).toUpperCase();
        if (next === "G" || next === "C" || next === "S") onChange(next);
      }}
      aria-label="Allocation type — G for GL Account, C for Customer, S for Supplier"
      title={TYPE_LABELS[value]}
      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-center text-sm font-semibold focus:border-vf-red-500 focus:bg-vf-paper"
    />
  );
}

function AccountCodeCell({
  edit,
  chartOfAccounts,
  suppliers,
  customers,
  disabled,
  invalid,
  suggested,
  onAcceptSuggestion,
  onChange,
  cellRef,
}: {
  edit: PendingRowEdit;
  chartOfAccounts: ChartOfAccount[];
  suppliers: Supplier[];
  customers: MinimalCustomer[];
  disabled: boolean;
  invalid: boolean;
  suggested: boolean;
  onAcceptSuggestion: () => void;
  onChange: (patch: Partial<PendingRowEdit>) => void;
  cellRef: (el: HTMLInputElement | null) => void;
}) {
  // Pilot Review Board follow-up — "don't make the user think about
  // different lookup controls." One unified search across Customers,
  // Suppliers, and General Ledger accounts (in that fixed group order),
  // regardless of the row's current Type — picking any result sets Type
  // AND the underlying account/supplier/customer together in one
  // `onChange`. Values are prefixed by category ("g:440000"/"c:12"/
  // "s:7") since a GL code and a supplier id are otherwise not
  // guaranteed unique against each other.
  const options: ComboboxOption<string>[] = useMemo(
    () => [
      ...customers.map((c) => ({
        value: `c:${c.id}`, label: c.customerCode || c.name, sublabel: c.name, group: "Customers",
        searchText: `${c.customerCode} ${c.name}`,
      })),
      ...suppliers.map((s) => ({
        value: `s:${s.id}`, label: s.supplierCode || s.name, sublabel: s.name, group: "Suppliers",
        searchText: `${s.supplierCode} ${s.name} ${s.alternativeNames.join(" ")}`,
      })),
      ...chartOfAccounts.map((a) => ({
        value: `g:${a.accountCode}`, label: a.accountCode, sublabel: a.description, group: "General Ledger",
        searchText: `${a.accountCode} ${a.description}`,
      })),
    ],
    [chartOfAccounts, suppliers, customers],
  );

  const value = edit.type === "G" ? (edit.accountCode ? `g:${edit.accountCode}` : null) : edit.type === "S" ? (edit.supplierId !== null ? `s:${edit.supplierId}` : null) : edit.customerId !== null ? `c:${edit.customerId}` : null;

  return (
    <Combobox
      value={value}
      options={options}
      disabled={disabled}
      invalid={invalid}
      invalidMessage={edit.type === "G" ? "GL account is required." : edit.type === "S" ? "Supplier is required." : "Customer is required."}
      suggested={suggested}
      onAcceptSuggestion={onAcceptSuggestion}
      inputRef={cellRef}
      placeholder="Search customer, supplier, or GL account…"
      aria-label="Account"
      onCommit={(val) => {
        if (val === null) return;
        const [prefix, raw] = [val.slice(0, 1), val.slice(2)];
        if (prefix === "g") onChange({ type: "G", accountCode: raw, supplierId: null, customerId: null });
        else if (prefix === "s") onChange({ type: "S", accountCode: "", supplierId: Number(raw), customerId: null });
        else onChange({ type: "C", accountCode: "", customerId: Number(raw), supplierId: null });
      }}
    />
  );
}

function VatCodeCell({
  edit,
  vatTreatments,
  disabled,
  suggested,
  onAcceptSuggestion,
  onChange,
  cellRef,
  onTabOut,
}: {
  edit: PendingRowEdit;
  vatTreatments: VatTreatment[];
  disabled: boolean;
  suggested: boolean;
  onAcceptSuggestion: () => void;
  onChange: (patch: Partial<PendingRowEdit>) => void;
  cellRef: (el: HTMLInputElement | null) => void;
  onTabOut?: () => void;
}) {
  const options: ComboboxOption<string>[] = useMemo(
    () =>
      vatTreatments.map((v) => ({
        value: v.code,
        label: v.code,
        sublabel: `${v.rate}% · ${v.name}`,
        searchText: `${v.code} ${v.name} ${v.rate} ${vatShorthand(v)}`,
      })),
    [vatTreatments],
  );

  return (
    <Combobox
      value={edit.vatCode || null}
      options={options}
      disabled={disabled}
      suggested={suggested}
      onAcceptSuggestion={onAcceptSuggestion}
      inputRef={cellRef}
      placeholder="VAT…"
      aria-label="VAT code"
      onCommit={(val) => onChange({ vatCode: val ?? "" })}
      onTabOut={onTabOut}
    />
  );
}

/** Pilot Review Board follow-up — "Rule Preview: before the rule is
 * saved, let the user see exactly what will be created." Built from the
 * exact same data `ruleActionsFor`/`ruleTypeFor` use for the real
 * creation call, so this can never show something different from what
 * actually gets saved. */
function rulePreviewText(t: BankTransactionRecord, edit: PendingRowEdit, chartOfAccounts: ChartOfAccount[], suppliers: Supplier[], customers: MinimalCustomer[]): string {
  const account = accountDescriptionFor(edit, chartOfAccounts, suppliers, customers) || "—";
  const typeLabel = edit.type === "G" ? "GL" : edit.type === "C" ? "Customer" : "Supplier";
  const lines = [
    `Rule: Contains "${t.beneficiary}"`,
    `Allocate: ${typeLabel} — ${account}`,
    edit.vatCode ? `VAT: ${edit.vatCode}` : null,
    "Apply to: Current Company",
    t.bankAccount ? `Bank: ${t.bankAccount}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

function SetRuleCell({
  cellRef,
  checked,
  disabled,
  duplicate,
  onChange,
  preview,
}: {
  cellRef: (el: HTMLInputElement | null) => void;
  checked: boolean;
  disabled: boolean;
  duplicate: string | null;
  onChange: (checked: boolean) => void;
  preview: string | null;
}) {
  const [showPreview, setShowPreview] = useState(false);
  return (
    <div className="relative flex items-center gap-1.5">
      <input
        ref={cellRef}
        type="checkbox"
        aria-label="Set rule from this allocation"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        onFocus={() => setShowPreview(true)}
        onBlur={() => setShowPreview(false)}
      />
      {duplicate && (
        <span className="text-[10px] font-semibold text-vf-danger" title={`An identical rule already exists: "${duplicate}"`}>
          dup
        </span>
      )}
      {preview && (
        <button
          type="button"
          tabIndex={-1}
          onMouseEnter={() => setShowPreview(true)}
          onMouseLeave={() => setShowPreview(false)}
          className="flex h-4 w-4 items-center justify-center rounded-full bg-vf-info/16 text-[10px] font-bold text-vf-info"
          aria-label="Preview the rule that will be created"
        >
          i
        </button>
      )}
      {preview && showPreview && (
        <div className="absolute top-full left-0 z-20 mt-1 w-max max-w-64 rounded-vf-md border border-vf-paper-border bg-vf-paper p-2.5 text-xs whitespace-pre-line text-vf-ink-soft shadow-vf-paper-lg">
          {preview}
        </div>
      )}
    </div>
  );
}

export function TransactionGrid({
  transactions,
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
  rowSelection,
  onRowSelectionChange,
  columnSizing,
  onColumnSizingChange,
  onRowClick,
  loading,
  highlightedIds,
  suppliers,
  customers,
  chartOfAccounts,
  vatTreatments,
  onAllocateRow,
  onBulkAllocate,
  onCheckDuplicateRule,
  onMerchantClick,
}: {
  transactions: BankTransactionRecord[];
  sorting: SortingState;
  onSortingChange: (updater: SortingState | ((old: SortingState) => SortingState)) => void;
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: (updater: VisibilityState | ((old: VisibilityState) => VisibilityState)) => void;
  rowSelection: RowSelectionState;
  onRowSelectionChange: (updater: RowSelectionState | ((old: RowSelectionState) => RowSelectionState)) => void;
  columnSizing: ColumnSizingState;
  onColumnSizingChange: (updater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => void;
  onRowClick: (transaction: BankTransactionRecord) => void;
  loading?: boolean;
  /** Pilot Review Round 1, Phase 6 — "Highlight auto-allocated rows" the
   * moment a newly-created Banking Rule scans and allocates the rest of
   * an imported statement, so the accountant can see (and, per "Allow
   * manual override," still click into) exactly what just changed. */
  highlightedIds?: Set<number>;
  suppliers: Supplier[];
  customers: MinimalCustomer[];
  chartOfAccounts: ChartOfAccount[];
  vatTreatments: VatTreatment[];
  onAllocateRow: (transaction: BankTransactionRecord, input: AllocateRowPayload, ruleOptions: RuleCreationOptions | null) => Promise<boolean>;
  onBulkAllocate: (transactionIds: number[], input: AllocateRowPayload) => Promise<boolean>;
  onCheckDuplicateRule: (
    transaction: BankTransactionRecord,
    ruleType: "GL" | "Customer" | "Supplier",
    actions: { actionType: string; targetId?: number; targetText?: string }[],
  ) => Promise<string | null>;
  onMerchantClick: (transaction: BankTransactionRecord) => void;
}) {
  const data = useMemo(() => transactions, [transactions]);

  const [pendingEdits, setPendingEdits] = useState<Map<number, PendingRowEdit>>(new Map());
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [duplicateRuleNames, setDuplicateRuleNames] = useState<Map<number, string | null>>(new Map());
  // Pilot Review Board follow-up — "if several rows belong to the same
  // merchant, after allocating the first one the remaining rows should
  // automatically receive the same suggestion." Distinct from a real
  // pendingEdit (not yet touched by the user — a session-only proposal
  // sourced from a sibling row this session, not the server) and from
  // the Rule Engine's own `allocationStatus === "Suggested"` (that's a
  // persisted, rule-derived suggestion; this is an in-session echo of
  // what the accountant just did, before any rule necessarily exists).
  const [sessionSuggestions, setSessionSuggestions] = useState<Map<number, PendingRowEdit>>(new Map());
  // Pilot Review Board follow-up — "Ctrl+D: duplicate previous
  // allocation." The last successfully-saved allocation, notes/Set Rule
  // excluded (those are always transaction-specific, never repeated).
  const [lastAllocation, setLastAllocation] = useState<Omit<PendingRowEdit, "allocationNotes" | "setRule"> | null>(null);
  // "17 similar transactions found. Apply allocation?" — distinct from
  // `sessionSuggestions` (which quietly pre-fills same-beneficiary rows):
  // this is the louder, explicit prompt for rows that share the
  // reference, description, or amount instead, surfaced once per commit
  // and dismissible.
  const [similarPrompt, setSimilarPrompt] = useState<{ sourceId: number; matchingIds: number[]; edit: PendingRowEdit } | null>(null);
  const [applyingSimilar, setApplyingSimilar] = useState(false);
  const cellRefs = useRef<Array<Array<HTMLElement | null>>>([]);

  function getEdit(t: BankTransactionRecord): PendingRowEdit {
    return pendingEdits.get(t.id) ?? sessionSuggestions.get(t.id) ?? initialEdit(t);
  }

  function updateEdit(t: BankTransactionRecord, patch: Partial<PendingRowEdit>) {
    setPendingEdits((prev) => {
      const next = new Map(prev);
      next.set(t.id, { ...getEdit(t), ...patch });
      return next;
    });
  }

  function registerCellRef(rowIndex: number, colIndex: number, el: HTMLElement | null) {
    if (!cellRefs.current[rowIndex]) cellRefs.current[rowIndex] = [];
    cellRefs.current[rowIndex][colIndex] = el;
  }

  function focusEditableCell(rowIndex: number, colIndex: number) {
    requestAnimationFrame(() => {
      cellRefs.current[rowIndex]?.[colIndex]?.focus();
    });
  }

  async function commitRow(t: BankTransactionRecord) {
    const edit = pendingEdits.get(t.id);
    if (!edit || savingIds.has(t.id)) return;

    const missing =
      (edit.type === "G" && !edit.accountCode.trim()) || (edit.type === "S" && edit.supplierId === null) || (edit.type === "C" && edit.customerId === null);
    if (missing) return; // incomplete row — nothing to save yet, keep the pending edit so the field still shows as touched/invalid

    setSavingIds((prev) => new Set(prev).add(t.id));
    const ruleOptions: RuleCreationOptions | null = edit.setRule
      ? { matchDescription: t.beneficiary, matchType: "contains", applyToRemaining: true, applyToFutureImports: true }
      : null;

    const ok = await onAllocateRow(
      t,
      {
        type: edit.type,
        accountCode: edit.type === "G" ? edit.accountCode.trim() : null,
        supplierId: edit.type === "S" ? edit.supplierId : null,
        customerId: edit.type === "C" ? edit.customerId : null,
        vatCode: edit.vatCode.trim() || null,
        allocationNotes: edit.allocationNotes,
      },
      ruleOptions,
    );

    setSavingIds((prev) => {
      const next = new Set(prev);
      next.delete(t.id);
      return next;
    });
    if (ok) {
      setPendingEdits((prev) => {
        const next = new Map(prev);
        next.delete(t.id);
        return next;
      });
      setDuplicateRuleNames((prev) => {
        if (!prev.has(t.id)) return prev;
        const next = new Map(prev);
        next.delete(t.id);
        return next;
      });
      setLastAllocation({ type: edit.type, accountCode: edit.accountCode, supplierId: edit.supplierId, customerId: edit.customerId, vatCode: edit.vatCode });

      // Auto-fill — propose the same allocation to every other
      // still-untouched, still-Unallocated row on this page sharing the
      // same beneficiary. A proposal, not a write: nothing is saved
      // until the accountant accepts it (Tab/Accept), same as any other
      // Suggested cell.
      const siblingIds = transactions.filter((s) => s.id !== t.id && s.beneficiary === t.beneficiary && s.allocationStatus === "Unallocated" && !pendingEdits.has(s.id)).map((s) => s.id);
      if (siblingIds.length > 0) {
        setSessionSuggestions((prev) => {
          const next = new Map(prev);
          // Notes and Set Rule are transaction-specific — never propagated.
          for (const id of siblingIds) next.set(id, { ...edit, allocationNotes: "", setRule: false });
          return next;
        });
      }

      // "17 similar transactions found. Apply allocation?" — a louder,
      // explicit prompt (distinct from the quiet same-beneficiary
      // auto-fill above) for rows sharing the reference, description, or
      // amount instead. Same-beneficiary-only matches are excluded here
      // since `sessionSuggestions` above already covers them.
      const siblingIdSet = new Set(siblingIds);
      const similarIds = transactions
        .filter((s) => s.id !== t.id && !siblingIdSet.has(s.id) && s.allocationStatus === "Unallocated" && !pendingEdits.has(s.id))
        .filter((s) => (t.reference !== "" && s.reference === t.reference) || s.description === t.description || Math.max(s.debit, s.credit) === Math.max(t.debit, t.credit))
        .map((s) => s.id);
      setSimilarPrompt(similarIds.length > 0 ? { sourceId: t.id, matchingIds: similarIds, edit: { ...edit, allocationNotes: "", setRule: false } } : null);
    }
  }

  async function applySimilarPrompt() {
    if (!similarPrompt) return;
    setApplyingSimilar(true);
    const { matchingIds, edit } = similarPrompt;
    await onBulkAllocate(matchingIds, {
      type: edit.type,
      accountCode: edit.type === "G" ? edit.accountCode.trim() : null,
      supplierId: edit.type === "S" ? edit.supplierId : null,
      customerId: edit.type === "C" ? edit.customerId : null,
      vatCode: edit.vatCode.trim() || null,
      allocationNotes: "",
    });
    setApplyingSimilar(false);
    setSimilarPrompt(null);
  }

  async function handleSetRuleToggle(t: BankTransactionRecord, checked: boolean) {
    updateEdit(t, { setRule: checked });
    if (!checked) return;
    const edit = getEdit(t);
    const payload: AllocateRowPayload = {
      type: edit.type,
      accountCode: edit.type === "G" ? edit.accountCode : null,
      supplierId: edit.type === "S" ? edit.supplierId : null,
      customerId: edit.type === "C" ? edit.customerId : null,
      vatCode: edit.vatCode || null,
      allocationNotes: edit.allocationNotes,
    };
    const duplicate = await onCheckDuplicateRule(t, ruleTypeFor(edit.type), ruleActionsFor(payload));
    setDuplicateRuleNames((prev) => new Map(prev).set(t.id, duplicate));
  }

  const columns = useMemo(
    () => [
      helper.display({
        id: "select",
        size: 40,
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Select all transactions on this page"
            checked={table.getIsAllRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected();
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select transaction ${row.original.id}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      }),
      helper.accessor("transactionDate", { id: "transactionDate", size: 110, header: "Date", cell: (c) => c.getValue() ?? "—" }),
      helper.accessor("description", {
        id: "description", size: 220, header: "Description",
        cell: (c) => {
          const t = c.row.original;
          if (!c.getValue()) return "—";
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMerchantClick(t);
              }}
              className="truncate text-left underline decoration-vf-paper-border decoration-dotted underline-offset-2 hover:text-vf-red-600 hover:decoration-vf-red-500"
              title="View merchant intelligence"
            >
              {c.getValue()}
            </button>
          );
        },
      }),
      helper.accessor("reference", { id: "reference", size: 130, header: "Reference", cell: (c) => c.getValue() || "—" }),
      helper.accessor("debit", {
        id: "debit", size: 110, header: "Debit",
        cell: (c) => <span className="font-mono tabular-nums">{c.getValue() > 0 ? money(c.getValue()) : "—"}</span>,
      }),
      helper.accessor("credit", {
        id: "credit", size: 110, header: "Credit",
        cell: (c) => <span className="font-mono tabular-nums">{c.getValue() > 0 ? money(c.getValue()) : "—"}</span>,
      }),
      helper.accessor("balance", {
        id: "balance", size: 120, header: "Balance",
        cell: (c) => <span className="font-mono tabular-nums">{money(c.getValue())}</span>,
      }),
      helper.accessor("bankAccount", { id: "bankAccount", size: 130, header: "Bank Account", cell: (c) => c.getValue() || "—" }),
      helper.accessor("matchedMerchantId", {
        id: "merchant", size: 130, header: "Merchant",
        cell: (c) => (
          <span className={c.getValue() !== null ? "text-vf-ink" : "text-vf-ink-faint italic"}>
            {c.getValue() !== null ? "Assigned" : "Not yet identified"}
          </span>
        ),
      }),
      // --- Bank Transaction Allocation Workspace — new editable columns ---
      helper.display({
        id: "type", size: 64, header: "Type",
        cell: ({ row }) => {
          const t = row.original;
          const edit = getEdit(t);
          return (
            <TypeCell
              value={edit.type}
              disabled={savingIds.has(t.id)}
              onChange={(next) => updateEdit(t, { type: next, accountCode: "", supplierId: null, customerId: null })}
              cellRef={(el) => registerCellRef(row.index, 0, el)}
            />
          );
        },
      }),
      helper.display({
        id: "accountCode", size: 200, header: "Account Code",
        cell: ({ row }) => {
          const t = row.original;
          const edit = getEdit(t);
          const touched = pendingEdits.has(t.id);
          const missing = (edit.type === "G" && !edit.accountCode.trim()) || (edit.type === "S" && edit.supplierId === null) || (edit.type === "C" && edit.customerId === null);
          const suggested = (t.allocationStatus === "Suggested" || sessionSuggestions.has(t.id)) && !touched;
          return (
            <AccountCodeCell
              edit={edit}
              chartOfAccounts={chartOfAccounts}
              suppliers={suppliers}
              customers={customers}
              disabled={savingIds.has(t.id)}
              invalid={touched && missing}
              suggested={suggested}
              onAcceptSuggestion={() => updateEdit(t, {})}
              onChange={(patch) => updateEdit(t, patch)}
              cellRef={(el) => registerCellRef(row.index, 1, el)}
            />
          );
        },
      }),
      helper.display({
        id: "accountDescription", size: 200, header: "Account Description",
        cell: ({ row }) => {
          const edit = getEdit(row.original);
          const description = accountDescriptionFor(edit, chartOfAccounts, suppliers, customers);
          return <span className={description ? "text-vf-ink-soft" : "text-vf-ink-faint italic"}>{description || "—"}</span>;
        },
      }),
      helper.display({
        id: "vatCode", size: 160, header: "VAT Code",
        cell: ({ row }) => {
          const t = row.original;
          const edit = getEdit(t);
          const suggested = (t.allocationStatus === "Suggested" || sessionSuggestions.has(t.id)) && !pendingEdits.has(t.id);
          return (
            <VatCodeCell
              edit={edit}
              vatTreatments={vatTreatments}
              disabled={savingIds.has(t.id)}
              suggested={suggested}
              onAcceptSuggestion={() => updateEdit(t, {})}
              onChange={(patch) => updateEdit(t, patch)}
              cellRef={(el) => registerCellRef(row.index, 2, el)}
              onTabOut={row.index < transactions.length - 1 ? () => focusEditableCell(row.index + 1, 0) : undefined}
            />
          );
        },
      }),
      helper.display({
        id: "allocationNotes", size: 200, header: "Notes",
        cell: ({ row }) => {
          const t = row.original;
          const edit = getEdit(t);
          return (
            <Input
              ref={(el) => registerCellRef(row.index, 3, el)}
              disabled={savingIds.has(t.id)}
              value={edit.allocationNotes}
              onChange={(e) => updateEdit(t, { allocationNotes: e.target.value })}
              aria-label="Allocation notes"
              className="border-transparent bg-transparent px-2 py-1.5 text-sm focus:border-vf-red-500 focus:bg-vf-paper"
            />
          );
        },
      }),
      helper.display({
        id: "setRule", size: 110, header: "Set Rule",
        cell: ({ row }) => {
          const t = row.original;
          const edit = getEdit(t);
          const duplicate = duplicateRuleNames.get(t.id);
          return (
            <SetRuleCell
              cellRef={(el) => registerCellRef(row.index, 4, el)}
              checked={edit.setRule}
              disabled={savingIds.has(t.id)}
              duplicate={duplicate ?? null}
              onChange={(checked) => handleSetRuleToggle(t, checked)}
              preview={edit.setRule ? rulePreviewText(t, edit, chartOfAccounts, suppliers, customers) : null}
            />
          );
        },
      }),
      // --- end new editable columns ---
      helper.accessor((row) => row.matchedSupplierName ?? row.beneficiary, {
        id: "supplier", size: 180, header: "Supplier",
        cell: (c) => (
          <span className={c.row.original.matchedSupplierName ? "text-vf-ink" : "text-vf-ink-faint italic"}>{c.getValue() || "—"}</span>
        ),
      }),
      helper.accessor("matchedCustomerId", {
        id: "customer", size: 160, header: "Customer",
        cell: (c) => {
          const customer = customers.find((cust) => cust.id === c.getValue());
          return <span className={customer ? "text-vf-ink" : "text-vf-ink-faint italic"}>{customer?.name ?? "—"}</span>;
        },
      }),
      helper.accessor("suggestedGlAccount", { id: "glAccount", size: 160, header: "GL Account", cell: (c) => c.getValue() ?? "—" }),
      helper.accessor("suggestedVatCode", { id: "vatTreatment", size: 130, header: "VAT Treatment", cell: (c) => c.getValue() ?? "—" }),
      helper.display({
        id: "allocationStatus", size: 130, header: "Matching Status",
        cell: ({ row }) => {
          const t = row.original;
          const edit = getEdit(t);
          const touched = pendingEdits.has(t.id);
          const missing = (edit.type === "G" && !edit.accountCode.trim()) || (edit.type === "S" && edit.supplierId === null) || (edit.type === "C" && edit.customerId === null);
          const { label, tone } = computeMatchStatus(t, touched, missing);
          return <Badge tone={tone}>{label}</Badge>;
        },
      }),
      helper.accessor("rulesTriggered", {
        id: "rulesApplied", size: 200, header: "Rule Applied",
        cell: (c) => (c.getValue().length > 0 ? c.getValue().join(", ") : "—"),
      }),
      helper.accessor("journalId", {
        id: "journalStatus", size: 120, header: "Journal Status",
        cell: (c) => (c.getValue() !== null ? <Badge tone="info">Draft</Badge> : "—"),
      }),
      helper.accessor("confidenceScore", {
        id: "confidenceScore", size: 110, header: "Confidence",
        cell: (c) => (c.getValue() !== null ? <span className="font-mono tabular-nums">{c.getValue()!.toFixed(0)}%</span> : "—"),
      }),
      helper.accessor("requiredAction", {
        id: "requiredAction", size: 260, header: "Recovery Status",
        cell: (c) => (c.getValue() ? <Badge tone="warn">{c.getValue()}</Badge> : "—"),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingEdits, savingIds, duplicateRuleNames, sessionSuggestions, chartOfAccounts, vatTreatments, suppliers, customers, onMerchantClick],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, rowSelection, columnSizing },
    onSortingChange,
    onColumnVisibilityChange,
    onRowSelectionChange,
    onColumnSizingChange,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
  });

  function leftOffset(columnId: string): number {
    let offset = 0;
    for (const col of table.getVisibleLeafColumns()) {
      if (col.id === columnId) return offset;
      if (PINNED_COLUMN_IDS.has(col.id)) offset += col.getSize();
    }
    return offset;
  }

  const rows = table.getRowModel().rows;
  const rowCount = rows.length;

  // Pilot Review Board follow-up — "virtual scrolling should not wait
  // until a later phase... it must remain responsive with 10,000+
  // transactions." Row height here is effectively fixed: every editable
  // cell's own dropdown popup is `position: absolute` (see
  // `combobox.tsx`), so it never adds to the row's natural document-flow
  // height — a plain `estimateSize` is accurate, no per-row dynamic
  // measurement needed. Only rows within the scroll viewport (+overscan)
  // are ever mounted, regardless of how many transactions are loaded.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 49,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;

  // UX-001 — "the user must never need to scroll to the last row just to
  // move sideways." The table's own native horizontal scrollbar lives at
  // the bottom of its box, which on a laptop screen can genuinely be
  // below the fold once filters/stats/toolbar chrome stack up above the
  // grid. This mirrors that same scroll position into a slim bar pinned
  // right above the grid instead — always in view whenever the grid is,
  // regardless of vertical scroll position inside it.
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const syncingScrollRef = useRef<"top" | "table" | null>(null);

  useEffect(() => {
    const el = tableWrapperRef.current;
    if (!el) return;
    const update = () => setTableScrollWidth(el.scrollWidth);
    update();
    // jsdom (this project's test environment) has no ResizeObserver —
    // the one-off `update()` above already covers a correct initial
    // measurement there; only real browsers get the live re-measure.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [columns]);

  function handleTopScroll() {
    if (syncingScrollRef.current === "table") return;
    syncingScrollRef.current = "top";
    if (tableWrapperRef.current && topScrollRef.current) tableWrapperRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    syncingScrollRef.current = null;
  }

  function handleTableScroll() {
    if (syncingScrollRef.current === "top") return;
    syncingScrollRef.current = "table";
    if (tableWrapperRef.current && topScrollRef.current) topScrollRef.current.scrollLeft = tableWrapperRef.current.scrollLeft;
    syncingScrollRef.current = null;
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, rowIndex: number) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    const rowCells = cellRefs.current[rowIndex] ?? [];
    const colIndex = rowCells.indexOf(document.activeElement as HTMLElement);
    if (colIndex === -1) return;
    if (e.key === "ArrowUp") {
      if (rowIndex > 0) {
        e.preventDefault();
        focusEditableCell(rowIndex - 1, colIndex);
      }
      return;
    }
    // ArrowDown or Enter — both move to the same column, one row down.
    if (rowIndex < rowCount - 1) {
      e.preventDefault();
      focusEditableCell(rowIndex + 1, colIndex);
    }
  }

  function handleRowBlur(e: React.FocusEvent<HTMLTableRowElement>, transaction: BankTransactionRecord) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return; // focus moved within the same row — not done yet
    void commitRow(transaction);
  }

  function focusedRowIndex(): number | null {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return null;
    for (let r = 0; r < cellRefs.current.length; r++) {
      if (cellRefs.current[r]?.includes(active)) return r;
    }
    return null;
  }

  // Pilot Review Board follow-up — "Full Keyboard Shortcuts." F2 (edit
  // current cell) has no distinct action here — every cell is already
  // directly editable on focus, there's no separate view/edit mode to
  // switch — so it's intentionally not bound to anything.
  function handleGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const rowIndex = focusedRowIndex();
    if (rowIndex === null) return;
    const t = rows[rowIndex]?.original;
    if (!t) return;
    const ctrlOrCmd = e.ctrlKey || e.metaKey;

    if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      if (lastAllocation) updateEdit(t, { ...lastAllocation });
      return;
    }
    if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "r") {
      e.preventDefault();
      void handleSetRuleToggle(t, !getEdit(t).setRule);
      return;
    }
    if (ctrlOrCmd && e.key === "Enter") {
      e.preventDefault();
      if (similarPrompt?.sourceId === t.id) void applySimilarPrompt();
      return;
    }
    if (e.key === "F4") {
      e.preventDefault();
      focusEditableCell(rowIndex, 1);
      return;
    }
    if (ctrlOrCmd && e.shiftKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      const edit = getEdit(t);
      const selectedIds = transactions.filter((tx) => rowSelection[String(tx.id)]).map((tx) => tx.id);
      if (selectedIds.length > 0) {
        void onBulkAllocate(selectedIds, {
          type: edit.type,
          accountCode: edit.type === "G" ? edit.accountCode.trim() : null,
          supplierId: edit.type === "S" ? edit.supplierId : null,
          customerId: edit.type === "C" ? edit.customerId : null,
          vatCode: edit.vatCode.trim() || null,
          allocationNotes: "",
        });
      }
    }
  }

  return (
    // `min-w-0` on both this flex column and its scroll-container child
    // below — the exact same flexbox `min-width: auto` overflow bug
    // VR-022 root-caused in `workspace-shell.tsx` (a flex item won't
    // shrink below its widest descendant's intrinsic width unless told
    // to), recurring here because the virtualization scroll container
    // added afterward is itself a NEW flex item nesting level that
    // hadn't inherited the fix. Without this, the grid's own
    // `min-w-max` table (in `ui/table.tsx`) pushes these wrapping divs —
    // and therefore the whole page — wider instead of scrolling inside
    // its own `overflow-x-auto` container.
    <div className="flex min-w-0 flex-col gap-2">
      {similarPrompt && (
        <div className="flex flex-wrap items-center gap-3 rounded-vf-md border border-vf-info/25 bg-vf-info/8 px-3.5 py-2.5 text-sm text-vf-info">
          <span>
            {similarPrompt.matchingIds.length} similar transaction{similarPrompt.matchingIds.length === 1 ? "" : "s"} found (same reference, description, or amount). Apply this allocation to
            {similarPrompt.matchingIds.length === 1 ? " it" : " all of them"}?
          </span>
          <button
            type="button"
            disabled={applyingSimilar}
            onClick={applySimilarPrompt}
            className="rounded-full border border-vf-info/40 px-3 py-1 text-xs font-semibold hover:bg-vf-info/15 disabled:opacity-50"
          >
            {applyingSimilar ? "Applying…" : `Apply to ${similarPrompt.matchingIds.length}`}
          </button>
          <button type="button" onClick={() => setSimilarPrompt(null)} className="text-xs font-medium text-vf-ink-faint hover:text-vf-ink">
            Dismiss
          </button>
        </div>
      )}
      {tableScrollWidth > 0 && (
        <div
          ref={topScrollRef}
          onScroll={handleTopScroll}
          className="min-w-0 overflow-x-auto overflow-y-hidden"
          style={{ scrollbarWidth: "thin" }}
          aria-hidden
        >
          <div style={{ width: tableScrollWidth, height: 1 }} />
        </div>
      )}
      <div ref={scrollContainerRef} onKeyDownCapture={handleGridKeyDown} className="min-w-0 max-h-[600px] overflow-y-auto rounded-vf-md">
    <Table ref={tableWrapperRef} onScroll={handleTableScroll}>
      <TableHead sticky>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              const pinned = PINNED_COLUMN_IDS.has(header.column.id);
              const sortState = header.column.getIsSorted();
              const sortable = ["transactionDate", "debit", "credit"].includes(header.column.id);
              return (
                <TableHeadCell
                  key={header.id}
                  scope="col"
                  aria-sort={sortable ? (sortState === "asc" ? "ascending" : sortState === "desc" ? "descending" : "none") : undefined}
                  style={{ width: header.getSize(), position: pinned ? "sticky" : undefined, left: pinned ? leftOffset(header.column.id) : undefined }}
                  className={cn("relative select-none whitespace-nowrap", pinned && "z-[2] bg-vf-paper-alt")}
                >
                  {sortable ? (
                    <button type="button" className="flex items-center gap-1" onClick={header.column.getToggleSortingHandler()}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sortState === "asc" && <span aria-hidden>↑</span>}
                      {sortState === "desc" && <span aria-hidden>↓</span>}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                  {header.column.getCanResize() && (
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-vf-red-400/40"
                    />
                  )}
                </TableHeadCell>
              );
            })}
          </tr>
        ))}
      </TableHead>
      <TableBody>
        {loading ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="py-8 text-center text-vf-ink-faint">
              Loading transactions…
            </TableCell>
          </TableRow>
        ) : rowCount === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="py-8 text-center text-vf-ink-faint">
              No transactions match the current filters.
            </TableCell>
          </TableRow>
        ) : (
          <>
            {paddingTop > 0 && (
              <tr aria-hidden style={{ height: paddingTop }}>
                <td colSpan={columns.length} />
              </tr>
            )}
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
                <TableRow
                  key={row.id}
                  className={cn("cursor-pointer", highlightedIds?.has(row.original.id) && "bg-vf-success/10 hover:bg-vf-success/15")}
                  onClick={() => onRowClick(row.original)}
                  onKeyDown={(e) => handleRowKeyDown(e, row.index)}
                  onBlur={(e) => handleRowBlur(e, row.original)}
                >
                  {row.getVisibleCells().map((cell) => {
                    const pinned = PINNED_COLUMN_IDS.has(cell.column.id);
                    const isNewColumn = NEW_ALLOCATION_COLUMN_IDS.has(cell.column.id);
                    return (
                      <TableCell
                        key={cell.id}
                        style={{ width: cell.column.getSize(), position: pinned ? "sticky" : undefined, left: pinned ? leftOffset(cell.column.id) : undefined }}
                        className={cn(pinned && "z-[1] bg-vf-paper", isNewColumn && "p-1")}
                        onClick={isNewColumn ? (e) => e.stopPropagation() : undefined}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
            {paddingBottom > 0 && (
              <tr aria-hidden style={{ height: paddingBottom }}>
                <td colSpan={columns.length} />
              </tr>
            )}
          </>
        )}
      </TableBody>
    </Table>
      </div>
    </div>
  );
}

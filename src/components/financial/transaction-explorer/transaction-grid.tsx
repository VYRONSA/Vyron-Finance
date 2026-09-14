"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { AddGlAccountModal } from "./add-gl-account-modal";
import { SetRuleModal } from "./set-rule-modal";
import { cn } from "@/lib/utils";
import { isSubjectToSupplierInvoiceMatching, transactionPostingStatus, type BankTransactionRecord, type Supplier, type TransactionPostingStatus } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatTreatment } from "@/server/company-management/types";
import { REQUIRED_ACTION_DUPLICATE_PAYMENT } from "@/server/accounting/matching-engine";
// Phase 29 — MATCH_TYPE_LABELS is a runtime value (used to render the rule preview tooltip); RuleCreationOptions stays type-only.
import { MATCH_TYPE_LABELS, type RuleCreationOptions } from "./transaction-bulk-action-bar";
import { formatAmount } from "@/lib/format";

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
  // Phase 22A — AI Transaction Classification. `allocationMethod ===
  // "Future AI"` is the ONLY way a suggestion reaches this state (the
  // classification service never runs on a transaction a rule/match
  // already touched — see transaction-classification-service.ts), so
  // this check is unambiguous and must be visually distinct from the
  // generic "Suggested" badge below, per this feature's own requirement
  // that an AI-processed transaction be obviously different from an
  // ordinary one.
  if (t.allocationMethod === "Future AI" && t.allocationStatus === "Suggested") return { label: "AI Suggested", tone: "warn" };
  // Phase 26A — automatic AI allocation (genuinely High confidence, see
  // transaction-classification-service.ts::targetStatusFor). MUST be
  // checked (and MUST be textually distinct — "AI Allocated", never bare
  // "Allocated") before the generic Allocated/Matched checks below, so a
  // transaction AI actually allocated is never confused with one a human
  // or the Matching Engine allocated.
  //
  // Phase 28, Part 10 — the forensic investigation found this distinct
  // LABEL wasn't enough: sharing tone "good" (the same green as a
  // Rule/Matching/human-confirmed row) let an AI auto-allocation read as
  // "done" at a glance in a busy grid, undermining the label's own
  // purpose. Now "warn" (the same amber weight as an ordinary Suggested
  // row) — an AI allocation, automatic or not, is never visually
  // presented as more settled than it is; the Accept action rendered
  // alongside this badge (see the "allocationStatus" column cell below)
  // is what actually resolves it to a genuine, human-confirmed
  // Allocated. This label is also unchanged by Part 1's safety pause:
  // it still correctly renders the ~165 existing rows this investigation
  // found already written as allocation_status='Allocated' before the
  // pause took effect — Part 11 requires those left untouched, not this
  // display logic.
  if (t.allocationMethod === "Future AI" && t.allocationStatus === "Allocated") return { label: "AI Allocated", tone: "warn" };
  if (t.allocationStatus === "Matched") return { label: "Matched", tone: "good" };
  if (t.allocationStatus === "Suggested") return { label: "Suggested", tone: "warn" };
  if (t.allocationStatus === "Allocated") return { label: "Allocated", tone: "good" };
  return { label: "Unallocated", tone: "muted" };
}

/** Phase 28, Part 10 — extracted (not left inline in the column `cell`)
 * so this exact gating condition is directly unit-testable the same way
 * `computeMatchStatus` already is, without depending on the grid's
 * virtualized rendering (this file's own existing tests document that
 * jsdom + row virtualization together make asserting "row N's cell
 * contains X" unreliable — see "TransactionGrid virtualization" below).
 * Both AI states (Allocated and Suggested) need it — Part 5/8's
 * conservative posture treats an automatic AI decision as needing human
 * confirmation either way, never a rule-equivalent settled fact on its
 * own — but a Rule/Matching/manual allocation, or a transaction AI
 * merely left Unallocated, never shows it. */
export function needsAiAcceptAction(t: BankTransactionRecord): boolean {
  return t.allocationMethod === "Future AI" && (t.allocationStatus === "Allocated" || t.allocationStatus === "Suggested");
}

function money(value: number | null): string {
  if (value === null) return "—";
  return formatAmount(value);
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
  // Pilot Review Board follow-up (UX-008) — `null` means "not chosen
  // yet," a real, distinct third state from G/C/S: it's what makes the
  // Account Code search unified (Customers+Suppliers+GL together) for a
  // brand-new, untouched row, while narrowing to exactly one category
  // the moment Type IS set — either by typing it directly, or by
  // picking a result from the unified search, which sets it as a
  // side effect.
  type: "G" | "C" | "S" | null;
  accountCode: string;
  supplierId: number | null;
  customerId: number | null;
  vatCode: string;
  /** Supplier Invoice Matching Override (migration 0095) — part of the
   * pending edit so ticking it marks the row dirty and "Update
   * Allocated" commits it alongside any allocation change, through the
   * same single write path. */
  overrideSupplierInvoiceMatching: boolean;
  allocationNotes: string;
  /** Phase 31A — the transaction's own editable Description/Narration
   * (`ae_bank_transactions.description`, already a plain writable text
   * column — no migration needed). Deliberately separate from
   * `allocationNotes` (an accountant-entered annotation) and from Set
   * Rule's own "Rule Search Text" (`RuleCreationOptions.matchDescription`,
   * which still defaults from and matches against `beneficiary`,
   * unchanged) — see the doc comment on the description column's cell
   * below for why those two stay independent. */
  description: string;
  setRule: boolean;
};

export type AllocateRowPayload = {
  /** Phase 31B — `null` means "no allocation change in this commit" — a
   * description/notes/VAT-only fix on a row that's still (and stays)
   * Unallocated. See `commitRow`'s gate: an allocation attempt (non-null
   * Type) must still be complete to save; a null Type never blocks a
   * genuine description change from saving on its own. */
  type: "G" | "C" | "S" | null;
  accountCode: string | null;
  supplierId: number | null;
  customerId: number | null;
  vatCode: string | null;
  allocationNotes: string;
  /** Phase 31A — `null` means "unchanged, don't write it" (keeps a
   * Type/Account/VAT/Notes-only save from re-writing an identical
   * description on every commit — see `computeDescriptionUpdate`). A
   * string (including `""`) means "write this value." */
  description: string | null;
  /** Supplier Invoice Matching Override (migration 0095). `null` means
   * "unchanged, omit from the UPDATE" — the same convention `description`
   * uses — so an ordinary allocation commit never silently clears an
   * override the accountant set earlier. `true`/`false` is a deliberate
   * change. It lifts only the invoice-matching requirement; it never
   * creates an invoice, a bill or a match, and never classifies. */
  overrideSupplierInvoiceMatching?: boolean | null;
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

/** Phase 40, Live Defect 1 — the label `SetRuleModal` shows next to the
 * resolved account/supplier/customer name. Derived from the SAME `type`
 * `ruleTypeFor`/`ruleActionsFor` use, so it can never say "GL Account"
 * for a row that's actually about to create a `set_supplier` action. */
export function accountTypeLabelFor(type: "G" | "C" | "S" | null): string {
  return type === "S" ? "Supplier" : type === "C" ? "Customer" : "GL Account";
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

/** Phase 26J — production forensic investigation found `allocation_type`
 * (the G/C/S discriminator this Type inference reads first) is only ever
 * written by the newest inline-grid `allocateRow` path
 * (`transaction-explorer-repository.ts` line ~762). Every OLDER
 * allocation write path — `fn_apply_ai_classification` (now fixed by
 * migration 0087 to also set it going forward, plus a one-time backfill
 * for rows it already wrote), Banking Rules' `applyRuleActions`, and
 * `bulkAssignGl` — predates that column and has never set it. Without
 * this fallback, any such row with a real, correctly-written
 * `suggestedGlAccount` but a null `allocationType` rendered with a
 * completely blank Account Code/Description cell — the exact symptom
 * reported in production (real AI allocations existed in the database,
 * Transaction Explorer showed them as blank). Ordered AFTER the
 * matched-supplier/customer checks so Matching's own claim on a row
 * (should one somehow coexist with a stray `suggestedGlAccount`) still
 * wins, unchanged from the existing precedence. Exported for direct
 * testing — this fallback protects every current and future write path,
 * not just the one this investigation started from. */
export function initialEdit(t: BankTransactionRecord): PendingRowEdit {
  const type: "G" | "C" | "S" | null =
    t.allocationType ?? (t.matchedSupplierId !== null ? "S" : t.matchedCustomerId !== null ? "C" : t.suggestedGlAccount !== null ? "G" : null);
  return {
    type,
    accountCode: t.suggestedGlAccount ?? "",
    supplierId: t.matchedSupplierId,
    customerId: t.matchedCustomerId,
    vatCode: t.suggestedVatCode ?? "",
    allocationNotes: t.allocationNotes ?? "",
    description: t.description ?? "",
    overrideSupplierInvoiceMatching: t.overrideSupplierInvoiceMatching,
    setRule: false,
  };
}

/** Phase 31A — the ONE place that decides whether a commit should write a
 * new description: `null` (never sent to the server) when the current
 * edit's description is identical to the transaction's last-known
 * server value, a trimmed string otherwise. Pure and exported so "an
 * unchanged description is never unnecessarily written" is directly
 * testable without a network mock. */
export function computeDescriptionUpdate(edit: Pick<PendingRowEdit, "description">, transaction: Pick<BankTransactionRecord, "description">): string | null {
  const next = edit.description.trim();
  return next === (transaction.description ?? "") ? null : next;
}

/** Phase 31B — "the user must be able to correct a Description without
 * being forced to allocate." The single decision `commitRow` needs
 * before it may fire a request at all — extracted as a pure function
 * (same reasoning as every other decision helper in this file) so the
 * five required scenarios (Unallocated+Description, Unallocated+Notes
 * only, Description+GL, Allocated+Description, Suggested+Description)
 * are all directly testable without rendering the grid.
 *
 * An ALLOCATION ATTEMPT (a Type has been chosen — G/C/S) must still be
 * complete before it can save; that validation is untouched. A row with
 * NO Type chosen at all (still genuinely Unallocated) is no longer
 * blocked outright — it can save on its own as long as its Description
 * actually changed. Notes/VAT alone, with no Description change and no
 * Type, stay blocked — deliberately preserving the pre-existing
 * behaviour for that one case (Section 1 of Phase 31B: "Unallocated
 * transaction + changed Notes → preserve existing behaviour"). */
export function computeCommitEligibility(edit: PendingRowEdit, transaction: Pick<BankTransactionRecord, "description">): { ok: true } | { ok: false; reason: string } {
  if (edit.type !== null) {
    if (isAllocationMissing(edit)) return { ok: false, reason: "Missing account, supplier, or customer" };
    return { ok: true };
  }
  if (computeDescriptionUpdate(edit, transaction) === null) return { ok: false, reason: "No changes to save" };
  return { ok: true };
}

export type BlockedPendingEdit = { id: number; reason: string };
/** Every pending edit, split by whether `commitRow` would actually accept
 * it. Both halves matter to the accountant, for different reasons.
 *
 * PRODUCTION DEFECT this exists to close: "Update Allocated" counted, and
 * offered to commit, EVERY pending edit — including ones
 * `computeCommitEligibility` refuses outright (a row whose only change is
 * Notes on a still-unallocated transaction; a row with a Type chosen but
 * no account yet). Committing those is a guaranteed no-op, so the row
 * stayed in `pendingEdits`, the toolbar count never moved, and the button
 * could be clicked forever with nothing changing — exactly what was
 * reported. The count has to be a count of work that CAN be done, and
 * whatever cannot be done has to say so instead of hiding inside it.
 *
 * Pure and exported so this is directly unit-testable without rendering
 * the (virtualized, jsdom-hostile) grid — same convention as
 * `prunePendingEdits`/`selectDirtyIds` above. Edits whose row is no
 * longer on the page are ignored here; `prunePendingEdits` removes them. */
export function triagePendingEdits(
  pendingEdits: Map<number, PendingRowEdit>,
  visibleTransactions: Pick<BankTransactionRecord, "id" | "description">[],
): { committableIds: Set<number>; blocked: BlockedPendingEdit[] } {
  const byId = new Map(visibleTransactions.map((t) => [t.id, t]));
  const committableIds = new Set<number>();
  const blocked: BlockedPendingEdit[] = [];
  for (const [id, edit] of pendingEdits) {
    const transaction = byId.get(id);
    if (!transaction) continue;
    const eligibility = computeCommitEligibility(edit, transaction);
    if (eligibility.ok) committableIds.add(id);
    else blocked.push({ id, reason: eligibility.reason });
  }
  return { committableIds, blocked };
}

/** The accountant-facing explanation of a refusal. `computeCommitEligibility`'s
 * own reasons are terse internal states ("No changes to save") that, shown
 * against a row the accountant demonstrably DID change, read as a
 * contradiction. This says what is actually required instead. */
export function blockedEditExplanation(reason: string): string {
  if (reason === "No changes to save") {
    return "Notes or VAT alone cannot be saved on an unallocated transaction — choose a Type and account, or change the Description.";
  }
  if (reason === "Missing account, supplier, or customer") {
    return "The allocation is incomplete — choose the account, supplier or customer for the Type selected.";
  }
  return reason;
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
  if (edit.type === "C") return customers.find((c) => c.id === edit.customerId)?.name ?? "";
  return "";
}

/** Whether the row's allocation is complete enough to save — `type`
 * itself being unresolved (`null`) always counts as missing, same as a
 * resolved type with no account/supplier/customer chosen yet. */
/** Master Implementation Tracker — Epic E11, Finding #224 (RC-9). A
 * row's pending edit is only meaningful while that row is still on the
 * current page — once a (confirmed) filter/sort/page change replaces
 * `transactions`, any edit whose row is no longer present is pruned so
 * a stale, now-unreachable entry doesn't keep the "unsaved edits"
 * guard armed. Pure and exported so this is directly unit-testable
 * without rendering the (virtualized, jsdom-unfriendly) grid. */
export function prunePendingEdits<TEdit>(pendingEdits: Map<number, TEdit>, visibleTransactions: { id: number }[]): Map<number, TEdit> {
  if (pendingEdits.size === 0) return pendingEdits;
  const visibleIds = new Set(visibleTransactions.map((t) => t.id));
  const next = new Map(pendingEdits);
  let changed = false;
  for (const id of pendingEdits.keys()) {
    if (!visibleIds.has(id)) {
      next.delete(id);
      changed = true;
    }
  }
  return changed ? next : pendingEdits;
}

export function isAllocationMissing(edit: PendingRowEdit): boolean {
  if (edit.type === null) return true;
  if (edit.type === "G") return !edit.accountCode.trim();
  if (edit.type === "S") return edit.supplierId === null;
  return edit.customerId === null;
}

// ---------------------------------------------------------------------
// Phase 31 — "Save Selected." A selected transaction can be selected but
// unedited (nothing to save), edited but incomplete (a real validation
// failure, not silently skipped), or edited and ready — these three pure
// functions are exactly the decision logic Save Selected needs, extracted
// and exported so they're directly unit-testable without rendering the
// (virtualized, jsdom-unfriendly) grid, matching this file's own existing
// convention (`ruleOptionsForCommit`, `prunePendingEdits`, etc.).
// ---------------------------------------------------------------------

/** Only a row with a REAL, user-touched pending edit is "dirty" — a row
 * merely showing an untouched `sessionSuggestions` proposal or its
 * server-loaded `initialEdit` (see `getEdit` below) was never actually
 * changed by this accountant and must not be submitted. */
export function selectDirtyIds(selectedIds: number[], pendingEdits: Map<number, PendingRowEdit>): number[] {
  return selectedIds.filter((id) => pendingEdits.has(id));
}

export type BulkSaveOutcome = { id: number; ok: boolean; reason?: string };
export type BulkSaveFailure = { id: number; reason: string };
export type BulkSaveSummary = { saved: number; unchanged: number; failed: BulkSaveFailure[] };

/** Pure aggregation of whatever `commitRow` actually returned for each
 * dirty row into the one summary the toolbar/banner renders — never a
 * bare "Success," per the accountant-facing requirement that a partial
 * batch result must be legible at a glance. */
export function summarizeBulkSaveOutcomes(outcomes: BulkSaveOutcome[], unchangedCount: number): BulkSaveSummary {
  return {
    saved: outcomes.filter((o) => o.ok).length,
    unchanged: unchangedCount,
    failed: outcomes.filter((o) => !o.ok).map((o) => ({ id: o.id, reason: o.reason ?? "Unknown error" })),
  };
}

/** A 50-row (or 100-row) selection must not fire 50 simultaneous requests
 * — a small fixed worker pool, each pulling the next item off the shared
 * cursor as soon as it finishes its own, bounds concurrency without
 * batching rows into one shared request (which would force one shared
 * payload — the opposite of what per-row heterogeneous edits need). */
export async function runWithConcurrencyLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, run));
  return results;
}

export const BULK_SAVE_CONCURRENCY = 5;

/** Phase 29A — forensic-review requirement: "Save cannot accidentally
 * create a Banking Rule unless Set Rule was explicitly configured."
 * Extracted from `commitRow` as a pure, exported function specifically
 * so this gating is directly unit-testable (jsdom's zero-height
 * virtualized scroll container makes real row-level interaction
 * untestable in this file — see "TransactionGrid virtualization" in the
 * test file). Returns `null` — no rule, ever — unless `edit.setRule` is
 * true; when it is, returns whatever `SetRuleModal` was actually
 * confirmed with (`ruleOptionsByTransaction`), falling back to the old
 * hardcoded default only defensively (the checkbox can't be checked
 * without the modal having stored real options first — see
 * `confirmSetRule`). */
export function ruleOptionsForCommit(
  edit: Pick<PendingRowEdit, "setRule" | "description">,
  transaction: Pick<BankTransactionRecord, "id">,
  ruleOptionsByTransaction: Map<number, RuleCreationOptions>,
): RuleCreationOptions | null {
  if (!edit.setRule) return null;
  // Phase 31B — mirrors `SetRuleModal`'s own fresh-open default
  // (description-first) for consistency; unreachable in practice since
  // the checkbox can't be checked without the modal having stored real,
  // possibly-edited options first — see `confirmSetRule`.
  // Phase 51 — `applyToRemaining` defaults to false (production defect:
  // it previously defaulted true and silently swept the whole company —
  // see the Phase 50 forensic report and `transaction-explorer.tsx`'s
  // `createRuleFromAllocation` doc comment).
  return ruleOptionsByTransaction.get(transaction.id) ?? { matchField: "description", matchDescription: edit.description, matchType: "contains", applyToRemaining: false, applyToFutureImports: true };
}

const helper = createColumnHelper<BankTransactionRecord>();

/** Deliberately not "warn" for Unprocessed: an unposted transaction in a
 * fresh import is the normal starting state, not a problem. Reconciled is
 * the only state that outranks Posted, so it gets the strongest tone. */
export const POSTING_STATUS_TONE: Record<TransactionPostingStatus, "muted" | "info" | "good" | "warn"> = {
  Unprocessed: "muted",
  "Ready to Post": "info",
  Posted: "good",
  Reconciled: "good",
};

export const ALL_COLUMN_IDS = [
  "transactionDate", "description", "reference", "debit", "credit", "balance", "bankAccount",
  "merchant", "type", "accountCode", "accountDescription", "vatCode", "allocationNotes", "setRule", "split",
  "supplier", "customer", "sourceGlAccount", "glAccount", "vatTreatment", "overrideInvoiceMatch", "allocationStatus", "postingStatus",
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
  split: "Split",
  supplier: "Supplier",
  customer: "Customer",
  sourceGlAccount: "Source Account (as imported)",
  glAccount: "GL Account",
  vatTreatment: "VAT Treatment",
  overrideInvoiceMatch: "Override Supplier Invoice Matching",
  allocationStatus: "Matching Status",
  postingStatus: "Posting Status",
  rulesApplied: "Rule Applied",
  journalStatus: "Journal Status",
  confidenceScore: "Confidence",
  requiredAction: "Recovery Status",
};

// Six new editable/derived columns — clicking into any of them must never
// also fire the row's own `onRowClick` (which opens the read-only detail
// drawer), same reasoning as the pre-existing `select` checkbox column.
const NEW_ALLOCATION_COLUMN_IDS = new Set(["description", "type", "accountCode", "accountDescription", "vatCode", "allocationNotes", "setRule", "save", "split"]);

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
const TYPE_LABEL_UNSET = "Not set — type G, C, or S";

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
  value: "G" | "C" | "S" | null;
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
      value={value ?? ""}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const next = e.target.value.trim().slice(-1).toUpperCase();
        if (next === "G" || next === "C" || next === "S") onChange(next);
      }}
      aria-label="Allocation type — G for GL Account, C for Customer, S for Supplier"
      title={value ? TYPE_LABELS[value] : TYPE_LABEL_UNSET}
      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-center text-sm font-semibold focus:border-vf-red-500 focus:bg-vf-paper"
    />
  );
}

const ADD_NEW_GL_ACCOUNT_VALUE = "g:__add_new__";

/** Phase 38 — extracted, pure, and exported so the active-only supplier
 * filter (and its GL/control-account sibling) can be unit tested directly
 * — `TransactionGrid`'s row virtualization means jsdom can't exercise a
 * real cell interaction in this test environment (see
 * `prunePendingEdits`'s own note on why this file favors extracted pure
 * functions for exactly this reason). Behavior is unchanged from the
 * inline `useMemo` this replaces. */
export function buildAccountCodeOptions(
  type: PendingRowEdit["type"],
  { chartOfAccounts, suppliers, customers }: { chartOfAccounts: ChartOfAccount[]; suppliers: Supplier[]; customers: MinimalCustomer[] },
): ComboboxOption<string>[] {
  const customerOptions = customers.map((c) => ({
    value: `c:${c.id}`, label: c.customerCode || c.name, sublabel: c.name, group: "Customers",
    searchText: `${c.customerCode} ${c.name}`,
  }));
  // Phase 38 — Inactive suppliers (e.g. the deactivated duplicate
  // records a merge leaves behind) must never be a selectable
  // allocation target, matching the `chartOfAccounts.filter(...)`
  // active-only convention immediately below.
  const supplierOptions = suppliers.filter((s) => s.status === "Active").map((s) => ({
    value: `s:${s.id}`, label: s.supplierCode || s.name, sublabel: s.name, group: "Suppliers",
    searchText: `${s.supplierCode} ${s.name} ${s.alternativeNames.join(" ")}`,
  }));
  // Finding #218 (RC-7) — active accounts only, matching Purchasing's PO/Bill line picker convention.
  // Phase 27 — Production Readiness Audit, Part 3: also exclude control
  // accounts (Debtors/Creditors — `isControlAccount`, the same DB flag
  // the AI classification candidate list already excludes on, see
  // `evidence-builder.ts`). These are subsidiary-ledger rollup totals
  // maintained by Matching/Invoicing, never a valid direct posting
  // target from a bank transaction — unlike the AI's own narrower
  // NEVER_CANDIDATE_DESCRIPTIONS denylist (Bank/VAT/Suspense/Retained
  // Income), which doesn't apply here: a human accountant can have a
  // real, legitimate reason to manually select those (e.g. an
  // inter-account transfer's other Bank account, or genuinely parking
  // an unclear item in Suspense) — only the control-account rollups are
  // never a legitimate manual target either.
  const glOptions = chartOfAccounts.filter((a) => a.isActive && !a.isControlAccount).map((a) => ({
    value: `g:${a.accountCode}`, label: a.accountCode, sublabel: a.description, group: "General Ledger",
    searchText: `${a.accountCode} ${a.description}`,
  }));
  // Phase 26G, Part L — always the last General Ledger option (never
  // filtered out by the fuzzy search, since it has no useful
  // searchText of its own to match against beneficiary/GL text) so
  // it's reachable however the accountant got here: browsing, or
  // having typed a code that doesn't exist yet.
  glOptions.push({ value: ADD_NEW_GL_ACCOUNT_VALUE, label: "+ Add General Ledger Account", sublabel: "", group: "General Ledger", searchText: "add general ledger account new" });
  if (type === "G") return glOptions;
  if (type === "S") return supplierOptions;
  if (type === "C") return customerOptions;
  return [...customerOptions, ...supplierOptions, ...glOptions];
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
  onRequestAddAccount,
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
  /** Phase 26G, Part L — opens the "+ Add General Ledger Account" modal
   * for this row. Only reachable when Type is General Ledger (or not yet
   * chosen), matching where the synthetic option itself appears below. */
  onRequestAddAccount: () => void;
  cellRef: (el: HTMLInputElement | null) => void;
}) {
  // UX-008 correction — once Type is chosen, the lookup narrows to
  // exactly that one category (typing "spar" after selecting G must
  // search the Chart of Accounts only, never Customers/Suppliers again).
  // Type stays unified across all three (Customers, Suppliers, General
  // Ledger, in that fixed group order) only while it hasn't been chosen
  // yet — picking a result from the unified list is what sets Type in
  // the first place. Values are prefixed by category ("g:440000"/"c:12"/
  // "s:7") since a GL code and a supplier id are otherwise not
  // guaranteed unique against each other.
  const options: ComboboxOption<string>[] = useMemo(
    () => buildAccountCodeOptions(edit.type, { chartOfAccounts, suppliers, customers }),
    [chartOfAccounts, suppliers, customers, edit.type],
  );

  const value = edit.type === "G" ? (edit.accountCode ? `g:${edit.accountCode}` : null) : edit.type === "S" ? (edit.supplierId !== null ? `s:${edit.supplierId}` : null) : edit.type === "C" ? (edit.customerId !== null ? `c:${edit.customerId}` : null) : null;

  const placeholder =
    edit.type === "G" ? "Search GL Account…" : edit.type === "C" ? "Search Customer…" : edit.type === "S" ? "Search Supplier…" : "Search customer, supplier, or GL account…";
  const invalidMessage = edit.type === "G" ? "GL account is required." : edit.type === "S" ? "Supplier is required." : edit.type === "C" ? "Customer is required." : "Type is required.";

  return (
    <Combobox
      value={value}
      options={options}
      disabled={disabled}
      invalid={invalid}
      invalidMessage={invalidMessage}
      suggested={suggested}
      onAcceptSuggestion={onAcceptSuggestion}
      inputRef={cellRef}
      placeholder={placeholder}
      aria-label="Account"
      onCommit={(val) => {
        if (val === null) return;
        if (val === ADD_NEW_GL_ACCOUNT_VALUE) {
          onRequestAddAccount();
          return;
        }
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
export function rulePreviewText(
  t: BankTransactionRecord,
  edit: PendingRowEdit,
  chartOfAccounts: ChartOfAccount[],
  suppliers: Supplier[],
  customers: MinimalCustomer[],
  ruleOptions: RuleCreationOptions | null,
): string {
  const account = accountDescriptionFor(edit, chartOfAccounts, suppliers, customers) || "—";
  const typeLabel = edit.type === "G" ? "GL" : edit.type === "C" ? "Customer" : edit.type === "S" ? "Supplier" : "—";
  // Phase 29 — reflects whatever the accountant actually confirmed in
  // `SetRuleModal` (match type + edited search text), not always a
  // hardcoded "Contains <full beneficiary>" — falls back to that only
  // defensively, since the checkbox can no longer be checked without
  // going through the modal first.
  const matchLabel = ruleOptions ? MATCH_TYPE_LABELS[ruleOptions.matchType] : "Contains";
  const matchValue = ruleOptions ? ruleOptions.matchDescription : t.beneficiary;
  // Phase 31B — "the user must clearly understand the difference between
  // Transaction Description / Rule Search Text / Beneficiary." Naming
  // the actual matched field in the preview (not just showing the text)
  // is what makes that difference visible at a glance.
  const matchFieldLabel = ruleOptions ? (ruleOptions.matchField === "description" ? "Description" : "Beneficiary") : "Beneficiary";
  const lines = [
    `Rule: ${matchLabel} "${matchValue}" (matching ${matchFieldLabel})`,
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
  onEdit,
  preview,
}: {
  cellRef: (el: HTMLInputElement | null) => void;
  checked: boolean;
  disabled: boolean;
  duplicate: string | null;
  onChange: (checked: boolean) => void;
  /** Phase 29A — "Click Set Rule again → reopen the existing pending
   * Rule Creation options... preserve the current pending search text
   * and Match Type." A native checkbox only has two states — clicking
   * an already-checked one always fires `onChange(false)`, so there's
   * no way to distinguish "reopen to edit" from "turn off" through the
   * checkbox alone. Reusing the existing "i" preview button as a real
   * click target (it already only renders once a rule is pending) keeps
   * this to one extra prop and zero new UI elements — the checkbox
   * itself still only ever toggles on/off. */
  onEdit: () => void;
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
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="flex h-4 w-4 items-center justify-center rounded-full bg-vf-info/16 text-[10px] font-bold text-vf-info"
          aria-label="Edit this pending rule's search text and match type"
          title="Click to edit the search text and match type before saving"
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

/** Phase 31A — the transaction's own Description/Narration
 * (`ae_bank_transactions.description`), now directly editable — the row's
 * previous read-only "Description" cell was a clickable link that opened
 * the Merchant Intelligence panel, so that trigger moves to a small
 * adjacent button (same compact-icon-button pattern as `SetRuleCell`'s
 * "i" preview trigger just above) rather than being lost.
 *
 * Deliberately NOT part of the Type→Account→VAT→Notes→Set Rule keyboard
 * chain (`tabIndex={-1}`, no `registerCellRef`) — that chain is optimized
 * for "tab through a whole imported statement fast," a workflow that
 * touches Type/Account/VAT on nearly every row but rarely needs the
 * description itself corrected. It's still a real, focusable `<input>`,
 * so native Tab still reaches it, and the row's existing blur-commit
 * (`handleRowBlur`) picks up a description edit exactly like any other
 * field once focus leaves the row. */
function DescriptionCell({
  value,
  disabled,
  onChange,
  onViewMerchant,
}: {
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
  /** `null` when there's nothing to view (empty description) — matches
   * the old read-only cell's own "if (!c.getValue()) return '—'" guard. */
  onViewMerchant: (() => void) | null;
}) {
  return (
    <div className="flex items-center gap-1">
      <Input
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Transaction description"
        className="min-w-0 border-transparent bg-transparent px-2 py-1.5 text-sm focus:border-vf-red-500 focus:bg-vf-paper"
      />
      {onViewMerchant && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onViewMerchant();
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-vf-info/16 text-[10px] font-bold text-vf-info"
          aria-label="View merchant intelligence"
          title="View merchant intelligence"
        >
          i
        </button>
      )}
    </div>
  );
}

/** Phase 31 — "Save Selected" lives in the bulk-action bar (rendered by
 * `TransactionExplorer`, a sibling of this grid), but the dirty-edit state
 * it needs to act on (`pendingEdits`) is, and must remain, local to this
 * grid — moving it up would be a much larger, riskier state-lifting
 * refactor for no benefit. `useImperativeHandle` is the standard, minimal
 * React answer for "a parent needs to trigger an imperative action a
 * child already owns the state for."
 *
 * This project is on React 19 — `ref` is accepted as a plain prop on a
 * regular function component (confirmed by direct experiment: wrapping
 * this component in `forwardRef<Handle, Props>(...)` silently dropped ALL
 * prop type-checking on every call site, including missing-required-prop
 * and unknown-prop errors — `forwardRef`'s type in this React version
 * does not compose the way it used to). No `forwardRef` needed or used. */
export type TransactionGridHandle = {
  saveSelected: (selectedIds: number[]) => Promise<BulkSaveSummary>;
  /** Drop pending edits the grid will never accept, so the toolbar's
   * pending count can actually reach zero. Discards only — never writes. */
  discardEdits: (ids: number[]) => void;
};

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
  error,
  onRetry,
  highlightedIds,
  suppliers,
  customers,
  chartOfAccounts,
  vatTreatments,
  onAllocateRow,
  onBulkAllocate,
  onCheckDuplicateRule,
  onMerchantClick,
  onSplitTransaction,
  onPendingEditsChange,
  onGlAccountCreated,
  ref,
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
  /** Phase 43 — production defect: a failed transaction-list fetch and a
   * genuinely empty result were previously indistinguishable ("No
   * transactions match the current filters." rendered for BOTH), so a
   * transient failure looked identical to "there's nothing here" —
   * exactly the misleading state the user reported. Non-null means the
   * most recent list fetch failed; takes precedence over the empty-state
   * message below, and over rendering any (necessarily stale/incomplete)
   * previous `transactions` — the accountant should never be shown or
   * act on a page that MIGHT not reflect the real current filter. */
  error?: string | null;
  /** Re-issues the exact request that just failed — never a silent
   * reset of filters/cursor back to page 1. */
  onRetry?: () => void;
  /** Pilot Review Round 1, Phase 6 — "Highlight auto-allocated rows" the
   * moment a newly-created Banking Rule scans and allocates the rest of
   * an imported statement, so the accountant can see (and, per "Allow
   * manual override," still click into) exactly what just changed. */
  highlightedIds?: Set<number>;
  suppliers: Supplier[];
  customers: MinimalCustomer[];
  chartOfAccounts: ChartOfAccount[];
  vatTreatments: VatTreatment[];
  onAllocateRow: (
    transaction: BankTransactionRecord,
    input: AllocateRowPayload,
    ruleOptions: RuleCreationOptions | null,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onBulkAllocate: (transactionIds: number[], input: AllocateRowPayload) => Promise<boolean>;
  onCheckDuplicateRule: (
    transaction: BankTransactionRecord,
    ruleType: "GL" | "Customer" | "Supplier",
    actions: { actionType: string; targetId?: number; targetText?: string }[],
    ruleOptions: RuleCreationOptions,
  ) => Promise<string | null>;
  onMerchantClick: (transaction: BankTransactionRecord) => void;
  /** Master Implementation Tracker — Programme 2, Epic E2, Finding #085. */
  onSplitTransaction: (transaction: BankTransactionRecord) => void;
  /** Phase 44 — production defect: "+ Add General Ledger Account" used to
   * rely on the parent's `router.refresh()` to make a newly-created
   * account visible, which forced a full page-level server reload and
   * tree reconcile (the confirmed cause of a reported browser hang). The
   * parent now owns `chartOfAccounts` as local state; this reports the
   * created account straight up so it can be appended instantly, with no
   * page reload at all. */
  onGlAccountCreated?: (account: ChartOfAccount) => void;
  /** Master Implementation Tracker — Epic E11, Finding #224 (RC-9). A
   * touched-but-not-yet-committed row (Type chosen, allocation not yet
   * complete) previously scrolled out of view — and its edit along with
   * it — the moment a filter/sort/page change refetched `transactions`,
   * with no warning. The parent uses this to gate those actions on a
   * confirmation instead of silently discarding the edit. Phase 31 —
   * also reports the dirty ids themselves (not just the count) so the
   * parent can compute how many of the CURRENTLY SELECTED rows are dirty,
   * for the new "Save Selected" button's enabled state/label. */
  onPendingEditsChange?: (count: number, dirtyIds: Set<number>, triage: { committableIds: Set<number>; blocked: BlockedPendingEdit[] }) => void;
  /** Phase 31 — React 19 ref-as-prop (see the doc comment on
   * `TransactionGridHandle` above for why this isn't `forwardRef`). */
  ref?: Ref<TransactionGridHandle>;
}) {
  const data = useMemo(() => transactions, [transactions]);

  const [pendingEdits, setPendingEdits] = useState<Map<number, PendingRowEdit>>(new Map());
  // Phase 46 (see `transaction-grid.test.tsx`, "infinite render loop fix")
  // is the reason `transactions` is deliberately NOT a dependency of this
  // effect: `transactions` gets a fresh array identity on every parent
  // render, and re-firing this callback on every parent render is exactly
  // the self-sustaining loop that froze the page in production. The
  // triage still needs the CURRENT rows, so they are read through a ref.
  const transactionsRef = useRef(transactions);
  useEffect(() => {
    onPendingEditsChange?.(pendingEdits.size, new Set(pendingEdits.keys()), triagePendingEdits(pendingEdits, transactionsRef.current));
  }, [pendingEdits, onPendingEditsChange]);
  useEffect(() => {
    transactionsRef.current = transactions;
    // Re-triage only when there is actually something pending to re-triage
    // — with no pending edits the result is empty whatever the rows are,
    // so an idle page never calls back merely because it re-rendered.
    if (pendingEdits.size === 0) return;
    onPendingEditsChange?.(pendingEdits.size, new Set(pendingEdits.keys()), triagePendingEdits(pendingEdits, transactions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions]);
  useEffect(() => {
    setPendingEdits((prev) => prunePendingEdits(prev, transactions));
  }, [transactions]);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [duplicateRuleNames, setDuplicateRuleNames] = useState<Map<number, string | null>>(new Map());
  // Phase 26G — "+ Add General Ledger Account" (Part L). Tracks which
  // row's Account Code cell requested it, plus whatever the user had
  // already typed (so a code they typed with no match pre-fills the
  // create form instead of being lost). Rendered once at the grid level,
  // not per-row, since only one can ever be open at a time.
  const [addAccountModal, setAddAccountModal] = useState<{ transactionId: number; initialCode: string } | null>(null);
  // Phase 29 — "Set Rule is not sufficient... the user must be able to
  // edit the Rule Search Text before saving." Ticking the checkbox opens
  // this modal (transaction id only, resolved to the actual transaction
  // at render time — same pattern as `addAccountModal` above) instead of
  // immediately firing a hardcoded `{ matchDescription: t.beneficiary,
  // matchType: "contains" }` duplicate-check/rule. The user's final,
  // possibly-edited `RuleCreationOptions` is kept here per row so
  // `commitRow` can use it (instead of a hardcoded literal) when the row
  // is actually saved — the rule itself is still only created on commit,
  // unchanged from before.
  const [ruleModalTransactionId, setRuleModalTransactionId] = useState<number | null>(null);
  const [ruleOptionsByTransaction, setRuleOptionsByTransaction] = useState<Map<number, RuleCreationOptions>>(new Map());
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
  // Phase 31A — `description` excluded from Ctrl+D's replay, same
  // reasoning as `allocationNotes`/`setRule`: it's transaction-specific,
  // never something that should silently propagate onto a different row.
  // "Repeat the last allocation" deliberately excludes
  // `overrideSupplierInvoiceMatching`: an override is a per-transaction
  // accounting judgement about one specific payment, not a coding pattern
  // to propagate. Copying it onto the next row would assert something the
  // accountant never said about that transaction.
  const [lastAllocation, setLastAllocation] = useState<Omit<
    PendingRowEdit,
    "allocationNotes" | "setRule" | "description" | "overrideSupplierInvoiceMatching"
  > | null>(null);
  // "17 similar transactions found. Apply allocation?" — distinct from
  // `sessionSuggestions` (which quietly pre-fills same-beneficiary rows):
  // this is the louder, explicit prompt for rows that share the
  // reference, description, or amount instead, surfaced once per commit
  // and dismissible.
  const [similarPrompt, setSimilarPrompt] = useState<{ sourceId: number; matchingIds: number[]; edit: PendingRowEdit } | null>(null);
  const [applyingSimilar, setApplyingSimilar] = useState(false);
  const cellRefs = useRef<Array<Array<HTMLElement | null>>>([]);

  function getEdit(t: BankTransactionRecord): PendingRowEdit {
    const pending = pendingEdits.get(t.id);
    if (pending) return pending;
    const suggestion = sessionSuggestions.get(t.id);
    // Phase 31A — a session suggestion proposes ONE shared GL/VAT
    // allocation to every sibling row sharing a beneficiary (the SAME
    // suggestion object is stored under every matching id) — but a
    // description is never shared across different transactions the way
    // a GL account can be. Without this override, every sibling would
    // display the SOURCE row's description instead of its own the moment
    // a suggestion existed for it — description always resolves to this
    // row's own current value, suggestion or not.
    if (suggestion) return { ...suggestion, description: t.description ?? "" };
    return initialEdit(t);
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

  /** Phase 28, Part 10 — `editOverride` lets `acceptAiSuggestion` below
   * commit a row WITHOUT first routing through `pendingEdits` (and the
   * async `setState` that would introduce — a caller reading
   * `pendingEdits.get(t.id)` immediately after `updateEdit()` would still
   * see the PREVIOUS state, since React state updates aren't
   * synchronous). Every other caller is unaffected — they all still
   * commit whatever's genuinely in `pendingEdits`, unchanged. */
  async function commitRow(t: BankTransactionRecord, editOverride?: PendingRowEdit): Promise<{ ok: true } | { ok: false; reason: string }> {
    const edit = editOverride ?? pendingEdits.get(t.id);
    if (!edit) return { ok: false, reason: "No changes to save" };
    if (savingIds.has(t.id)) return { ok: false, reason: "Already saving" };

    const eligibility = computeCommitEligibility(edit, t);
    if (!eligibility.ok) return eligibility;

    setSavingIds((prev) => new Set(prev).add(t.id));
    const ruleOptions = ruleOptionsForCommit(edit, t, ruleOptionsByTransaction);

    const result = await onAllocateRow(
      t,
      {
        type: edit.type,
        accountCode: edit.type === "G" ? edit.accountCode.trim() : null,
        supplierId: edit.type === "S" ? edit.supplierId : null,
        customerId: edit.type === "C" ? edit.customerId : null,
        vatCode: edit.vatCode.trim() || null,
        allocationNotes: edit.allocationNotes,
        description: computeDescriptionUpdate(edit, t),
        // Only sent when it actually differs from what is stored, so an
        // ordinary allocation commit never rewrites (or clears) an
        // override the accountant set earlier.
        overrideSupplierInvoiceMatching:
          edit.overrideSupplierInvoiceMatching === t.overrideSupplierInvoiceMatching ? null : edit.overrideSupplierInvoiceMatching,
      },
      ruleOptions,
    );

    setSavingIds((prev) => {
      const next = new Set(prev);
      next.delete(t.id);
      return next;
    });
    if (result.ok) {
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
      setRuleOptionsByTransaction((prev) => {
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
      return { ok: true };
    }
    return { ok: false, reason: result.error };
  }

  /** Phase 31 — "Save Selected." Deliberately reuses `commitRow` (the
   * SAME per-row write path individual Save/blur/Accept already use) for
   * every dirty selected row — never a second save engine, never a
   * shared payload across rows (each row keeps its own `pendingEdits`
   * entry, so a heterogeneous batch of different GL accounts/VAT
   * codes/notes saves correctly). Each row is its own independent HTTP
   * request → independent server validation → independent guarded
   * UPDATE, so one row's validation failure or posted-transaction block
   * can never roll back or block any other row — "atomic per
   * transaction" falls out of this for free, without a shared DB
   * transaction that would need one. `runWithConcurrencyLimit` bounds how
   * many of those requests are in flight at once so a 100-row selection
   * never fires 100 simultaneous requests. Rows already mid-save (e.g.
   * the accountant also clicked that row's own Save button) are treated
   * as not-dirty-right-now rather than re-submitted — `commitRow` itself
   * would refuse them anyway (`savingIds.has(t.id)`), so excluding them
   * up front just avoids a guaranteed "Already saving" failure entry.
   * `commitRow` itself (like every other function in this component) is
   * redefined every render rather than wrapped in `useCallback`, so this
   * factory necessarily re-runs every render too once it's listed as a
   * dependency — a lightweight `{ saveSelected }` object re-creation,
   * not a functional cost. */
  useImperativeHandle(
    ref,
    () => ({
      async saveSelected(selectedIds: number[]): Promise<BulkSaveSummary> {
        const dirtyIds = selectDirtyIds(selectedIds, pendingEdits).filter((id) => !savingIds.has(id));
        const unchangedCount = selectedIds.length - dirtyIds.length;
        if (dirtyIds.length === 0) return summarizeBulkSaveOutcomes([], unchangedCount);

        const outcomes = await runWithConcurrencyLimit(dirtyIds, BULK_SAVE_CONCURRENCY, async (id): Promise<BulkSaveOutcome> => {
          const t = transactions.find((x) => x.id === id);
          if (!t) return { id, ok: false, reason: "No longer visible on this page" };
          const result = await commitRow(t);
          return { id, ok: result.ok, reason: result.ok ? undefined : result.reason };
        });

        return summarizeBulkSaveOutcomes(outcomes, unchangedCount);
      },
      discardEdits(ids: number[]) {
        const drop = new Set(ids);
        setPendingEdits((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const id of drop) if (next.delete(id)) changed = true;
          return changed ? next : prev;
        });
        setRuleOptionsByTransaction((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const id of drop) if (next.delete(id)) changed = true;
          return changed ? next : prev;
        });
        setDuplicateRuleNames((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const id of drop) if (next.delete(id)) changed = true;
          return changed ? next : prev;
        });
      },
    }),
    [pendingEdits, savingIds, transactions, commitRow],
  );

  /** Phase 28, Part 10 — "Any auto allocation that did not come from a
   * rule must clearly show Accept." The forensic investigation found
   * AI-produced rows (`allocationMethod === "Future AI"`, whether
   * `allocationStatus` is `Allocated` or `Suggested`) rendered with no
   * way to distinguish "the AI decided this" from "a human confirmed
   * this" beyond a badge label — this gives the badge a real action.
   * Deliberately reuses `commitRow` (the SAME write path every other
   * allocation in this grid already goes through — `allocateRow` ->
   * `bulkAssignGl`/`bulkAssignSupplier`/`bulkAssignCustomer`, all
   * already `is_manual_override: true`) rather than a second endpoint:
   * accepting an AI suggestion is, and should be recorded as, a human
   * allocating a transaction — with the AI's own current values as the
   * starting point, changed or not. `getEdit(t)` already resolves to
   * `initialEdit(t)` (the AI's own suggestion) when nothing has been
   * pending-edited, so an Accept click with zero prior interaction
   * commits exactly what the AI proposed — but if the accountant DID
   * tweak the account first, the edited value commits instead, since
   * `getEdit` always reflects the current on-screen state. */
  async function acceptAiSuggestion(t: BankTransactionRecord) {
    await commitRow(t, getEdit(t));
  }

  async function applySimilarPrompt() {
    if (!similarPrompt) return;
    const { matchingIds, edit } = similarPrompt;
    if (edit.type === null) return;
    setApplyingSimilar(true);
    await onBulkAllocate(matchingIds, {
      type: edit.type,
      accountCode: edit.type === "G" ? edit.accountCode.trim() : null,
      supplierId: edit.type === "S" ? edit.supplierId : null,
      customerId: edit.type === "C" ? edit.customerId : null,
      vatCode: edit.vatCode.trim() || null,
      allocationNotes: "",
      description: null, // never propagate one transaction's description onto another
    });
    setApplyingSimilar(false);
    setSimilarPrompt(null);
  }

  /** Master Implementation Tracker — Programme 2, Epic E2, Finding #145.
   * Phase 29 — checking the box no longer immediately fires a
   * hardcoded-criterion duplicate check; it opens `SetRuleModal` so the
   * accountant can narrow the match text first. Unchecking still clears
   * everything immediately — no modal needed to turn Set Rule back off. */
  function handleSetRuleToggle(t: BankTransactionRecord, checked: boolean) {
    if (!checked) {
      updateEdit(t, { setRule: false });
      setRuleOptionsByTransaction((prev) => {
        if (!prev.has(t.id)) return prev;
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
      return;
    }
    setRuleModalTransactionId(t.id);
  }

  /** Phase 29 — fires when the accountant confirms the Set Rule modal
   * (possibly-edited search text/match type). Stores the final options
   * for `commitRow` to use when the row actually saves, marks the row's
   * Set Rule checkbox on, closes the modal, then re-runs the SAME
   * non-mutating duplicate pre-check the old checkbox-only flow already
   * did — now against the ACTUAL condition about to be created, not a
   * hardcoded one. */
  async function confirmSetRule(t: BankTransactionRecord, options: RuleCreationOptions) {
    setRuleOptionsByTransaction((prev) => new Map(prev).set(t.id, options));
    updateEdit(t, { setRule: true });
    setRuleModalTransactionId(null);
    const edit = getEdit(t);
    if (edit.type === null || isAllocationMissing(edit)) return;
    const payload: AllocateRowPayload = {
      type: edit.type,
      accountCode: edit.type === "G" ? edit.accountCode : null,
      supplierId: edit.type === "S" ? edit.supplierId : null,
      customerId: edit.type === "C" ? edit.customerId : null,
      vatCode: edit.vatCode || null,
      allocationNotes: edit.allocationNotes,
      description: null, // this payload only feeds ruleActionsFor (GL/Supplier/Customer/VAT) — never sent to the server
    };
    const duplicate = await onCheckDuplicateRule(t, ruleTypeFor(edit.type), ruleActionsFor(payload), options);
    setDuplicateRuleNames((prev) => new Map(prev).set(t.id, duplicate));
  }

  function cancelSetRuleModal() {
    setRuleModalTransactionId(null);
  }

  /** Phase 29 — Section 1: "there must be an obvious SAVE/UPDATE action"
   * AND a way to back out of one. Discards whatever is in `pendingEdits`
   * for this row (and any rule options/duplicate-check result gathered
   * for it) without writing anything — the row reverts to showing its
   * last-saved server value (`initialEdit`/`sessionSuggestions` via
   * `getEdit`), exactly as if the accountant had never touched it. */
  function cancelEdit(t: BankTransactionRecord) {
    setPendingEdits((prev) => {
      if (!prev.has(t.id)) return prev;
      const next = new Map(prev);
      next.delete(t.id);
      return next;
    });
    setRuleOptionsByTransaction((prev) => {
      if (!prev.has(t.id)) return prev;
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
      helper.display({
        id: "description", size: 220, header: "Description",
        cell: ({ row }) => {
          const t = row.original;
          const edit = getEdit(t);
          return (
            <DescriptionCell
              value={edit.description}
              disabled={savingIds.has(t.id)}
              onChange={(next) => updateEdit(t, { description: next })}
              onViewMerchant={t.description ? () => onMerchantClick(t) : null}
            />
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
          const missing = isAllocationMissing(edit);
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
              onRequestAddAccount={() => setAddAccountModal({ transactionId: t.id, initialCode: edit.accountCode })}
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
              disabled={savingIds.has(t.id) || isAllocationMissing(edit)}
              duplicate={duplicate ?? null}
              onChange={(checked) => handleSetRuleToggle(t, checked)}
              onEdit={() => setRuleModalTransactionId(t.id)}
              preview={edit.setRule ? rulePreviewText(t, edit, chartOfAccounts, suppliers, customers, ruleOptionsByTransaction.get(t.id) ?? null) : null}
            />
          );
        },
      }),
      // Phase 29, Section 1/9 — "there must be an obvious SAVE/UPDATE
      // action... the user should never have to search around the screen
      // to find SAVE, UPDATE, SET RULE, CANCEL." The row-commit machinery
      // (`commitRow`) already existed and already worked (blur, Accept,
      // keyboard) — the actual gap was that it had no visible button of
      // its own. `pendingEdits.has(t.id)` is true only for a row with a
      // REAL, user-touched, not-yet-saved edit (never for a row merely
      // showing an untouched `sessionSuggestions` proposal or its
      // server-loaded `initialEdit` — see `getEdit`), so Save/Cancel only
      // appear exactly when there is something to save or discard.
      // tabIndex={-1} on both buttons, like Split beside them — an
      // occasional click action, not part of the Type→Account→VAT→
      // Notes→Set Rule tab sequence (blur/Tab/Enter still commit too).
      helper.display({
        id: "save", size: 110, header: "Save",
        cell: ({ row }) => {
          const t = row.original;
          if (!pendingEdits.has(t.id)) return null;
          const edit = getEdit(t);
          const saving = savingIds.has(t.id);
          const incomplete = isAllocationMissing(edit);
          return (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                tabIndex={-1}
                disabled={saving || incomplete}
                title={incomplete ? "Choose an account/supplier/customer before saving" : "Save this transaction's accounting changes"}
                onClick={(e) => {
                  e.stopPropagation();
                  void commitRow(t);
                }}
                className="rounded-md border border-vf-red-500 bg-vf-red-500 px-2 py-1 text-xs font-medium text-white hover:bg-vf-red-600 disabled:cursor-not-allowed disabled:border-vf-paper-border disabled:bg-transparent disabled:text-vf-ink-faint"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                tabIndex={-1}
                disabled={saving}
                title="Discard these unsaved changes"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelEdit(t);
                }}
                className="rounded-md border border-vf-paper-border px-2 py-1 text-xs text-vf-ink-soft hover:border-vf-red-500 hover:text-vf-red-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          );
        },
      }),
      // Master Implementation Tracker — Programme 2, Epic E2, Finding
      // #085. The backend has fully supported split allocation for a
      // while (`SplitTransactionForm`, already used from Matching's
      // Review Queue) but Transaction Explorer's own grid had no entry
      // point into it at all. Not part of the keyboard-nav cellRefs
      // chain (tabIndex={-1}) — it's an occasional action, not a field
      // in the Type→Account→VAT→Notes→Set Rule tab sequence.
      helper.display({
        id: "split", size: 70, header: "Split",
        cell: ({ row }) => {
          const t = row.original;
          return (
            <button
              type="button"
              tabIndex={-1}
              disabled={t.journalId !== null}
              title={t.journalId !== null ? "Already journaled — cannot split" : "Split this transaction across multiple GL accounts"}
              onClick={(e) => {
                e.stopPropagation();
                onSplitTransaction(t);
              }}
              className="rounded-md border border-vf-paper-border px-2 py-1 text-xs text-vf-ink-soft hover:border-vf-red-500 hover:text-vf-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Split
            </button>
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
      // The account the SOURCE said this transaction belongs to — for the
      // Xero migration, the export's own "Related Account" column, e.g.
      // "3030 - Bank Charges, 820 - VAT". It is the evidence an
      // accountant classifies from, and it was previously held in the
      // database (`ae_bank_transactions.gl_account`) but rendered
      // nowhere, which left an imported-but-unclassified transaction
      // with no visible clue as to what it was. Deliberately read-only
      // and deliberately separate from the "GL Account" column below:
      // that one is VYRON's own allocation, which the accountant owns
      // and may set to something quite different. Off by default like
      // the other reference columns — enable it from the column chooser.
      helper.accessor("glAccount", {
        id: "sourceGlAccount", size: 220, header: "Source Account (as imported)",
        cell: (c) => (c.getValue()?.trim() ? <span className="text-vf-ink-soft">{c.getValue()}</span> : "—"),
      }),
      helper.accessor("suggestedGlAccount", { id: "glAccount", size: 160, header: "GL Account", cell: (c) => c.getValue() ?? "—" }),
      helper.accessor("suggestedVatCode", { id: "vatTreatment", size: 130, header: "VAT Treatment", cell: (c) => c.getValue() ?? "—" }),
      // Supplier Invoice Matching Override — an explicit, per-transaction
      // accounting decision. Editing it here marks the row dirty like any
      // other inline edit, so "Update Allocated" commits it in bulk; the
      // accountant never has to open transactions one at a time. Shown
      // only where the requirement actually applies (a supplier payment),
      // so it never invites a meaningless tick on a customer receipt.
      helper.display({
        id: "overrideInvoiceMatch", size: 200, header: "Override Supplier Invoice Matching",
        cell: ({ row }) => {
          const t = row.original;
          if (!isSubjectToSupplierInvoiceMatching(t)) return <span className="text-vf-ink-faint">n/a</span>;
          if (t.postedFlag || t.reconciliationId !== null) {
            return <span className="text-vf-ink-faint">{t.overrideSupplierInvoiceMatching ? "Overridden" : "—"}</span>;
          }
          const edit = getEdit(t);
          return (
            <label className="flex items-center gap-1.5 text-xs text-vf-ink-soft">
              <input
                type="checkbox"
                checked={edit.overrideSupplierInvoiceMatching}
                aria-label="Override Supplier Invoice Matching"
                disabled={savingIds.has(t.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => updateEdit(t, { overrideSupplierInvoiceMatching: e.target.checked })}
              />
              {t.matchedBillId !== null ? "Invoice linked" : "No invoice"}
            </label>
          );
        },
      }),
      helper.display({
        id: "allocationStatus", size: 190, header: "Matching Status",
        cell: ({ row }) => {
          const t = row.original;
          const edit = getEdit(t);
          const touched = pendingEdits.has(t.id);
          const missing = isAllocationMissing(edit);
          const { label, tone } = computeMatchStatus(t, touched, missing);
          return (
            <div className="flex items-center gap-1.5">
              <Badge tone={tone}>{label}</Badge>
              {needsAiAcceptAction(t) && (
                <button
                  type="button"
                  disabled={savingIds.has(t.id) || missing}
                  title={missing ? "Missing a valid account — open this row to fix it before accepting." : "Confirm the AI's suggestion as your own allocation"}
                  onClick={(e) => {
                    e.stopPropagation();
                    void acceptAiSuggestion(t);
                  }}
                  className="rounded-md border border-vf-paper-border px-2 py-0.5 text-xs font-medium text-vf-ink-soft hover:border-vf-red-500 hover:text-vf-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {savingIds.has(t.id) ? "Accepting…" : "Accept"}
                </button>
              )}
            </div>
          );
        },
      }),
      // Bank Accounting Posting — the workflow state, kept deliberately
      // separate from "Matching Status" above. Matching Status answers
      // "do we know what this transaction is?"; this answers "has it
      // entered the General Ledger?" — and assigning a GL account
      // answers only the first of those two questions.
      helper.display({
        id: "postingStatus", size: 140, header: "Posting Status",
        cell: ({ row }) => {
          const status = transactionPostingStatus(row.original);
          return <Badge tone={POSTING_STATUS_TONE[status]}>{status}</Badge>;
        },
      }),
      helper.accessor("rulesTriggered", {
        id: "rulesApplied", size: 200, header: "Rule Applied",
        cell: (c) => (c.getValue().length > 0 ? c.getValue().join(", ") : "—"),
      }),
      // Bank Accounting Posting — this used to render "Draft" for ANY
      // transaction carrying a `journalId`, which after posting exists
      // meant a fully posted transaction displayed as a draft journal.
      // The journal's real state is now read from `postedFlag`, the flag
      // the posting engine itself sets.
      helper.display({
        id: "journalStatus", size: 120, header: "Journal Status",
        cell: ({ row }) => {
          const t = row.original;
          if (t.journalId === null) return "—";
          return t.postedFlag ? <Badge tone="good">Posted</Badge> : <Badge tone="info">Draft</Badge>;
        },
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
    [pendingEdits, savingIds, duplicateRuleNames, sessionSuggestions, chartOfAccounts, vatTreatments, suppliers, customers, onMerchantClick, onSplitTransaction],
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
    // UX-020 — kept in sync with the tighter `py-2` row padding just
    // below (row height dropped from the previous ~49px estimate);
    // must match the real rendered height or virtualization's scroll
    // math drifts.
    estimateSize: () => 41,
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
      if (selectedIds.length > 0 && edit.type !== null) {
        void onBulkAllocate(selectedIds, {
          type: edit.type,
          accountCode: edit.type === "G" ? edit.accountCode.trim() : null,
          supplierId: edit.type === "S" ? edit.supplierId : null,
          customerId: edit.type === "C" ? edit.customerId : null,
          vatCode: edit.vatCode.trim() || null,
          allocationNotes: "",
          description: null, // never propagate one transaction's description onto another
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
    // UX-006/UX-007 — "Processing Mode... grid should occupy roughly
    // 85–90% of available browser height... the grid is the product."
    // `h-full min-h-0` lets this component fill whatever height its
    // parent (`TransactionExplorer`) allocates to it, instead of
    // growing to its content's natural height — the scroll container
    // below is what actually turns that into a fixed-height, internally
    // scrolling grid via its own `flex-1 min-h-0`.
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
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
      <div ref={scrollContainerRef} onKeyDownCapture={handleGridKeyDown} className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-vf-md">
    <Table ref={tableWrapperRef} onScroll={handleTableScroll} hideScrollbar>
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
        {/* Phase 43 — three genuinely distinct states, not two: a failed
         * fetch (`error` non-null) is checked BEFORE the empty-result
         * check, so it can never render as "No transactions match the
         * current filters." — the exact production defect reported. */}
        {loading ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="py-8 text-center text-vf-ink-faint">
              Loading transactions…
            </TableCell>
          </TableRow>
        ) : error ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="py-8 text-center">
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-vf-danger">Unable to load transactions. {error}</p>
                {onRetry && (
                  <Button variant="subtle" size="sm" onClick={onRetry}>
                    Retry
                  </Button>
                )}
              </div>
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
                        // UX-020 — "maximise visible rows without sacrificing
                        // readability." Only overrides `ui/table.tsx`'s
                        // shared `py-3` default within THIS grid (every
                        // other table in the app keeps its normal row
                        // height) — `py-2` brings read-only cells close to
                        // the already-tight editable cells (`p-1` wrapper +
                        // each control's own `py-1.5`) instead of the read
                        // side dominating the row height.
                        className={cn(pinned && "z-[1] bg-vf-paper", isNewColumn ? "p-1" : "py-2")}
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
      {addAccountModal && (() => {
        const target = transactions.find((t) => t.id === addAccountModal.transactionId);
        if (!target) return null;
        return (
          <AddGlAccountModal
            companyId={target.companyId}
            initialAccountCode={addAccountModal.initialCode}
            onClose={() => setAddAccountModal(null)}
            onCreated={(account) => {
              updateEdit(target, { type: "G", accountCode: account.accountCode, supplierId: null, customerId: null });
              onGlAccountCreated?.(account);
            }}
          />
        );
      })()}
      {ruleModalTransactionId !== null && (() => {
        const target = transactions.find((t) => t.id === ruleModalTransactionId);
        if (!target) return null;
        const edit = getEdit(target);
        return (
          <SetRuleModal
            transaction={target}
            currentDescription={edit.description}
            accountLabel={accountDescriptionFor(edit, chartOfAccounts, suppliers, customers)}
            accountTypeLabel={accountTypeLabelFor(edit.type)}
            vatCode={edit.vatCode}
            initialOptions={
              ruleOptionsByTransaction.get(target.id) ?? {
                // Phase 31B — opening Set Rule fresh (no prior edit for
                // this transaction) defaults to matching the CURRENT
                // description, per the explicit requirement: the whole
                // point of editing a description is to have a clean,
                // generalisable starting point for a rule. Still 100%
                // user-editable/overridable via the new "Match against"
                // selector — this is only the initial default.
                matchField: "description",
                matchDescription: edit.description,
                matchType: "contains",
                // Phase 51 — production defect: this used to default to
                // true, silently sweeping the whole company the moment a
                // rule was created — see the Phase 50 forensic report.
                applyToRemaining: false,
                applyToFutureImports: true,
              }
            }
            onConfirm={(options) => void confirmSetRule(target, options)}
            onCancel={cancelSetRuleModal}
          />
        );
      })()}
    </div>
  );
}

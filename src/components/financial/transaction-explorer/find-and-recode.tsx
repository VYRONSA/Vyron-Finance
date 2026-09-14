"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select, FIELD_BASE } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/badge";
import { ConfirmActionRow, useConfirmTarget } from "@/components/ui/confirm-action";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { computeMatchStatus } from "./transaction-grid";
import { glAccountOptions, vatCodeOptions } from "@/lib/account-picker-options";
import type { AllocationStatus, BankTransactionRecord, Supplier, TransactionExplorerFilters } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatTreatment } from "@/server/company-management/types";
import { formatAmount } from "@/lib/format";

type MinimalCustomer = { id: number; name: string };

type FilterDraft = {
  dateFrom: string;
  dateTo: string;
  description: string;
  reference: string;
  minAmount: string;
  maxAmount: string;
  bankAccountId: string;
  glAccount: string;
  supplierId: string;
  customerId: string;
  statuses: AllocationStatus[];
  aiClassifiedOnly: boolean;
  hasRule: "" | "yes" | "no";
  manualOverrideOnly: boolean;
  needsReviewOnly: boolean;
};

const EMPTY_DRAFT: FilterDraft = {
  dateFrom: "",
  dateTo: "",
  description: "",
  reference: "",
  minAmount: "",
  maxAmount: "",
  bankAccountId: "",
  glAccount: "",
  supplierId: "",
  customerId: "",
  statuses: [],
  aiClassifiedOnly: false,
  hasRule: "",
  manualOverrideOnly: false,
  needsReviewOnly: false,
};

const ALL_STATUSES: AllocationStatus[] = ["Matched", "Allocated", "Suggested", "Unallocated"];

type RecodePreview = {
  matchingCount: number;
  eligibleCount: number;
  postedCount: number;
  estimatedAffectedValue: number;
  currentAccountBreakdown: { currentAccount: string | null; count: number; totalValue: number }[];
  sample: BankTransactionRecord[];
  newGlAccount: { accountCode: string; description: string };
};

// Phase 25G — Supplier/Customer recode. Same preview shape as GL recode
// (matchingCount/eligibleCount/postedCount/estimatedAffectedValue/sample),
// just a different "current X" breakdown and "new X" target.
type RecodeSupplierPreview = {
  matchingCount: number;
  eligibleCount: number;
  postedCount: number;
  estimatedAffectedValue: number;
  currentSupplierBreakdown: { currentSupplierId: number | null; currentSupplierName: string | null; count: number; totalValue: number }[];
  sample: BankTransactionRecord[];
  newSupplier: { id: number; name: string };
};

type RecodeCustomerPreview = {
  matchingCount: number;
  eligibleCount: number;
  postedCount: number;
  estimatedAffectedValue: number;
  currentCustomerBreakdown: { currentCustomerId: number | null; currentCustomerName: string | null; count: number; totalValue: number }[];
  sample: BankTransactionRecord[];
  newCustomer: { id: number; name: string };
};

type RecodeVatPreview = {
  matchingCount: number;
  eligibleCount: number;
  postedCount: number;
  estimatedAffectedValue: number;
  currentVatBreakdown: { currentVatCode: string | null; count: number; totalValue: number }[];
  sample: BankTransactionRecord[];
  newVatTreatment: { code: string; name: string };
};

type RecodeTarget = "gl" | "supplier" | "customer" | "vat";

const RECODE_TARGET_LABELS: Record<RecodeTarget, string> = {
  gl: "GL Account",
  supplier: "Supplier",
  customer: "Customer",
  vat: "VAT Treatment",
};

/** Phase 49 — the Current GL account SEARCH filter had no way to return
 * to "Any" once a real account was picked: `Combobox` has no built-in
 * concept of a "clear selection" option, and this filter's `value` prop
 * already represents "no filter" as `null` (see `draft.glAccount || null`
 * below), so there was nothing in the actual options LIST a user could
 * click to get back there — only the (non-obvious, unlabeled) Reset
 * button reset it. This is a real, closed list entry — not a cosmetic
 * placeholder — using the exact sentinel-value pattern this codebase
 * already establishes for a synthetic Combobox option
 * (`ADD_NEW_GL_ACCOUNT_VALUE` in transaction-grid.tsx): a value no real
 * account code can ever collide with, special-cased in `onCommit` to
 * write the SAME empty-string "no filter" representation
 * `draftToFilters`/Reset already use — no second state system. Recode
 * TARGET pickers (New GL Account) deliberately do NOT get this: you
 * must recode TO a real account, "Any" has no meaning there. */
const ANY_GL_ACCOUNT_VALUE = "__any__";

/** Normalizes whichever of the three preview shapes above into one
 * common shape for display — the underlying data/endpoints stay
 * genuinely distinct (see find-and-recode-service.ts), this is purely a
 * presentation convenience so the confirm panel doesn't need three
 * near-identical render branches. */
type UnifiedRecodePreview = {
  matchingCount: number;
  eligibleCount: number;
  postedCount: number;
  estimatedAffectedValue: number;
  sample: BankTransactionRecord[];
  newTargetLabel: string;
  breakdown: { label: string; count: number; totalValue: number }[];
};

function toUnifiedPreview(target: RecodeTarget, preview: RecodePreview | RecodeSupplierPreview | RecodeCustomerPreview | RecodeVatPreview): UnifiedRecodePreview {
  const base = { matchingCount: preview.matchingCount, eligibleCount: preview.eligibleCount, postedCount: preview.postedCount, estimatedAffectedValue: preview.estimatedAffectedValue, sample: preview.sample };
  if (target === "gl") {
    const p = preview as RecodePreview;
    return { ...base, newTargetLabel: `${p.newGlAccount.accountCode} — ${p.newGlAccount.description}`, breakdown: p.currentAccountBreakdown.map((g) => ({ label: g.currentAccount ?? "Unallocated", count: g.count, totalValue: g.totalValue })) };
  }
  if (target === "supplier") {
    const p = preview as RecodeSupplierPreview;
    return { ...base, newTargetLabel: p.newSupplier.name, breakdown: p.currentSupplierBreakdown.map((g) => ({ label: g.currentSupplierName ?? "Unassigned", count: g.count, totalValue: g.totalValue })) };
  }
  if (target === "customer") {
    const p = preview as RecodeCustomerPreview;
    return { ...base, newTargetLabel: p.newCustomer.name, breakdown: p.currentCustomerBreakdown.map((g) => ({ label: g.currentCustomerName ?? "Unassigned", count: g.count, totalValue: g.totalValue })) };
  }
  const p = preview as RecodeVatPreview;
  return { ...base, newTargetLabel: `${p.newVatTreatment.code} — ${p.newVatTreatment.name}`, breakdown: p.currentVatBreakdown.map((g) => ({ label: g.currentVatCode ?? "None", count: g.count, totalValue: g.totalValue })) };
}

type RecodeOutcome = {
  requested: number;
  recoded: number;
  skipped: { transactionId: number; reason: string }[];
};

type RecodeSelection = { mode: "ids"; transactionIds: number[] } | { mode: "all-matching"; filters: TransactionExplorerFilters };

function money(value: number): string {
  return formatAmount(value);
}

// Phase 25F — Saved Filter Presets. A preset stores exactly the same
// `TransactionExplorerFilters` object this page already builds and
// sends to its own search/preview/commit endpoints — no second filter
// representation.
export type FindAndRecodePresetSummary = { id: number; name: string; filters: TransactionExplorerFilters };

/** The reverse of `draftToFilters` — reconstructs the editable draft
 * form state from a saved (or otherwise already-real) filter object,
 * used only to populate the controls when a preset is applied. Never
 * invents a filter the source object didn't already express. */
function filtersToDraft(filters: TransactionExplorerFilters): FilterDraft {
  return {
    dateFrom: filters.dateFrom ?? "",
    dateTo: filters.dateTo ?? "",
    description: filters.description ?? "",
    reference: filters.reference ?? "",
    minAmount: filters.minAmount !== null ? String(filters.minAmount) : "",
    maxAmount: filters.maxAmount !== null ? String(filters.maxAmount) : "",
    bankAccountId: filters.bankAccountId !== null ? String(filters.bankAccountId) : "",
    glAccount: filters.glAccount ?? "",
    supplierId: filters.supplierId !== null && filters.supplierId !== undefined ? String(filters.supplierId) : "",
    customerId: filters.customerId !== null && filters.customerId !== undefined ? String(filters.customerId) : "",
    statuses: filters.statuses ?? [],
    aiClassifiedOnly: (filters.allocationMethods ?? []).includes("Future AI"),
    hasRule: filters.hasRule === true ? "yes" : filters.hasRule === false ? "no" : "",
    manualOverrideOnly: filters.manualOverrideOnly ?? false,
    needsReviewOnly: filters.needsReviewOnly ?? false,
  };
}

function draftToFilters(draft: FilterDraft): TransactionExplorerFilters {
  return {
    search: null,
    dateFrom: draft.dateFrom || null,
    dateTo: draft.dateTo || null,
    minAmount: draft.minAmount ? Number(draft.minAmount) : null,
    maxAmount: draft.maxAmount ? Number(draft.maxAmount) : null,
    statuses: draft.statuses.length > 0 ? draft.statuses : null,
    bankAccountId: draft.bankAccountId ? Number(draft.bankAccountId) : null,
    importBatch: null,
    duplicateOnly: false,
    unknownSupplierOnly: false,
    sortBy: "transactionDate",
    sortDirection: "desc",
    description: draft.description || null,
    reference: draft.reference || null,
    glAccount: draft.glAccount || null,
    supplierId: draft.supplierId ? Number(draft.supplierId) : null,
    customerId: draft.customerId ? Number(draft.customerId) : null,
    allocationMethods: draft.aiClassifiedOnly ? ["Future AI"] : null,
    hasRule: draft.hasRule === "yes" ? true : draft.hasRule === "no" ? false : null,
    manualOverrideOnly: draft.manualOverrideOnly,
    needsReviewOnly: draft.needsReviewOnly,
  };
}

function filtersToQuery(filters: TransactionExplorerFilters): string {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.minAmount !== null) params.set("minAmount", String(filters.minAmount));
  if (filters.maxAmount !== null) params.set("maxAmount", String(filters.maxAmount));
  for (const s of filters.statuses ?? []) params.append("status", s);
  if (filters.bankAccountId !== null) params.set("bankAccountId", String(filters.bankAccountId));
  if (filters.description) params.set("description", filters.description);
  if (filters.reference) params.set("reference", filters.reference);
  if (filters.glAccount) params.set("glAccount", filters.glAccount);
  if (filters.supplierId !== null && filters.supplierId !== undefined) params.set("supplierId", String(filters.supplierId));
  if (filters.customerId !== null && filters.customerId !== undefined) params.set("customerId", String(filters.customerId));
  for (const m of filters.allocationMethods ?? []) params.append("allocationMethod", m);
  if (filters.hasRule !== null && filters.hasRule !== undefined) params.set("hasRule", String(filters.hasRule));
  if (filters.manualOverrideOnly) params.set("manualOverrideOnly", "true");
  if (filters.needsReviewOnly) params.set("needsReviewOnly", "true");
  params.set("sortBy", "transactionDate");
  params.set("sortDirection", "desc");
  params.set("pageSize", "100");
  return params.toString();
}

export function FindAndRecode({
  companyId,
  previewMode,
  bankAccounts,
  chartOfAccounts,
  suppliers,
  customers,
  vatTreatments,
  initialPresets,
}: {
  companyId: string;
  previewMode: boolean;
  bankAccounts: { id: number; accountName: string }[];
  chartOfAccounts: ChartOfAccount[];
  suppliers: Supplier[];
  customers: MinimalCustomer[];
  vatTreatments: VatTreatment[];
  initialPresets: FindAndRecodePresetSummary[];
}) {
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_DRAFT);
  const [appliedFilters, setAppliedFilters] = useState<TransactionExplorerFilters | null>(null);
  const [results, setResults] = useState<BankTransactionRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);

  // Phase 25G — the "Recode to" target can be a GL account, a supplier,
  // or a customer. Switching target never clears the other targets'
  // picked values, so flipping back and forth doesn't lose work.
  const [recodeTarget, setRecodeTarget] = useState<RecodeTarget>("gl");
  const [newGlAccount, setNewGlAccount] = useState<string | null>(null);
  const [newSupplierId, setNewSupplierId] = useState<string | null>(null);
  const [newCustomerId, setNewCustomerId] = useState<string | null>(null);
  const [newVatCode, setNewVatCode] = useState<string | null>(null);

  const [preview, setPreview] = useState<RecodePreview | RecodeSupplierPreview | RecodeCustomerPreview | RecodeVatPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [outcome, setOutcome] = useState<RecodeOutcome | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  // Phase 25F — Saved Filter Presets state.
  const [presets, setPresets] = useState<FindAndRecodePresetSummary[]>(initialPresets);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [renamingPresetId, setRenamingPresetId] = useState<number | null>(null);
  const [renamePresetNameValue, setRenamePresetNameValue] = useState("");
  const [presetActionLoading, setPresetActionLoading] = useState(false);
  const [presetActionError, setPresetActionError] = useState<string | null>(null);
  const deleteConfirm = useConfirmTarget<number>();

  const glOptions = useMemo(() => glAccountOptions(chartOfAccounts), [chartOfAccounts]);
  const vatOptions = useMemo(() => vatCodeOptions(vatTreatments), [vatTreatments]);
  // Phase 49 — see `ANY_GL_ACCOUNT_VALUE`'s own doc comment. "Any" listed
  // first so it's what a user browsing the closed list (no query typed)
  // sees at the top, matching every other filter's own "Any" convention.
  const glFilterOptions = useMemo(
    () => [{ value: ANY_GL_ACCOUNT_VALUE, label: "Any", sublabel: "", searchText: "any" }, ...glOptions],
    [glOptions],
  );
  const selection: RecodeSelection | null = selectAllMatching
    ? appliedFilters
      ? { mode: "all-matching", filters: appliedFilters }
      : null
    : selectedIds.size > 0
      ? { mode: "ids", transactionIds: [...selectedIds] }
      : null;

  function updateDraft<K extends keyof FilterDraft>(key: K, value: FilterDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function toggleStatus(status: AllocationStatus) {
    setDraft((prev) => ({ ...prev, statuses: prev.statuses.includes(status) ? prev.statuses.filter((s) => s !== status) : [...prev.statuses, status] }));
  }

  /** The one place a search actually runs — used both by the Search
   * button (with the live draft) and by Apply Preset (with the preset's
   * stored filters), so applying a preset always executes the exact same
   * search mechanism the page already uses, never a second endpoint. */
  async function runSearchWithFilters(filters: TransactionExplorerFilters) {
    if (previewMode) return;
    setSearching(true);
    setSearchError(null);
    setPreview(null);
    setOutcome(null);
    setSelectedIds(new Set());
    setSelectAllMatching(false);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions?${filtersToQuery(filters)}`);
      const body = await res.json();
      if (!res.ok) {
        setSearchError(body.error ?? `Search failed (${res.status})`);
        return;
      }
      setAppliedFilters(filters);
      setResults(body.transactions ?? []);
      setHasMore(Boolean(body.hasMore));
      setHasSearched(true);
    } catch {
      setSearchError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setSearching(false);
    }
  }

  async function runSearch() {
    await runSearchWithFilters(draftToFilters(draft));
  }

  async function handleSavePreset() {
    const name = newPresetName.trim();
    if (!name) return;
    setPresetActionLoading(true);
    setPresetActionError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/find-and-recode-presets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, filters: draftToFilters(draft) }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPresetActionError(body.error ?? `Save failed (${res.status})`);
        return;
      }
      setPresets((prev) => [...prev, body.preset].sort((a, b) => a.name.localeCompare(b.name)));
      setNewPresetName("");
      setSaveDialogOpen(false);
    } catch {
      setPresetActionError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setPresetActionLoading(false);
    }
  }

  async function handleApplyPreset() {
    const preset = presets.find((p) => String(p.id) === selectedPresetId);
    if (!preset) return;
    setDraft(filtersToDraft(preset.filters));
    await runSearchWithFilters(preset.filters);
  }

  async function handleRenamePreset(presetId: number) {
    const name = renamePresetNameValue.trim();
    if (!name) return;
    setPresetActionLoading(true);
    setPresetActionError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/find-and-recode-presets/${presetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPresetActionError(body.error ?? `Rename failed (${res.status})`);
        return;
      }
      setPresets((prev) => prev.map((p) => (p.id === presetId ? body.preset : p)).sort((a, b) => a.name.localeCompare(b.name)));
      setRenamingPresetId(null);
    } catch {
      setPresetActionError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setPresetActionLoading(false);
    }
  }

  async function handleDeletePreset(presetId: number) {
    setPresetActionLoading(true);
    setPresetActionError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/find-and-recode-presets/${presetId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        setPresetActionError(body.error ?? `Delete failed (${res.status})`);
        return;
      }
      setPresets((prev) => prev.filter((p) => p.id !== presetId));
      if (selectedPresetId === String(presetId)) setSelectedPresetId("");
      deleteConfirm.cancel();
    } catch {
      setPresetActionError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setPresetActionLoading(false);
    }
  }

  function toggleRow(id: number) {
    if (selectAllMatching) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectAllMatching(false);
    setSelectedIds(new Set(results.map((t) => t.id)));
  }

  function clearSelection() {
    setSelectAllMatching(false);
    setSelectedIds(new Set());
  }

  // Phase 25G — the current target value for whichever recode kind is
  // selected, and the exact (endpoint suffix, request body key) pair
  // each kind's preview/commit routes expect. Kept in one place so
  // runPreview/runCommit never have to duplicate this branching.
  const currentTargetValue = recodeTarget === "gl" ? newGlAccount : recodeTarget === "supplier" ? newSupplierId : recodeTarget === "customer" ? newCustomerId : newVatCode;

  function recodeRequestShape(): { endpointSuffix: string; bodyKey: string; bodyValue: string | number } | null {
    if (recodeTarget === "gl") return newGlAccount ? { endpointSuffix: "", bodyKey: "newGlAccountCode", bodyValue: newGlAccount } : null;
    if (recodeTarget === "supplier") return newSupplierId ? { endpointSuffix: "-supplier", bodyKey: "newSupplierId", bodyValue: Number(newSupplierId) } : null;
    if (recodeTarget === "customer") return newCustomerId ? { endpointSuffix: "-customer", bodyKey: "newCustomerId", bodyValue: Number(newCustomerId) } : null;
    return newVatCode ? { endpointSuffix: "-vat", bodyKey: "newVatCode", bodyValue: newVatCode } : null;
  }

  async function runPreview() {
    const shape = recodeRequestShape();
    if (!selection || !shape) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    setOutcome(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/find-and-recode/preview${shape.endpointSuffix}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection, [shape.bodyKey]: shape.bodyValue }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPreviewError(body.error ?? `Preview failed (${res.status})`);
        return;
      }
      setPreview(body.preview);
      setConfirming(true);
    } catch {
      setPreviewError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function runCommit() {
    const shape = recodeRequestShape();
    if (!selection || !shape) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/find-and-recode/commit${shape.endpointSuffix}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection, [shape.bodyKey]: shape.bodyValue }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCommitError(body.error ?? `Recode failed (${res.status})`);
        return;
      }
      // Phase 46 — this used to call `setOutcome(body.outcome)` BEFORE
      // `runSearch()`, but `runSearch` (via `runSearchWithFilters`)
      // synchronously calls `setOutcome(null)` of its own before its
      // first `await` — both updates land in the same React batch, so
      // the outcome banner was being set and immediately wiped before it
      // could ever actually render. Setting it AFTER the refresh
      // completes is what makes the result genuinely visible.
      setConfirming(false);
      setPreview(null);
      clearSelection();
      await runSearch();
      setOutcome(body.outcome);
    } catch {
      setCommitError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setCommitting(false);
    }
  }

  const selectionCount = selectAllMatching ? null : selectedIds.size;

  return (
    <div className="flex flex-col gap-4">
      {/* SAVED FILTER PRESETS */}
      <div className="flex flex-col gap-2 rounded-vf-lg bg-vf-paper p-4 shadow-vf-paper-lg sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-vf-ink-soft" htmlFor="find-and-recode-preset-select">
            Saved Filters
          </label>
          <Select
            id="find-and-recode-preset-select"
            className="min-w-[200px]"
            value={selectedPresetId}
            onChange={(e) => setSelectedPresetId(e.target.value)}
          >
            <option value="">{presets.length === 0 ? "No saved filters yet" : "Select a saved filter…"}</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button variant="subtle" size="sm" disabled={!selectedPresetId || previewMode || searching} onClick={handleApplyPreset}>
            Apply
          </Button>
          <Button
            variant="subtle"
            size="sm"
            disabled={!selectedPresetId}
            onClick={() => {
              const preset = presets.find((p) => String(p.id) === selectedPresetId);
              if (!preset) return;
              setRenamingPresetId(preset.id);
              setRenamePresetNameValue(preset.name);
            }}
          >
            Rename
          </Button>
          <Button
            variant="subtle"
            size="sm"
            disabled={!selectedPresetId}
            onClick={() => {
              const preset = presets.find((p) => String(p.id) === selectedPresetId);
              if (!preset) return;
              deleteConfirm.request(preset.id);
            }}
          >
            Delete
          </Button>
          <span className="mx-1 h-4 w-px bg-vf-paper-border" />
          <Button variant="subtle" size="sm" disabled={previewMode} onClick={() => setSaveDialogOpen((v) => !v)}>
            Save Filter
          </Button>
          {presetActionError && <span className="text-sm text-vf-danger">{presetActionError}</span>}
        </div>

        {saveDialogOpen && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Preset name"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              className="min-w-[200px]"
            />
            <Button variant="primary" size="sm" disabled={!newPresetName.trim() || presetActionLoading} onClick={handleSavePreset}>
              {presetActionLoading ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => {
                setSaveDialogOpen(false);
                setNewPresetName("");
              }}
            >
              Cancel
            </Button>
          </div>
        )}

        {renamingPresetId !== null && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="New name"
              value={renamePresetNameValue}
              onChange={(e) => setRenamePresetNameValue(e.target.value)}
              className="min-w-[200px]"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={!renamePresetNameValue.trim() || presetActionLoading}
              onClick={() => handleRenamePreset(renamingPresetId)}
            >
              {presetActionLoading ? "Renaming…" : "Rename"}
            </Button>
            <Button variant="subtle" size="sm" onClick={() => setRenamingPresetId(null)}>
              Cancel
            </Button>
          </div>
        )}

        {selectedPresetId && deleteConfirm.isConfirming(Number(selectedPresetId)) && (
          <ConfirmActionRow
            layout="inline"
            tone="danger"
            loading={presetActionLoading}
            confirmLabel="Delete preset"
            confirmingLabel="Deleting…"
            message="Delete this saved filter? This can't be undone."
            onConfirm={() => handleDeletePreset(Number(selectedPresetId))}
            onCancel={deleteConfirm.cancel}
          />
        )}
      </div>

      {/* SEARCH */}
      <div className="flex flex-col gap-3 rounded-vf-lg bg-vf-paper p-4 shadow-vf-paper-lg sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-soft">Date from</label>
            <Input type="date" value={draft.dateFrom} onChange={(e) => updateDraft("dateFrom", e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-soft">Date to</label>
            <Input type="date" value={draft.dateTo} onChange={(e) => updateDraft("dateTo", e.target.value)} />
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-vf-ink-soft">Description contains</label>
            <Input placeholder="e.g. SHELL" value={draft.description} onChange={(e) => updateDraft("description", e.target.value)} />
          </div>
          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-vf-ink-soft">Reference contains</label>
            <Input value={draft.reference} onChange={(e) => updateDraft("reference", e.target.value)} />
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-vf-ink-soft">Min amount</label>
            <Input type="number" value={draft.minAmount} onChange={(e) => updateDraft("minAmount", e.target.value)} />
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-vf-ink-soft">Max amount</label>
            <Input type="number" value={draft.maxAmount} onChange={(e) => updateDraft("maxAmount", e.target.value)} />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <label className="mb-1 block text-xs font-medium text-vf-ink-soft">Bank account</label>
            <Select value={draft.bankAccountId} onChange={(e) => updateDraft("bankAccountId", e.target.value)}>
              <option value="">Any</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountName}
                </option>
              ))}
            </Select>
          </div>
          {/* Phase 47 — production defect: a selected GL account was
           * being written to state and sent in the search request
           * correctly (confirmed directly, not assumed) — the actual
           * problem was purely visual. `Combobox`'s default input styling
           * (`bg-transparent`/`border-transparent`) was built for
           * embedding in a dense Transaction Explorer grid cell, where
           * blending into the cell is correct; here, next to `Select`
           * fields with a solid `bg-vf-paper` background and a visible
           * border/shadow, a genuinely-selected value had no visible
           * affordance that it was there at all — reading as faded,
           * disabled, or reverted to the placeholder even though the
           * underlying text and state were always correct. `inputClassName`
           * (new, opt-in — every other Combobox caller is unaffected)
           * gives this one the same solid `FIELD_BASE` treatment its
           * sibling fields already have. */}
          <div className="min-w-[200px]">
            <label className="mb-1 block text-xs font-medium text-vf-ink-soft">Current GL account</label>
            <Combobox
              className="min-w-[200px]"
              inputClassName={FIELD_BASE}
              value={draft.glAccount || null}
              options={glFilterOptions}
              placeholder="Any"
              aria-label="Current GL account filter"
              onCommit={(val) => updateDraft("glAccount", val === ANY_GL_ACCOUNT_VALUE ? "" : (val ?? ""))}
            />
          </div>
          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-vf-ink-soft">Supplier</label>
            <Select value={draft.supplierId} onChange={(e) => updateDraft("supplierId", e.target.value)}>
              <option value="">Any</option>
              {/* Phase 38 — Inactive suppliers must not appear as a
               * selectable filter value. */}
              {suppliers.filter((s) => s.status === "Active").map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-vf-ink-soft">Customer</label>
            <Select value={draft.customerId} onChange={(e) => updateDraft("customerId", e.target.value)}>
              <option value="">Any</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-vf-ink-soft">Banking Rule</label>
            <Select value={draft.hasRule} onChange={(e) => updateDraft("hasRule", e.target.value as FilterDraft["hasRule"])}>
              <option value="">Any</option>
              <option value="yes">Created by a rule</option>
              <option value="no">Not rule-created</option>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-vf-ink-soft">
          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="sr-only">Allocation status</legend>
            {ALL_STATUSES.map((s) => (
              <label key={s} className="flex items-center gap-1.5">
                <input type="checkbox" checked={draft.statuses.includes(s)} onChange={() => toggleStatus(s)} />
                {s}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={draft.aiClassifiedOnly} onChange={(e) => updateDraft("aiClassifiedOnly", e.target.checked)} />
            AI Classified only
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={draft.manualOverrideOnly} onChange={(e) => updateDraft("manualOverrideOnly", e.target.checked)} />
            Manual override only
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={draft.needsReviewOnly} onChange={(e) => updateDraft("needsReviewOnly", e.target.checked)} />
            Needs review only
          </label>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" disabled={previewMode || searching} onClick={runSearch}>
            {searching ? "Searching…" : "Search"}
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => {
              setDraft(EMPTY_DRAFT);
            }}
          >
            Reset
          </Button>
          {searchError && <span className="text-sm text-vf-danger">{searchError}</span>}
        </div>
      </div>

      {/*
       * REVIEW + SELECT + CHANGE & RECODE — Phase 46. Previously "Recode
       * to" was a SEPARATE box below the full results table (up to 100
       * rows), and the success/failure outcome banner rendered at the
       * very bottom of the page below that — a user had to scroll past
       * the entire results table twice to get from "found transactions"
       * to "recode them" to "see what happened." This merges selection,
       * the recode action, its confirmation, and its result into ONE
       * block that sits directly above the results table, so the whole
       * FIND → SELECT → CHOOSE TARGET → CHANGE & RECODE → RESULT workflow
       * is visible without scrolling past anything. The results table
       * itself is unchanged and stays right below, for reference.
       */}
      {hasSearched && (
        <div className="flex flex-col gap-3 rounded-vf-lg bg-vf-paper p-4 shadow-vf-paper-lg sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-vf-ink">
              {results.length} result{results.length === 1 ? "" : "s"} shown{hasMore ? " (more match — narrow your filters to see them all)" : ""}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="subtle" size="sm" disabled={results.length === 0} onClick={selectAllVisible}>
                Select all visible
              </Button>
              <Button
                variant="subtle"
                size="sm"
                disabled={results.length === 0}
                onClick={() => {
                  setSelectAllMatching(true);
                  setSelectedIds(new Set());
                }}
              >
                Select all matching
              </Button>
              <Button variant="subtle" size="sm" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          </div>

          {selectAllMatching && (
            <p className="text-xs text-vf-info">
              All transactions matching your filters will be selected — not just this page. The exact count will be shown before you
              confirm.
            </p>
          )}
          <p className="text-xs text-vf-ink-faint">
            {selectAllMatching ? "All matching transactions selected." : `${selectionCount} of ${results.length} visible transaction${results.length === 1 ? "" : "s"} selected.`}
          </p>

          {/* CHANGE & RECODE — always visible once a search has run, so
           * the full workflow shape is obvious immediately; the action
           * itself is disabled (with an explanatory message) until
           * something is selected. */}
          <div className="flex flex-col gap-2 rounded-vf-md border border-vf-paper-border bg-vf-canvas/40 p-3">
            <h2 className="text-sm font-semibold text-vf-ink">Change &amp; Recode</h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-vf-ink-soft">Change selected transactions to:</span>
              <Select
                aria-label="Recode target type"
                value={recodeTarget}
                onChange={(e) => {
                  setRecodeTarget(e.target.value as RecodeTarget);
                  setPreview(null);
                  setConfirming(false);
                }}
              >
                <option value="gl">GL Account</option>
                <option value="supplier">Supplier</option>
                <option value="customer">Customer</option>
                <option value="vat">VAT Treatment</option>
              </Select>
              {recodeTarget === "gl" && (
                <Combobox
                  className="min-w-[240px]"
                  inputClassName={FIELD_BASE}
                  value={newGlAccount}
                  options={glOptions}
                  placeholder="Select GL Account"
                  aria-label="New GL account"
                  onCommit={setNewGlAccount}
                />
              )}
              {recodeTarget === "supplier" && (
                <Select aria-label="New supplier" className="min-w-[200px]" value={newSupplierId ?? ""} onChange={(e) => setNewSupplierId(e.target.value || null)}>
                  <option value="">Select Supplier</option>
                  {/* Phase 38 — an Inactive supplier must never be a
                   * recode target; the server independently rejects this
                   * too (`requireCompanySupplier`), this is defense in depth. */}
                  {suppliers.filter((s) => s.status === "Active").map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
              {recodeTarget === "customer" && (
                <Select aria-label="New customer" className="min-w-[200px]" value={newCustomerId ?? ""} onChange={(e) => setNewCustomerId(e.target.value || null)}>
                  <option value="">Select Customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
              {recodeTarget === "vat" && (
                <Combobox
                  className="min-w-[240px]"
                  inputClassName={FIELD_BASE}
                  value={newVatCode}
                  options={vatOptions}
                  placeholder="Select VAT Treatment"
                  aria-label="New VAT treatment"
                  onCommit={setNewVatCode}
                />
              )}
              <Button variant="primary" size="sm" disabled={!selection || !currentTargetValue || previewLoading} onClick={runPreview}>
                {previewLoading ? "Building preview…" : "Change & Recode"}
              </Button>
            </div>
            {!selection && <p className="text-xs text-vf-ink-faint">Select at least one transaction to recode.</p>}
            {previewError && <span className="text-sm text-vf-danger">{previewError}</span>}

            {preview &&
              confirming &&
              (() => {
                const unified = toUnifiedPreview(recodeTarget, preview);
                return (
                  <ConfirmActionRow
                    layout="panel"
                    tone="primary"
                    loading={committing}
                    error={commitError}
                    confirmLabel="Change & Recode"
                    confirmingLabel="Recoding…"
                    onConfirm={runCommit}
                    onCancel={() => {
                      setConfirming(false);
                      setPreview(null);
                    }}
                    message={`Change & Recode ${unified.eligibleCount} transaction${unified.eligibleCount === 1 ? "" : "s"}? Current allocation will be changed to: ${RECODE_TARGET_LABELS[recodeTarget]} — ${unified.newTargetLabel}.`}
                    itemsPreview={
                      <div className="flex flex-col gap-2 text-xs text-vf-ink-soft">
                        <p>
                          {unified.matchingCount} transaction{unified.matchingCount === 1 ? "" : "s"} matched
                          {unified.postedCount > 0 && `, ${unified.postedCount} already posted and protected (skipped)`}. Estimated
                          affected value: R{money(unified.estimatedAffectedValue)}.
                        </p>
                        <ul className="flex flex-col gap-1">
                          {unified.breakdown.map((g, i) => (
                            <li key={`${g.label}-${i}`}>
                              From {g.label}: {g.count} transaction{g.count === 1 ? "" : "s"} (R{money(g.totalValue)})
                            </li>
                          ))}
                        </ul>
                        {unified.sample.length > 0 && (
                          <details>
                            <summary className="cursor-pointer">Show sample transactions ({unified.sample.length})</summary>
                            <ul className="mt-1 flex flex-col gap-1">
                              {unified.sample.map((t) => (
                                <li key={t.id}>
                                  {t.transactionDate} · {t.description} · R{money(t.debit || t.credit)}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    }
                  />
                );
              })()}

            {outcome && (
              <div className="flex flex-col gap-2 rounded-vf-md border border-vf-success/25 bg-vf-success/8 p-3 text-sm">
                {outcome.recoded === outcome.requested ? (
                  <p className="font-medium text-[#1f6e4b]">
                    ✓ {outcome.recoded} transaction{outcome.requested === 1 ? "" : "s"} successfully recoded.
                  </p>
                ) : (
                  <>
                    <p className="font-medium text-[#1f6e4b]">
                      {outcome.requested} selected · {outcome.recoded} recoded · {outcome.skipped.length} failed
                    </p>
                    {outcome.skipped.length > 0 && (
                      <p className="text-vf-ink-soft">{[...new Set(outcome.skipped.map((s) => s.reason))].join("; ")}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {results.length > 0 && (
            <Table>
              <TableHead>
                <tr>
                  <TableHeadCell />
                  <TableHeadCell>Date</TableHeadCell>
                  <TableHeadCell>Description</TableHeadCell>
                  <TableHeadCell>Reference</TableHeadCell>
                  <TableHeadCell>Amount</TableHeadCell>
                  <TableHeadCell>Current account</TableHeadCell>
                  <TableHeadCell>Status</TableHeadCell>
                </tr>
              </TableHead>
              <TableBody>
                {results.map((t) => {
                  const status = computeMatchStatus(t, false, false);
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectAllMatching || selectedIds.has(t.id)}
                          disabled={selectAllMatching}
                          onChange={() => toggleRow(t.id)}
                        />
                      </TableCell>
                      <TableCell>{t.transactionDate ?? "—"}</TableCell>
                      <TableCell>{t.description}</TableCell>
                      <TableCell>{t.reference || "—"}</TableCell>
                      <TableCell className="font-mono tabular-nums">{money(t.debit || t.credit)}</TableCell>
                      <TableCell>{t.suggestedGlAccount ?? "Unallocated"}</TableCell>
                      <TableCell>
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {t.journalId !== null && (
                          <Badge tone="muted" className="ml-1.5">
                            Posted
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}

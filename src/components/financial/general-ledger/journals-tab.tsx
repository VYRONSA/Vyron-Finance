"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmActionRow, useConfirmTarget } from "@/components/ui/confirm-action";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { IconChevronDown, IconChevronLeft, IconFileText, IconPlus } from "@/components/ui/icons";
import type { Journal, JournalStatus } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { Branch, CostCentre, Department } from "@/server/company-management/types";

const STATUS_OPTIONS: (JournalStatus | "All")[] = ["All", "Draft", "Submitted", "Approved", "Rejected", "Posted", "Cancelled"];
const JOURNAL_TYPES = ["Manual", "Recurring", "Accrual", "Reversing", "Year-end", "Adjustment", "Correction"];

const STATUS_TONE: Record<JournalStatus, "muted" | "info" | "good" | "danger"> = {
  Draft: "muted",
  Submitted: "info",
  Approved: "info",
  Rejected: "danger",
  Posted: "good",
  Cancelled: "muted",
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type EditableLine = { accountCode: string; debit: string; credit: string; description: string };

const BLANK_LINE: EditableLine = { accountCode: "", debit: "", credit: "", description: "" };

// Master Implementation Tracker — Epic E1, Finding #227. Journals
// carries no dimension columns of its own — a journal's "branch" is
// whichever branch its lines' accounts belong to (via
// `ChartOfAccount.branchId`/`departmentId`/`costCentreId`, the same
// dimension fields GL Inquiry already filters by). A journal matches a
// given dimension filter if ANY of its lines posts to an account
// carrying that dimension — matching how a real multi-line journal
// (e.g. one side to a Branch A expense account, the other to the shared
// Bank account) is understood to "touch" a branch. Pure and exported so
// this is directly unit-testable without a live database.
export function journalMatchesDimensions(
  journal: Journal,
  accountsByCode: Map<string, ChartOfAccount>,
  filters: { branchId: number | null; departmentId: number | null; costCentreId: number | null },
): boolean {
  if (!filters.branchId && !filters.departmentId && !filters.costCentreId) return true;
  return journal.lines.some((line) => {
    const account = accountsByCode.get(line.accountCode);
    if (!account) return false;
    if (filters.branchId && account.branchId !== filters.branchId) return false;
    if (filters.departmentId && account.departmentId !== filters.departmentId) return false;
    if (filters.costCentreId && account.costCentreId !== filters.costCentreId) return false;
    return true;
  });
}

function journalToLines(journal: Journal): EditableLine[] {
  return journal.lines.map((l) => ({
    accountCode: l.accountCode,
    debit: l.debit > 0 ? String(l.debit) : "",
    credit: l.credit > 0 ? String(l.credit) : "",
    description: l.description,
  }));
}

function JournalFormPanel({
  companyId,
  accounts,
  editing,
  onDone,
  onCancel,
}: {
  companyId: string;
  accounts: ChartOfAccount[];
  editing: Journal | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [journalDate, setJournalDate] = useState(editing?.journalDate ?? new Date().toISOString().slice(0, 10));
  const [journalType, setJournalType] = useState(editing?.journalType ?? "Manual");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [reference, setReference] = useState(editing?.reference ?? "");
  const [lines, setLines] = useState<EditableLine[]>(editing ? journalToLines(editing) : [{ ...BLANK_LINE }, { ...BLANK_LINE }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Master Implementation Tracker — Epic E11, Finding #198 (RC-9). A
  // snapshot taken once on mount — diffing against it (rather than
  // tracking a `dirty` flag on every individual field's onChange) covers
  // every field in this form, present and future, with one comparison.
  const [initialSnapshot] = useState(() => JSON.stringify({ journalDate, journalType, description, reference, lines }));
  useUnsavedChangesWarning(JSON.stringify({ journalDate, journalType, description, reference, lines }) !== initialSnapshot);

  const totalDebit = Math.round(lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0) * 100) / 100;
  const totalCredit = Math.round(lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0) * 100) / 100;
  const isBalanced = Math.abs(totalDebit - totalCredit) <= 0.01 && totalDebit > 0;

  // Findings #156/#218 (RC-7) — searchable Combobox instead of a plain
  // Select dumping the whole Chart of Accounts, filtered to active
  // accounts only (matching Purchasing's PO/Bill line picker convention).
  const accountOptions = useMemo(
    () => accounts.filter((a) => a.isActive).map((a) => ({ value: a.accountCode, label: `${a.accountCode} — ${a.description}` })),
    [accounts],
  );

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { ...BLANK_LINE }]);
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        journalDate,
        journalType,
        description,
        reference,
        lines: lines.map((l) => ({
          accountCode: l.accountCode,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description || description,
        })),
      };
      const url = editing
        ? `/api/companies/${companyId}/general-ledger/journals/${editing.id}`
        : `/api/companies/${companyId}/general-ledger/journals`;
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      onDone();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <p className="mb-3 text-sm font-semibold text-vf-ink">{editing ? `Edit ${editing.journalNumber}` : "New Journal"}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date" htmlFor="jr-date" required>
          <Input id="jr-date" type="date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} />
        </Field>
        <Field label="Type" htmlFor="jr-type" required>
          <Select id="jr-type" value={journalType} onChange={(e) => setJournalType(e.target.value)}>
            {JOURNAL_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Description" htmlFor="jr-desc" required className="lg:col-span-2">
          <Input id="jr-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Reference" htmlFor="jr-ref">
          <Input id="jr-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Lines</p>
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <div className="w-56">
              <Combobox
                aria-label={`Account for line ${i + 1}`}
                value={line.accountCode || null}
                options={accountOptions}
                placeholder="Search account…"
                onCommit={(val) => updateLine(i, { accountCode: val ?? "" })}
              />
            </div>
            <div className="w-32">
              <Input
                type="number"
                step="0.01"
                placeholder="Debit"
                aria-label={`Debit for line ${i + 1}`}
                value={line.debit}
                onChange={(e) => updateLine(i, { debit: e.target.value, credit: e.target.value ? "" : line.credit })}
              />
            </div>
            <div className="w-32">
              <Input
                type="number"
                step="0.01"
                placeholder="Credit"
                aria-label={`Credit for line ${i + 1}`}
                value={line.credit}
                onChange={(e) => updateLine(i, { credit: e.target.value, debit: e.target.value ? "" : line.debit })}
              />
            </div>
            <div className="min-w-[160px] flex-1">
              <Input placeholder="Line description (optional)" aria-label={`Description for line ${i + 1}`} value={line.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
            </div>
            <Button variant="subtle" size="sm" disabled={lines.length <= 2} onClick={() => removeLine(i)}>
              Remove
            </Button>
          </div>
        ))}
        <Button variant="subtle" size="sm" className="w-fit" onClick={addLine}>
          <IconPlus className="h-4 w-4" /> Add Line
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Badge tone={isBalanced ? "good" : "danger"}>{isBalanced ? "Balanced" : "Not Balanced"}</Badge>
        <span className="font-mono text-xs tabular-nums text-vf-ink-faint">
          Debit {money(totalDebit)} · Credit {money(totalCredit)}
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !isBalanced || !description.trim()} onClick={submit}>
          {editing ? "Save Changes" : "Create Draft Journal"}
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function AuditTrail({ journal }: { journal: Journal }) {
  const events: { label: string; by: string | null; at: string | null }[] = [
    { label: "Created", by: null, at: journal.createdAt },
    { label: "Submitted", by: journal.submittedBy, at: journal.submittedAt },
    { label: "Approved", by: journal.approvedBy, at: journal.approvedAt },
    { label: "Rejected", by: journal.rejectedBy, at: journal.rejectedAt },
    { label: "Cancelled", by: journal.cancelledBy, at: journal.cancelledAt },
    { label: "Posted", by: null, at: journal.postedAt },
  ].filter((e) => e.at !== null);

  return (
    <ol className="flex flex-col gap-1.5 text-xs text-vf-ink-faint">
      {events.map((e) => (
        <li key={e.label}>
          <span className="font-medium text-vf-ink">{e.label}</span>
          {e.by && ` by ${e.by}`} — {e.at && new Date(e.at).toLocaleString()}
        </li>
      ))}
      {journal.reversalOfJournalId !== null && <li>Reversal of journal #{journal.reversalOfJournalId}</li>}
      {journal.reversedByJournalId !== null && <li>Reversed by journal #{journal.reversedByJournalId}</li>}
    </ol>
  );
}

export function JournalsTab({
  companyId,
  journals,
  accounts,
  branches,
  departments,
  costCentres,
  previewMode,
}: {
  companyId: string;
  journals: Journal[];
  accounts: ChartOfAccount[];
  branches: Branch[];
  departments: Department[];
  costCentres: CostCentre[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkedJournalNumber = searchParams.get("journal");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("All");
  const [search, setSearch] = useState(deepLinkedJournalNumber ?? "");
  const [branchId, setBranchId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [costCentreId, setCostCentreId] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(
    deepLinkedJournalNumber ? (journals.find((j) => j.journalNumber === deepLinkedJournalNumber)?.id ?? null) : null,
  );
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [postingRun, setPostingRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ posted: number; skipped: { journalNumber: string; reason: string }[] } | null>(null);
  const [formState, setFormState] = useState<{ mode: "create" | "edit"; journal: Journal | null } | null>(null);
  // Master Implementation Tracker — Epic E1, Finding #102. "Post
  // Approved Journals" used to bulk-post every currently-Approved
  // journal in one click with no preview of what would actually be
  // posted. `approvedJournals` is derived from the same `journals` prop
  // already on the page — no extra round trip needed for the preview.
  // Finding #211 (RC-3): now built on the shared confirm primitive.
  const confirmPostRun = useConfirmTarget<true>();
  // Finding #192 (RC-3): GL Journal Reverse used to fire immediately on
  // click, with no confirmation, for an action that posts a real
  // offsetting journal.
  const confirmReverse = useConfirmTarget<number>();

  const journalsBase = `/api/companies/${companyId}/general-ledger/journals`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const approvedJournals = useMemo(() => journals.filter((j) => j.status === "Approved"), [journals]);

  const accountsByCode = useMemo(() => new Map(accounts.map((a) => [a.accountCode, a])), [accounts]);
  const dimensionFilters = useMemo(
    () => ({ branchId: branchId ? Number(branchId) : null, departmentId: departmentId ? Number(departmentId) : null, costCentreId: costCentreId ? Number(costCentreId) : null }),
    [branchId, departmentId, costCentreId],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return journals.filter((j) => {
      if (statusFilter !== "All" && j.status !== statusFilter) return false;
      if (!journalMatchesDimensions(j, accountsByCode, dimensionFilters)) return false;
      if (!term) return true;
      return (
        j.journalNumber.toLowerCase().includes(term) ||
        j.description.toLowerCase().includes(term) ||
        j.reference.toLowerCase().includes(term)
      );
    });
  }, [journals, statusFilter, search, accountsByCode, dimensionFilters]);

  async function runAction(journalId: number, action: "submit" | "approve" | "reject" | "cancel" | "reverse") {
    setLoadingId(journalId);
    setError(null);
    try {
      const res = await fetch(`${journalsBase}/${journalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      confirmReverse.cancel();
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoadingId(null);
    }
  }

  async function duplicateJournal(journalId: number) {
    setLoadingId(journalId);
    setError(null);
    try {
      const res = await fetch(`${journalsBase}/${journalId}/duplicate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoadingId(null);
    }
  }

  async function postApprovedJournals() {
    setPostingRun(true);
    setError(null);
    setRunResult(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/general-ledger/posting/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setRunResult({ posted: data.posted?.length ?? 0, skipped: data.skipped ?? [] });
      confirmPostRun.cancel();
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setPostingRun(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-44">
          <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_OPTIONS)[number])}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "All" ? "All Statuses" : s}</option>
            ))}
          </Select>
        </div>
        <div className="min-w-[200px] flex-1">
          <Input placeholder="Search journal #, description, reference…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search journals" />
        </div>
        <div className="w-40">
          <Select aria-label="Filter by branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">All Branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select aria-label="Filter by department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select aria-label="Filter by cost centre" value={costCentreId} onChange={(e) => setCostCentreId(e.target.value)}>
            <option value="">All Cost Centres</option>
            {costCentres.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
        <Button
          variant="subtle"
          size="sm"
          disabled={previewMode}
          title={disabledTitle}
          onClick={() => setFormState({ mode: "create", journal: null })}
        >
          <IconPlus className="h-4 w-4" /> New Journal
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={previewMode || postingRun || approvedJournals.length === 0}
          title={disabledTitle ?? (approvedJournals.length === 0 ? "No journals are currently Approved." : undefined)}
          onClick={() => confirmPostRun.request(true)}
        >
          Post Approved Journals{approvedJournals.length > 0 && ` (${approvedJournals.length})`}
        </Button>
      </div>

      {confirmPostRun.isConfirming(true) && (
        <ConfirmActionRow
          layout="panel"
          message={`Post ${approvedJournals.length} journal${approvedJournals.length === 1 ? "" : "s"} to the General Ledger?`}
          itemsPreview={
            <ul className="max-h-32 list-disc overflow-y-auto pl-5 font-mono text-xs">
              {approvedJournals.map((j) => (
                <li key={j.id}>
                  {j.journalNumber} — {j.journalDate} — {j.description || "(no description)"} — {money(j.totalDebit)}
                </li>
              ))}
            </ul>
          }
          confirmLabel="Confirm — Post Now"
          confirmingLabel="Posting…"
          loading={postingRun}
          onConfirm={postApprovedJournals}
          onCancel={confirmPostRun.cancel}
        />
      )}

      {formState && (
        <JournalFormPanel
          companyId={companyId}
          accounts={accounts}
          editing={formState.mode === "edit" ? formState.journal : null}
          onDone={() => {
            setFormState(null);
            router.refresh();
          }}
          onCancel={() => setFormState(null)}
        />
      )}

      {runResult && (
        <div className="rounded-vf-md border border-vf-paper-border p-3 text-sm">
          <p className="font-medium text-vf-ink">
            Posted {runResult.posted} journal{runResult.posted === 1 ? "" : "s"}
            {runResult.skipped.length > 0 && `, skipped ${runResult.skipped.length}`}.
          </p>
          {runResult.skipped.length > 0 && (
            <ul className="mt-1.5 list-disc pl-4 text-xs text-vf-ink-faint">
              {runResult.skipped.map((s, i) => (
                <li key={i}>{s.journalNumber}: {s.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No journals." description="No journals match the current filters." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>
                <span className="sr-only">Expand</span>
              </TableHeadCell>
              <TableHeadCell>Journal #</TableHeadCell>
              <TableHeadCell>Date</TableHeadCell>
              <TableHeadCell>Type</TableHeadCell>
              <TableHeadCell>Description</TableHeadCell>
              <TableHeadCell className="text-right">Debit</TableHeadCell>
              <TableHeadCell className="text-right">Credit</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right">
                <span className="sr-only">Actions</span>
              </TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map((j) => {
              const isExpanded = expandedId === j.id;
              return (
                <Fragment key={j.id}>
                  <TableRow>
                    <TableCell>
                      <button type="button" aria-label={isExpanded ? `Collapse ${j.journalNumber}` : `Expand ${j.journalNumber}`} onClick={() => setExpandedId(isExpanded ? null : j.id)} className="text-vf-ink-faint hover:text-vf-ink">
                        {isExpanded ? <IconChevronDown className="h-3.5 w-3.5" /> : <IconChevronLeft className="h-3.5 w-3.5" />}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-vf-ink">{j.journalNumber}</TableCell>
                    <TableCell>{j.journalDate}</TableCell>
                    <TableCell>{j.journalType}</TableCell>
                    <TableCell className="max-w-xs truncate">{j.description}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{j.totalDebit > 0 ? money(j.totalDebit) : ""}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{j.totalCredit > 0 ? money(j.totalCredit) : ""}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={STATUS_TONE[j.status]}>{j.status}</Badge>
                        {j.isReversed && <Badge tone="warn">Reversed</Badge>}
                        {j.reversalOfJournalId !== null && <Badge tone="muted">Reversal</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {j.status === "Draft" && (
                          <>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === j.id} title={disabledTitle} onClick={() => setFormState({ mode: "edit", journal: j })}>
                              Edit
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === j.id} title={disabledTitle} onClick={() => runAction(j.id, "submit")}>
                              Submit
                            </Button>
                          </>
                        )}
                        {j.status === "Submitted" && (
                          <>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === j.id} title={disabledTitle} onClick={() => runAction(j.id, "approve")}>
                              Approve
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === j.id} title={disabledTitle} onClick={() => runAction(j.id, "reject")}>
                              Reject
                            </Button>
                          </>
                        )}
                        {j.status === "Approved" && (
                          <Button variant="subtle" size="sm" disabled={previewMode || loadingId === j.id} title={disabledTitle} onClick={() => runAction(j.id, "cancel")}>
                            Cancel
                          </Button>
                        )}
                        {j.status === "Posted" && !j.isReversed && (
                          confirmReverse.isConfirming(j.id) ? (
                            <ConfirmActionRow
                              message="Reverse this journal? A new offsetting journal will be posted."
                              tone="danger"
                              confirmingLabel="Reversing…"
                              loading={loadingId === j.id}
                              onConfirm={() => runAction(j.id, "reverse")}
                              onCancel={confirmReverse.cancel}
                            />
                          ) : (
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === j.id} title={disabledTitle} onClick={() => confirmReverse.request(j.id)}>
                              Reverse
                            </Button>
                          )
                        )}
                        <Button variant="subtle" size="sm" disabled={previewMode || loadingId === j.id} title={disabledTitle} onClick={() => duplicateJournal(j.id)}>
                          Copy
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={9} className="bg-vf-paper-alt/40">
                        <div className="grid grid-cols-1 gap-4 py-2 lg:grid-cols-2">
                          <div>
                            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Lines</p>
                            <table className="w-full text-xs">
                              <tbody>
                                {j.lines.map((line) => (
                                  <tr key={line.id} className="border-b border-vf-paper-border/60">
                                    <td className="py-1 pr-2 font-mono text-vf-ink-faint">{line.accountCode}</td>
                                    <td className="py-1 pr-2 text-vf-ink-soft">{line.description}</td>
                                    <td className="py-1 pr-2 text-right font-mono tabular-nums">{line.debit > 0 ? money(line.debit) : ""}</td>
                                    <td className="py-1 text-right font-mono tabular-nums">{line.credit > 0 ? money(line.credit) : ""}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div>
                            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">History</p>
                            <AuditTrail journal={j} />
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

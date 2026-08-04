"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowDown, IconArrowUp, IconBookOpen, IconChevronDown, IconChevronLeft, IconPlus } from "@/components/ui/icons";
import type { AccountType, ChartOfAccount, ChartOfAccountNode, NormalBalance } from "@/server/general-ledger/types";

const ACCOUNT_TYPES: AccountType[] = ["Asset", "Liability", "Equity", "Income", "Cost of Sales", "Expense", "Other Income", "Other Expense"];
const NORMAL_BALANCES: NormalBalance[] = ["Debit", "Credit"];

type FormState = {
  accountCode: string;
  description: string;
  accountType: AccountType;
  category: string;
  normalBalance: NormalBalance;
  parentAccountId: string;
  reportingGroup: string;
  financialStatementGroup: string;
  taxTreatment: string;
  isControlAccount: boolean;
  notes: string;
};

const BLANK_FORM: FormState = {
  accountCode: "",
  description: "",
  accountType: "Asset",
  category: "",
  normalBalance: "Debit",
  parentAccountId: "",
  reportingGroup: "",
  financialStatementGroup: "",
  taxTreatment: "",
  isControlAccount: false,
  notes: "",
};

function accountToForm(account: ChartOfAccount): FormState {
  return {
    accountCode: account.accountCode,
    description: account.description,
    accountType: account.accountType,
    category: account.category,
    normalBalance: account.normalBalance,
    parentAccountId: account.parentAccountId !== null ? String(account.parentAccountId) : "",
    reportingGroup: account.reportingGroup,
    financialStatementGroup: account.financialStatementGroup,
    taxTreatment: account.taxTreatment,
    isControlAccount: account.isControlAccount,
    notes: account.notes,
  };
}

function flattenMatching(nodes: ChartOfAccountNode[], term: string): ChartOfAccount[] {
  const lower = term.toLowerCase();
  const out: ChartOfAccount[] = [];
  const walk = (list: ChartOfAccountNode[]) => {
    for (const node of list) {
      if (node.accountCode.toLowerCase().includes(lower) || node.description.toLowerCase().includes(lower)) {
        out.push(node);
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function ChartOfAccountsTab({
  companyId,
  accounts,
  accountTree,
  previewMode,
}: {
  companyId: string;
  accounts: ChartOfAccount[];
  accountTree: ChartOfAccountNode[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);
  const [duplicateCode, setDuplicateCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const apiBase = `/api/companies/${companyId}/general-ledger/chart-of-accounts`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  const matching = useMemo(() => (search.trim() ? flattenMatching(accountTree, search.trim()) : null), [accountTree, search]);

  function toggleCollapsed(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate() {
    setForm(BLANK_FORM);
    setEditingId(null);
    setFormMode("create");
    setError(null);
  }

  function openEdit(account: ChartOfAccount) {
    setForm(accountToForm(account));
    setEditingId(account.id);
    setFormMode("edit");
    setError(null);
  }

  async function submitForm() {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        description: form.description,
        accountType: form.accountType,
        category: form.category,
        normalBalance: form.normalBalance,
        parentAccountId: form.parentAccountId ? Number(form.parentAccountId) : null,
        reportingGroup: form.reportingGroup,
        financialStatementGroup: form.financialStatementGroup,
        taxTreatment: form.taxTreatment,
        isControlAccount: form.isControlAccount,
        notes: form.notes,
      };
      const url = formMode === "edit" && editingId !== null ? `${apiBase}/${editingId}` : apiBase;
      const method = formMode === "edit" ? "PATCH" : "POST";
      const body = formMode === "edit" ? payload : { ...payload, accountCode: form.accountCode };
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setFormMode(null);
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(account: ChartOfAccount) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !account.isActive }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function submitDuplicate() {
    if (duplicatingId === null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/${duplicatingId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountCode: duplicateCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setDuplicatingId(null);
      setDuplicateCode("");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function handleImportFile(file: File) {
    setLoading(true);
    setError(null);
    setImportErrors([]);
    try {
      const csvText = await file.text();
      const res = await fetch(`${apiBase}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      if (data.errors?.length) setImportErrors(data.errors);
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  function renderRow(node: ChartOfAccountNode, depth: number) {
    const isCollapsed = collapsed.has(node.id);
    const hasChildren = node.children.length > 0;
    return (
      <div key={node.id}>
        <div className="flex items-center gap-2 border-b border-vf-paper-border/70 px-3 py-2.5 text-sm hover:bg-vf-paper-alt/70" style={{ paddingLeft: 12 + depth * 20 }}>
          {hasChildren ? (
            <button type="button" onClick={() => toggleCollapsed(node.id)} aria-label={isCollapsed ? `Expand ${node.description}` : `Collapse ${node.description}`} className="shrink-0 text-vf-ink-faint hover:text-vf-ink">
              {isCollapsed ? <IconChevronLeft className="h-3.5 w-3.5" /> : <IconChevronDown className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <span className="w-20 shrink-0 font-mono text-xs text-vf-ink-faint">{node.accountCode}</span>
          <span className={`flex-1 truncate font-medium ${node.isActive ? "text-vf-ink" : "text-vf-ink-faint line-through"}`}>{node.description}</span>
          <span className="hidden w-28 shrink-0 text-xs text-vf-ink-faint sm:block">{node.accountType}</span>
          <span className="hidden w-16 shrink-0 text-xs text-vf-ink-faint md:block">{node.normalBalance}</span>
          {node.isControlAccount && <Badge tone="info">Control</Badge>}
          <Badge tone={node.isActive ? "good" : "muted"}>{node.isActive ? "Active" : "Inactive"}</Badge>
          <div className="ml-auto flex shrink-0 gap-1.5">
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => openEdit(node)}>
              Edit
            </Button>
            <Button
              variant="subtle"
              size="sm"
              disabled={previewMode || loading}
              title={disabledTitle}
              onClick={() => {
                setDuplicatingId(node.id);
                setDuplicateCode("");
              }}
            >
              Duplicate
            </Button>
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => toggleActive(node)}>
              {node.isActive ? "Archive" : "Reactivate"}
            </Button>
          </div>
        </div>
        {hasChildren && !isCollapsed && node.children.map((child) => renderRow(child, depth + 1))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <Input placeholder="Search by code or description…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search chart of accounts" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={openCreate}>
          <IconPlus className="h-4 w-4" /> Add Account
        </Button>
        <Button variant="subtle" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => window.open(`${apiBase}/export`, "_blank")}>
          <IconArrowDown className="h-4 w-4" /> Export CSV
        </Button>
        <label className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-vf-paper-border px-5 py-2 text-[0.88rem] font-semibold text-vf-ink-soft hover:border-vf-red-500 hover:text-vf-red-600 ${previewMode ? "pointer-events-none opacity-50" : ""}`} title={disabledTitle}>
          <IconArrowUp className="h-4 w-4" /> Import CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={previewMode}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {importErrors.length > 0 && (
        <div className="rounded-vf-md border border-vf-warning/40 bg-vf-warning/10 p-3 text-xs text-[#93601f]">
          <p className="font-medium">Some rows didn&rsquo;t import:</p>
          <ul className="mt-1 list-disc pl-4">
            {importErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {formMode && (
        <div className="rounded-vf-md border border-vf-paper-border p-4">
          <p className="mb-3 text-sm font-semibold text-vf-ink">{formMode === "create" ? "Add Account" : `Edit ${form.accountCode}`}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Account Code" htmlFor="coa-code" required>
              <Input id="coa-code" value={form.accountCode} disabled={formMode === "edit"} onChange={(e) => setForm({ ...form, accountCode: e.target.value })} />
            </Field>
            <Field label="Description" htmlFor="coa-desc" required>
              <Input id="coa-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Account Type" htmlFor="coa-type" required>
              <Select id="coa-type" value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value as AccountType })}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Normal Balance" htmlFor="coa-balance" required>
              <Select id="coa-balance" value={form.normalBalance} onChange={(e) => setForm({ ...form, normalBalance: e.target.value as NormalBalance })}>
                {NORMAL_BALANCES.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </Select>
            </Field>
            <Field label="Category" htmlFor="coa-category">
              <Input id="coa-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </Field>
            <Field label="Parent Account" htmlFor="coa-parent">
              <Select id="coa-parent" value={form.parentAccountId} onChange={(e) => setForm({ ...form, parentAccountId: e.target.value })}>
                <option value="">None</option>
                {accounts.filter((a) => a.id !== editingId).map((a) => (
                  <option key={a.id} value={a.id}>{a.accountCode} — {a.description}</option>
                ))}
              </Select>
            </Field>
            <Field label="Reporting Group" htmlFor="coa-reporting">
              <Input id="coa-reporting" value={form.reportingGroup} onChange={(e) => setForm({ ...form, reportingGroup: e.target.value })} />
            </Field>
            <Field label="Financial Statement Group" htmlFor="coa-fsg">
              <Input id="coa-fsg" value={form.financialStatementGroup} onChange={(e) => setForm({ ...form, financialStatementGroup: e.target.value })} />
            </Field>
            <Field label="Tax Treatment" htmlFor="coa-tax">
              <Input id="coa-tax" value={form.taxTreatment} onChange={(e) => setForm({ ...form, taxTreatment: e.target.value })} />
            </Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-vf-ink-soft">
            <input type="checkbox" checked={form.isControlAccount} onChange={(e) => setForm({ ...form, isControlAccount: e.target.checked })} />
            Control account
          </label>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" disabled={loading} onClick={submitForm}>
              {formMode === "create" ? "Create Account" : "Save Changes"}
            </Button>
            <Button variant="subtle" size="sm" onClick={() => setFormMode(null)}>
              Cancel
            </Button>
          </div>
          {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
        </div>
      )}

      {duplicatingId !== null && (
        <div className="rounded-vf-md border border-vf-paper-border p-4">
          <p className="mb-3 text-sm font-semibold text-vf-ink">Duplicate Account</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Field label="New Account Code" htmlFor="coa-dup-code" required>
                <Input id="coa-dup-code" value={duplicateCode} onChange={(e) => setDuplicateCode(e.target.value)} />
              </Field>
            </div>
            <Button variant="primary" size="sm" disabled={loading || !duplicateCode.trim()} onClick={submitDuplicate}>
              Duplicate
            </Button>
            <Button variant="subtle" size="sm" onClick={() => setDuplicatingId(null)}>
              Cancel
            </Button>
          </div>
          {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
        </div>
      )}

      {!formMode && duplicatingId === null && error && <p className="text-sm text-vf-danger">{error}</p>}

      <div className="rounded-vf-md border border-vf-paper-border">
        <div className="flex items-center gap-2 border-b border-vf-paper-border bg-vf-paper-alt px-3 py-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">
          <span className="w-3.5" />
          <span className="w-20">Code</span>
          <span className="flex-1">Description</span>
          <span className="hidden w-28 sm:block">Type</span>
          <span className="hidden w-16 md:block">Balance</span>
          <span className="ml-auto">Status</span>
        </div>
        {matching ? (
          matching.length === 0 ? (
            <EmptyState icon={<IconBookOpen className="h-5 w-5" />} title="No accounts match." description="Try a different search term." />
          ) : (
            matching.map((a) => renderRow({ ...a, children: [] }, 0))
          )
        ) : accountTree.length === 0 ? (
          <EmptyState icon={<IconBookOpen className="h-5 w-5" />} title="No accounts yet." description="Add your first account above." />
        ) : (
          accountTree.map((node) => renderRow(node, 0))
        )}
      </div>
    </div>
  );
}
